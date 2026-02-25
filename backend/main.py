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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/parse")
async def parse_pdf(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Arquivo deve ser PDF")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="PDF vazio")

    pages = extract_pdf_pages(content)
    full_text = "\n".join(page["text"] for page in pages)

    metadata = parse_metadata(full_text, file.filename)
    sectors = parse_sectors(pages, full_text)

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
        m = re.match(r"^(\d{4,})\s+([A-Za-zÀ-ÿ\s]{6,})$", cleaned)
        if not m:
            continue
        results.append(
            {
                "matricula": m.group(1),
                "name": normalize_space(m.group(2)),
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

    role = row[name_idx + 1] if name_idx + 1 < len(row) else ""
    shift_hours = row[name_idx + 2] if name_idx + 2 < len(row) else ""

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
        digits = only_digits(value)
        if len(digits) >= 4:
            return idx, digits
    return None, None


def find_name(row: list[str], start: int = 0) -> tuple[int, str] | tuple[None, None]:
    for idx in range(start, len(row)):
        value = row[idx]
        if not is_probable_name(value):
            continue
        return idx, value
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
    return len(words) >= 2


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def only_digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def normalize_upper(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return ascii_only.upper()
