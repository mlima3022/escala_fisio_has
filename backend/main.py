from __future__ import annotations

import io
import re
from typing import Any

import pdfplumber
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Escala Parser API", version="1.0.0")

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
    "MARÇO": 3,
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

    text = extract_text(content)

    metadata = parse_metadata(text, file.filename)
    sectors = parse_sectors(text)

    return {
        "metadata": metadata,
        "sectors": sectors,
        "legend": LEGEND_DEFAULT,
    }


def extract_text(pdf_bytes: bytes) -> str:
    all_text = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            all_text.append(page.extract_text() or "")
    return "\n".join(all_text)


def parse_metadata(text: str, filename: str) -> dict[str, Any]:
    month_name = ""
    year = 0

    upper = text.upper().replace("Ç", "C")

    month_match = re.search(r"(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)", upper)
    year_match = re.search(r"(20\d{2})", upper)

    if month_match:
        month_name = month_match.group(1)
    if year_match:
        year = int(year_match.group(1))

    month = MONTH_MAP.get(month_name, 1)
    if not year:
        year = 2026

    return {
        "month": month,
        "month_name": month_name or "JANEIRO",
        "year": year,
        "source_filename": filename,
    }


def parse_sectors(text: str) -> list[dict[str, Any]]:
    # Heurística textual básica. Para PDFs tabulares complexos, adapte regexs por layout real.
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    sectors: list[dict[str, Any]] = [{"name": s, "employees": []} for s in SECTOR_CANDIDATES]

    current_sector = sectors[0]
    matricula_regex = re.compile(r"^(\d{4,})\s+([A-ZÀ-Úa-zà-ú\s]+)$")

    for line in lines:
        normalized = line.lower()
        found_sector = next((s for s in sectors if s["name"].lower() in normalized), None)
        if found_sector:
            current_sector = found_sector
            continue

        m = matricula_regex.match(line)
        if m:
            matricula = m.group(1).strip()
            name = " ".join(m.group(2).split())
            current_sector["employees"].append(
                {
                    "matricula": matricula,
                    "name": name,
                    "role": "",
                    "shift_hours": "",
                    "days": {},
                }
            )

    return sectors
