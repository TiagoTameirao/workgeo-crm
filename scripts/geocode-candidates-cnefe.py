"""Suggest coordinates by exact address match against IBGE CNEFE establishment points.

This offline preparation never changes the CRM or promotes a suggestion to a
verified location. Domicile records are excluded before matching.
Requires: python -m pip install ijson
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = (
    "https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/"
    "Censo_Demografico_2022/Arquivos_CNEFE/GeoJSON/Municipio_20240910/"
)
ALLOWED_SPECIES = {"3", "4", "5", "6", "8"}  # establishments; excludes dwellings and construction sites
STREET_TYPE_ALIASES = {
    "R": "RUA", "AV": "AVENIDA", "ROD": "RODOVIA", "EST": "ESTRADA",
    "TV": "TRAVESSA", "TRAV": "TRAVESSA", "PC": "PRACA", "PCA": "PRACA",
    "AL": "ALAMEDA", "VL": "VILA", "PCA": "PRACA", "LGO": "LARGO",
}


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = "".join(char for char in value if not unicodedata.combining(char)).upper()
    return re.sub(r"[^A-Z0-9]+", " ", value).strip()


def normalize_street(value: str) -> str:
    parts = normalize(value).split()
    if parts:
        parts[0] = STREET_TYPE_ALIASES.get(parts[0], parts[0])
    return " ".join(parts)


def normalize_number(value: str) -> str:
    value = normalize(value)
    if value in {"", "SN", "S N", "SEM NUMERO", "SEM NUM"}:
        return ""
    match = re.match(r"^(\d+[A-Z]?)", value)
    return match.group(1) if match else ""


def split_address(value: str) -> tuple[str, str]:
    if "," in str(value or ""):
        street, raw_number = str(value).rsplit(",", 1)
        number = normalize_number(raw_number)
        if number:
            return normalize_street(street), number
    normalized = normalize(value)
    match = re.search(r"\b(\d+[A-Z]?)\b", normalized)
    if not match:
        return normalize_street(re.sub(r"\b(S N|SN|SEM NUMERO|SEM NUM)\b", "", normalized)), ""
    return normalize_street(normalized[: match.start()].strip()), match.group(1)


def candidate_key(row: dict) -> tuple[str, str, str, str]:
    if row.get("street_name"):
        number = normalize_number(row.get("street_number", ""))
        street_name = str(row["street_name"]).strip()
        # Some Receita rows repeat the property number at the end of the street
        # field as well as in street_number. Remove only an exact terminal copy;
        # KM/quilometer labels are part of rural road addresses and must remain.
        if number and not re.search(r"\b(?:KM|QUILOMETRO)\b", normalize(street_name)):
            normalized_tokens = normalize(street_name).split()
            if len(normalized_tokens) > 1 and normalized_tokens[-1] == number:
                street_name = re.sub(r"\s+\d+[A-Z]?\s*$", "", street_name, flags=re.IGNORECASE).strip()
        street = normalize_street(f"{row.get('address_type', '')} {street_name}")
    else:
        street, number = split_address(row.get("address", ""))
    return (
        str(row.get("municipality_code_ibge", "")).zfill(7),
        re.sub(r"\D", "", row.get("postal_code", "")),
        street,
        number,
    )


def parse_cnefe_address(value: str) -> tuple[str, str]:
    return split_address(value)


def download(url: str, path: Path) -> None:
    if path.exists() and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            if len([name for name in archive.namelist() if name.lower().endswith(".json")]) == 1:
                return
    path.unlink(missing_ok=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "WorkGeo CRM address matching/1.0"})
    partial = path.with_suffix(path.suffix + ".part")
    try:
        with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    if not zipfile.is_zipfile(partial):
        partial.unlink(missing_ok=True)
        raise ValueError(f"Download IBGE incompleto ou inválido: {path.name}")
    os.replace(partial, path)


def load_candidates(path: Path) -> tuple[dict[tuple[str, str, str, str], list[dict]], set[str]]:
    indexed: dict[tuple[str, str, str, str], list[dict]] = defaultdict(list)
    codes: set[str] = set()
    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source, delimiter=";"):
            key = candidate_key(row)
            if key[0] and key[2] and (key[1] or key[3]):
                indexed[key].append(row)
                codes.add(key[0])
    return indexed, codes


def iter_features(zipped: Path):
    try:
        import ijson
    except ImportError as error:
        raise RuntimeError("Instale ijson com `python -m pip install ijson` para processar GeoJSON em streaming.") from error
    with zipfile.ZipFile(zipped) as archive:
        members = [name for name in archive.namelist() if name.lower().endswith(".json")]
        if len(members) != 1:
            raise ValueError(f"Arquivo IBGE inesperado: {zipped.name}")
        with archive.open(members[0]) as source:
            yield from ijson.items(source, "features.item")


def record_position(index: dict, key: tuple, coordinate_key: str, point: dict) -> None:
    prior = index[key].get(coordinate_key)
    if prior is None or int(point["coordinate_level"] or 6) < int(prior["coordinate_level"] or 6):
        index[key][coordinate_key] = point


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "deliverables/prospecting-cnpj/prospecting-cnpj-2026-10.csv")
    parser.add_argument("--cache", type=Path, default=ROOT / "tmp/cnefe")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/cnefe/suggestions.csv")
    args = parser.parse_args()
    candidates, municipality_codes = load_candidates(args.input)
    matches: dict[tuple[str, str, str, str], dict[str, dict]] = defaultdict(dict)
    by_address: dict[tuple[str, str, str], dict[str, dict]] = defaultdict(dict)
    by_street: dict[tuple[str, str, str], dict[str, dict]] = defaultdict(dict)
    candidate_addresses: dict[tuple[str, str, str], list[tuple[str, str, str, str]]] = defaultdict(list)
    candidate_streets: dict[tuple[str, str, str], list[tuple[str, str, str, str]]] = defaultdict(list)
    for key in candidates:
        if key[2] and key[3]: candidate_addresses[(key[0], key[2], key[3])].append(key)
        elif key[1] and key[2]: candidate_streets[(key[0], key[1], key[2])].append(key)
    counters = {"municipalities": len(municipality_codes), "establishment_points": 0, "exact_address_matches": 0, "postcode_relaxed_matches": 0, "numberless_matches": 0, "ambiguous_candidates": 0}
    for index, code in enumerate(sorted(municipality_codes), start=1):
        if index == 1 or index % 25 == 0 or index == len(municipality_codes):
            print(f"IBGE CNEFE: município {index}/{len(municipality_codes)} ({code})", flush=True)
        archive = args.cache / f"qg_810_endereco_Munic{code}.json.zip"
        download(BASE_URL + archive.name, archive)
        try:
            for feature in iter_features(archive):
                props = feature.get("properties") or {}
                if str(props.get("COD_ESPECIE", "")) not in ALLOWED_SPECIES:
                    continue
                coords = (feature.get("geometry") or {}).get("coordinates") or []
                if len(coords) < 2:
                    continue
                counters["establishment_points"] += 1
                street, number = parse_cnefe_address(props.get("LOGRAD_NUM", ""))
                key = (str(props.get("COD_MUNICIPIO", "")).zfill(7), re.sub(r"\D", "", props.get("CEP", "")), street, number)
                if key not in candidates:
                    continue
                coordinate_key = f"{float(coords[0]):.6f},{float(coords[1]):.6f}"
                point = {
                    "latitude": float(coords[1]),
                    "longitude": float(coords[0]),
                    "ibge_code": str(props.get("COD_UNICO_ENDERECO", "")),
                    "coordinate_level": str(props.get("NV_GEO_COORD", "")),
                    "species": str(props.get("COD_ESPECIE", "")),
                }
                record_position(matches, key, coordinate_key, point)
                address_key = (key[0], key[2], key[3])
                if key[2] and key[3]: record_position(by_address, address_key, coordinate_key, point)
                street_key = (key[0], key[1], key[2])
                if key[1] and key[2]: record_position(by_street, street_key, coordinate_key, point)
        finally:
            # The source archive also contains non-establishment address records.
            archive.unlink(missing_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8-sig", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=["cnpj", "latitude", "longitude", "source", "source_date", "confidence", "match_method", "match_count"], delimiter=";")
        writer.writeheader()
        for key, rows in candidates.items():
            positions = matches.get(key, {})
            if len(positions) > 1:
                counters["ambiguous_candidates"] += len(rows)
                continue
            method = "municipio_cep_logradouro_numero"
            tier = "exact_address_matches"
            if positions:
                point = next(iter(positions.values()))
                if not key[3]:
                    method = "municipio_cep_logradouro_sem_numero"
                    tier = "numberless_matches"
            elif key[3]:
                positions = by_address.get((key[0], key[2], key[3]), {})
                if len(positions) != 1:
                    if len(positions) > 1: counters["ambiguous_candidates"] += len(rows)
                    continue
                point = next(iter(positions.values()))
                method = "municipio_logradouro_numero_cep_divergente_ou_ausente"
                tier = "postcode_relaxed_matches"
            elif not key[3]:
                positions = by_street.get((key[0], key[1], key[2]), {})
                if len(positions) != 1:
                    if len(positions) > 1: counters["ambiguous_candidates"] += len(rows)
                    continue
                point = next(iter(positions.values()))
                method = "municipio_cep_logradouro_sem_numero"
                tier = "numberless_matches"
            else:
                continue
            level = int(point["coordinate_level"] or 6)
            if level > 4:
                continue
            if tier == "exact_address_matches":
                confidence = {1:"Alta; endereço/CEP exatos e posição original de campo",2:"Média; endereço/CEP exatos, coordenada modificada",3:"Média; endereço/CEP exatos, coordenada estimada",4:"Baixa; endereço/CEP exatos, coordenada aproximada à face do quarteirão"}[level]
            elif tier == "postcode_relaxed_matches":
                confidence = {1:"Média; município, logradouro e número coincidem, CEP diverge ou falta",2:"Baixa; endereço sem CEP coincidente, coordenada modificada",3:"Baixa; endereço sem CEP coincidente, coordenada estimada",4:"Baixa; endereço sem CEP, posição aproximada à face do quarteirão"}[level]
            else:
                confidence = "Baixa; município, CEP e logradouro coincidem, mas o CNPJ não informa número"
            counters[tier] += len(rows)
            for row in rows:
                writer.writerow({
                    "cnpj": row["cnpj"], "latitude": point["latitude"], "longitude": point["longitude"],
                    "source": f"IBGE CNEFE 2022 — {method}; nível de coordenada {level}",
                    "source_date": "2024-09-10", "confidence": confidence + "; revisar",
                    "match_method": method, "match_count": len(positions),
                })
    print(json.dumps({**counters, "suggestions_total": counters["exact_address_matches"]+counters["postcode_relaxed_matches"]+counters["numberless_matches"], "output": str(args.output)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
