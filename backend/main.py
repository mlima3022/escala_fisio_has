from __future__ import annotations

import io
import re
import unicodedata
from typing import Any

import pdfplumber
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Escala Parser API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECTOR_CANDIDATES = [
    "Supervisão / diarista",
    "Unidades 1, 2 e 5",
    "CTI / UCO (Diurno)",
    "CTI / UCO (Noturno)",
]

LEGEND_DEFAULT = {
    "P": "Plantão",
    "T": "Tarde",
    "M": "Manhã",
    "N": "Noite",
    "***": "Férias",
    "L": "Licença",
    "SE": "Serviço externo",
    "LC": "Licença casamento",
    "FE": "Folga eleição",
}

MONTH_MAP = {
    "JANEIRO": 1,
    "FEVEREIRO": 2,
    "MARCO": 3,
    "ABRIL": 4,
    "MAIO": 5,
    "JUNHO": 6,
    "JULHO": 7,
    "AGOSTO": 8,
    "SETEMBRO": 9,
    "OUTUBRO": 10,
    "NOVEMBRO": 11,
    "DEZEMBRO": 12,
}

CODE_RE = re.compile(r"^[A-Z*]{1,4}$")
VALID_CODE_TOKENS = {k.upper() for k in LEGEND_DEFAULT.keys()} | {"F"}
LINE_CODE_RE = re.compile(r"^(?:\*{3}|FE|LC|SE|L|F|P|T|M|N|[PTMFN][A-Za-z]{2,4})$", re.IGNORECASE)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/parse")
async def parse_pdf(file: UploadFile = File(...)) -> dict[str, Any]:
    filename = file.filename or ""
    lower_name = filename.lower()
    if not (lower_name.endswith(".pdf") or lower_name.endswith(".csv")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser PDF ou CSV")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio")

    if lower_name.endswith(".csv"):
        full_text = decode_text_bytes(content)
        metadata = parse_metadata(full_text, filename)
        sectors = parse_sectors_from_lines(full_text.splitlines())
    else:
        pages = extract_pdf_pages(content)
        full_text = "\n".join(page["text"] for page in pages)
        metadata = parse_metadata(full_text, filename)

        # Tenta parser por linhas (mais fiel ao layout da escala) e fallback para tabelas.
        sectors_from_lines = parse_sectors_from_lines(full_text.splitlines())
        sectors_from_tables = parse_sectors(pages, full_text)
        sectors = pick_better_sectors(sectors_from_lines, sectors_from_tables)

    return {
        "metadata": metadata,
        "sectors": sectors,
        "legend": LEGEND_DEFAULT,
    }


def extract_pdf_pages(pdf_bytes: bytes) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            pages.append(
                {
                    "text": page.extract_text() or "",
                    "tables": page.extract_tables() or [],
                }
            )
    return pages


def parse_metadata(text: str, filename: str) -> dict[str, Any]:
    search_space = f"{filename} {text}"
    normalized_upper = normalize_upper(search_space)

    month_match = re.search(
        r"(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)",
        normalized_upper,
    )
    year_match = re.search(r"(20\d{2})", normalized_upper)

    month_name = month_match.group(1) if month_match else "JANEIRO"
    year = int(year_match.group(1)) if year_match else 2026

    return {
        "month": MONTH_MAP.get(month_name, 1),
        "month_name": month_name,
        "year": year,
        "source_filename": filename,
    }


def pick_better_sectors(
    candidate_a: list[dict[str, Any]], candidate_b: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    def score(sectors: list[dict[str, Any]]) -> int:
        employees = sum(len(s.get("employees", [])) for s in sectors)
        assignments = 0
        for sector in sectors:
            for emp in sector.get("employees", []):
                assignments += len(emp.get("days", {}))
        return employees * 5 + assignments

    return candidate_a if score(candidate_a) >= score(candidate_b) else candidate_b


def parse_sectors_from_lines(lines: list[str]) -> list[dict[str, Any]]:
    sectors = [{"name": name, "employees": []} for name in SECTOR_CANDIDATES]
    index = {s["name"]: {} for s in sectors}
    current_sector = SECTOR_CANDIDATES[0]

    for raw_line in lines:
        line = normalize_space(strip_csv_quotes(raw_line))
        if not line:
            continue

        detected_sector = detect_sector_name(line)
        if detected_sector:
            current_sector = detected_sector
            continue

        if line.upper().startswith("MATR."):
            continue

        employee = parse_employee_line(line)
        if employee:
            merge_employee(index[current_sector], employee)

    for sector in sectors:
        sector["employees"] = sorted(
            index[sector["name"]].values(), key=lambda x: x["name"].lower()
        )

    return sectors


def parse_employee_line(line: str) -> dict[str, Any] | None:
    m = re.match(r"^(\d{4,6})\s+(.+)$", line)
    if not m:
        return None

    matricula = m.group(1)
    rest = m.group(2)
    tokens = rest.split()
    if len(tokens) < 8:
        return None

    boundary = find_name_code_boundary(tokens)
    if boundary is None:
        return None

    name_tokens = tokens[:boundary]
    name = sanitize_person_name(" ".join(name_tokens))
    if not name:
        return None

    day_tokens: list[str] = []
    i = boundary
    while i < len(tokens) and len(day_tokens) < 31 and is_line_code_token(tokens[i]):
        day_tokens.append(normalize_line_code(tokens[i]))
        i += 1

    if not day_tokens:
        return None

    tail = tokens[i:]
    role, shift_hours = split_role_and_shift(tail)

    days = {str(day + 1): code for day, code in enumerate(day_tokens)}

    return {
        "matricula": matricula,
        "name": name,
        "role": role,
        "shift_hours": shift_hours,
        "days": days,
    }


def find_name_code_boundary(tokens: list[str]) -> int | None:
    # Busca o primeiro ponto em que surge uma janela fortemente composta por codigos de escala.
    for i in range(2, max(3, len(tokens) - 2)):
        window = tokens[i : i + 10]
        if len(window) < 6:
            continue
        code_count = sum(1 for t in window if is_line_code_token(t))
        if code_count >= 6:
            return i
    return None


def is_line_code_token(token: str) -> bool:
    return bool(LINE_CODE_RE.fullmatch(token.strip()))


def normalize_line_code(token: str) -> str:
    cleaned = normalize_space(token)
    if cleaned == "***":
        return "***"
    return cleaned[:1].upper() + cleaned[1:]


def split_role_and_shift(tokens: list[str]) -> tuple[str, str]:
    if not tokens:
        return "", ""

    shift_start = None
    for idx, tok in enumerate(tokens):
        upper = normalize_upper(tok)
        if ":" in tok or "H" in upper or "AS" == upper or "A" == upper:
            shift_start = idx
            break

    if shift_start is None:
        return sanitize_free_text(" ".join(tokens)), ""

    role = sanitize_free_text(" ".join(tokens[:shift_start]))
    shift = sanitize_free_text(" ".join(tokens[shift_start:]))
    return role, shift


def strip_csv_quotes(line: str) -> str:
    value = line.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    return value


def decode_text_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def parse_sectors(pages: list[dict[str, Any]], full_text: str) -> list[dict[str, Any]]:
    sectors = [{"name": name, "employees": []} for name in SECTOR_CANDIDATES]
    employee_index = {s["name"]: {} for s in sectors}

    current_sector_name = detect_sector_name(full_text) or SECTOR_CANDIDATES[0]

    for page in pages:
        page_sector = detect_sector_name(page["text"])
        if page_sector:
            current_sector_name = page_sector

        for table in page["tables"]:
            rows = clean_table_rows(table)
            if not rows:
                continue

            day_columns = detect_day_columns(rows)

            for row in rows:
                row_sector = detect_sector_name(" ".join(row))
                if row_sector:
                    current_sector_name = row_sector

                employee = parse_employee_row(row, day_columns)
                if employee:
                    merge_employee(employee_index[current_sector_name], employee)

        # Fallback textual quando o PDF nao traz tabela detectavel.
        for employee in parse_textual_employees(page["text"]):
            merge_employee(employee_index[current_sector_name], employee)

    for sector in sectors:
        sector["employees"] = sorted(
            employee_index[sector["name"]].values(), key=lambda x: x["name"].lower()
        )

    return sectors


def parse_textual_employees(text: str) -> list[dict[str, Any]]:
    results = []
    for line in text.splitlines():
        cleaned = normalize_space(line)
        m = re.match(r"^(\d{4,6})\s+(.+)$", cleaned)
        if not m:
            continue
        name = sanitize_person_name(m.group(2))
        if not name:
            continue
        results.append(
            {
                "matricula": m.group(1),
                "name": name,
                "role": "",
                "shift_hours": "",
                "days": {},
            }
        )
    return results


def clean_table_rows(table: list[list[str | None]]) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in table:
        cleaned = [normalize_space(cell or "") for cell in row]
        if any(cleaned):
            rows.append(cleaned)
    return rows


def detect_day_columns(rows: list[list[str]]) -> dict[int, int]:
    day_columns: dict[int, int] = {}
    header_rows = rows[:4]
    for row in header_rows:
        for idx, value in enumerate(row):
            numeric = only_digits(value)
            if not numeric:
                continue
            day = int(numeric)
            if 1 <= day <= 31:
                day_columns[idx] = day
    return day_columns


def parse_employee_row(row: list[str], day_columns: dict[int, int]) -> dict[str, Any] | None:
    matricula_idx, matricula = find_matricula(row)
    if matricula_idx is None or not matricula:
        return None

    name_idx, name = find_name(row, start=matricula_idx + 1)
    if not name:
        return None

    role = sanitize_free_text(row[name_idx + 1]) if name_idx + 1 < len(row) else ""
    shift_hours = sanitize_free_text(row[name_idx + 2]) if name_idx + 2 < len(row) else ""

    days: dict[str, str] = {}
    for idx, day in day_columns.items():
        if idx >= len(row):
            continue
        code = normalize_code(row[idx])
        if code:
            days[str(day)] = code

    return {
        "matricula": matricula,
        "name": name,
        "role": role,
        "shift_hours": shift_hours,
        "days": days,
    }


def find_matricula(row: list[str]) -> tuple[int | None, str | None]:
    for idx, value in enumerate(row):
        digits = extract_first_matricula(value)
        if digits:
            return idx, digits
    return None, None


def find_name(row: list[str], start: int = 0) -> tuple[int, str] | tuple[None, None]:
    for idx in range(start, len(row)):
        value = row[idx]
        cleaned_name = sanitize_person_name(value)
        if not cleaned_name:
            continue
        return idx, cleaned_name
    return None, None


def merge_employee(index: dict[str, dict[str, Any]], employee: dict[str, Any]) -> None:
    key = employee["matricula"]
    existing = index.get(key)
    if not existing:
        index[key] = employee
        return

    if not existing.get("role") and employee.get("role"):
        existing["role"] = employee["role"]
    if not existing.get("shift_hours") and employee.get("shift_hours"):
        existing["shift_hours"] = employee["shift_hours"]

    existing_days = existing.setdefault("days", {})
    existing_days.update(employee.get("days", {}))


def detect_sector_name(text: str) -> str | None:
    normalized = normalize_upper(text)
    for sector in SECTOR_CANDIDATES:
        if normalize_upper(sector) in normalized:
            return sector
    return None


def normalize_code(value: str) -> str:
    code = normalize_space(value).upper().replace(" ", "")
    if not code:
        return ""
    if CODE_RE.match(code):
        return code
    return ""


def is_probable_name(value: str) -> bool:
    text = normalize_space(value)
    if len(text) < 6:
        return False
    if only_digits(text):
        return False
    if re.search(r"\d", text):
        return False
    words = text.split()
    if len(words) < 2:
        return False

    long_words = [w for w in words if len(w) >= 3]
    one_char_words = [w for w in words if len(w) == 1]
    if not long_words:
        return False
    if len(one_char_words) > len(words) // 2:
        return False
    if all(looks_like_code_token(w) for w in words):
        return False
    return True


def sanitize_person_name(value: str) -> str:
    text = normalize_space(value)
    if not text:
        return ""

    tokens = text.split()
    # Remove codigos no final, ex: "Mateus ... F F"
    while tokens and looks_like_code_token(tokens[-1]):
        tokens.pop()

    cleaned = " ".join(tokens)
    if not is_probable_name(cleaned):
        return ""
    return cleaned


def sanitize_free_text(value: str) -> str:
    text = normalize_space(value)
    if not text:
        return ""
    tokens = text.split()
    if tokens and all(looks_like_code_token(t) for t in tokens):
        return ""
    return text


def looks_like_code_token(token: str) -> bool:
    normalized = normalize_space(token).upper()
    if not normalized:
        return False
    if normalized in VALID_CODE_TOKENS:
        return True
    return bool(re.fullmatch(r"[A-Z*]{1,3}", normalized))


def extract_first_matricula(value: str) -> str:
    text = normalize_space(value)
    if not text:
        return ""

    # Prefere blocos reais de matricula (4-6 digitos), evita concatenar diversos codigos.
    matches = re.findall(r"\b\d{4,6}\b", text)
    if matches:
        return matches[0]

    digits = only_digits(text)
    if 4 <= len(digits) <= 6:
        return digits
    return ""


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def only_digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def normalize_upper(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return ascii_only.upper()
