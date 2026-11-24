"""Build an auditable prospecting list from Receita's public CNPJ snapshot."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import io
import json
import os
import re
import sys
import tempfile
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SHARE_ID = "YggdBLfdninEJX9"
BASE_URL = f"https://arquivos.receitafederal.gov.br/public.php/dav/files/{SHARE_ID}"
RFB_NS = {"d": "DAV:"}


def key(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return re.sub(r"[^A-Z0-9]", "", normalized.upper())


def request(url: str, method: str = "GET", headers: dict[str, str] | None = None) -> urllib.request.Request:
    request_headers = {"Depth": "1"} if method == "PROPFIND" else {}
    request_headers.update(headers or {})
    return urllib.request.Request(url, method=method, headers=request_headers)


def share_files(month: str | None) -> tuple[str, dict[str, int]]:
    with urllib.request.urlopen(request(BASE_URL + "/", "PROPFIND"), timeout=60) as response:
        root = ET.fromstring(response.read())
    folders = []
    for item in root.findall("d:response", RFB_NS):
        href = urllib.parse.unquote(item.findtext("d:href", default="", namespaces=RFB_NS))
        folder = re.search(r"/(20\d{2}-\d{2})/$", href)
        if folder:
            folders.append(folder.group(1))
    selected = month or max(folders)
    folder_url = f"{BASE_URL}/{selected}/"
    with urllib.request.urlopen(request(folder_url, "PROPFIND"), timeout=60) as response:
        root = ET.fromstring(response.read())
    files: dict[str, int] = {}
    for item in root.findall("d:response", RFB_NS):
        href = urllib.parse.unquote(item.findtext("d:href", default="", namespaces=RFB_NS))
        name = href.rstrip("/").split("/")[-1]
        size_text = item.findtext(".//d:getcontentlength", default="0", namespaces=RFB_NS)
        if name.lower().endswith(".zip"):
            files[name] = int(size_text or 0)
    return selected, files


def required_files(files: dict[str, int]) -> list[str]:
    expected = {"Cnaes.zip", "Municipios.zip"}
    expected.update(f"Empresas{index}.zip" for index in range(10))
    expected.update(f"Estabelecimentos{index}.zip" for index in range(10))
    missing = sorted(expected - files.keys())
    if missing:
        raise RuntimeError("A carga RFB está incompleta; arquivos ausentes: " + ", ".join(missing))
    return sorted(expected)


def download_one(month: str, name: str, expected_size: int, folder: Path) -> Path:
    destination = folder / name
    if destination.exists() and destination.stat().st_size == expected_size:
        try:
            validate_zip_header(destination)
            return destination
        except (OSError, EOFError, zipfile.BadZipFile, RuntimeError):
            destination.unlink()
    temporary = destination.with_suffix(destination.suffix + ".part")
    url = f"{BASE_URL}/{month}/{urllib.parse.quote(name)}"
    for attempt in range(1, 6):
        offset = temporary.stat().st_size if temporary.exists() else 0
        if offset >= expected_size:
            temporary.unlink()
            offset = 0
        headers = {"Range": f"bytes={offset}-"} if offset else None
        try:
            with urllib.request.urlopen(request(url, headers=headers), timeout=120) as response:
                if offset:
                    content_range = response.headers.get("Content-Range", "")
                    if response.status != 206 or not content_range.startswith(f"bytes {offset}-"):
                        offset = 0
                mode = "ab" if offset else "wb"
                total = offset
                reported = total
                with temporary.open(mode) as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        output.flush()
                        total += len(chunk)
                        if total - reported >= 100 * 1024 * 1024:
                            print(f"Baixando {name}: {total:,}/{expected_size:,} bytes", flush=True)
                            reported = total
            if total == expected_size:
                validate_zip_header(temporary)
                temporary.replace(destination)
                return destination
            raise RuntimeError(f"Download incompleto de {name}: esperado {expected_size}, recebido {total} bytes.")
        except Exception:
            if attempt == 5:
                raise
            print(f"Conexão interrompida em {name}; retomando tentativa {attempt + 1}/5…", flush=True)
            time.sleep(min(2**attempt, 30))
    raise RuntimeError(f"Não foi possível concluir o download de {name}.")


def source_member(archive: zipfile.ZipFile) -> str:
    members = [name for name in archive.namelist() if not name.endswith("/")]
    if len(members) != 1:
        raise RuntimeError(f"Esperado um CSV por arquivo ZIP; encontrados: {members}")
    return members[0]


def validate_zip_header(filename: Path) -> None:
    with zipfile.ZipFile(filename) as archive:
        member = source_member(archive)
        with archive.open(member) as source:
            source.read(1)


def rows_from_zip(filename: Path):
    with zipfile.ZipFile(filename) as archive:
        member = source_member(archive)
        with archive.open(member) as binary, io.TextIOWrapper(binary, encoding="latin-1", newline="") as text:
            yield from csv.reader(text, delimiter=";", quotechar='"')


def load_domains(folder: Path) -> tuple[dict[str, str], dict[str, str]]:
    cnaes: dict[str, str] = {}
    municipality_names: dict[str, str] = {}
    for row in rows_from_zip(folder / "Cnaes.zip"):
        if len(row) >= 2:
            cnaes[row[0].strip()] = row[1].strip()
    for row in rows_from_zip(folder / "Municipios.zip"):
        if len(row) >= 2:
            municipality_names[row[0].strip()] = row[1].strip()
    return cnaes, municipality_names


def merged_region_universe(regions: dict) -> dict:
    municipalities: dict[tuple[str, str], dict] = {}
    for region in regions["regions"]:
        for item in region["municipalities"]:
            identity = (str(item["uf"]).upper(), str(item["ibge_code"]))
            entry = municipalities.setdefault(identity, {
                "ibge_code": identity[1],
                "municipality": item["municipality"],
                "uf": identity[0],
                "prospecting_region_ids": [],
            })
            if entry["municipality"] != item["municipality"]:
                raise RuntimeError(f"Código IBGE {identity[1]} tem nomes municipais divergentes.")
            if region["id"] not in entry["prospecting_region_ids"]:
                entry["prospecting_region_ids"].append(region["id"])
    entries = list(municipalities.values())
    return {"municipalities": entries, "municipalities_count": len(entries)}


def target_municipality_codes(universe: dict, rfb_names: dict[str, str], overrides: list[dict]) -> tuple[dict[tuple[str, str], dict], list[dict], list[dict]]:
    reverse: dict[str, list[str]] = {}
    for code, name in rfb_names.items():
        reverse.setdefault(key(name), []).append(code)
    mapped: dict[tuple[str, str], dict] = {}
    override_by_ibge_name = {key(item["ibge_municipality"]): item for item in overrides}
    applied_overrides: list[dict] = []
    multiple_codes_for_name: list[dict] = []
    missing: list[str] = []
    for municipality in universe["municipalities"]:
        codes = reverse.get(key(municipality["municipality"]), [])
        override = override_by_ibge_name.get(key(municipality["municipality"]))
        if not codes and override:
            codes = reverse.get(key(override["receita_municipality"]), [])
            if codes:
                applied_overrides.append(override)
        if not codes:
            missing.append(f"{municipality['municipality']}/{municipality['uf']}")
        elif len(codes) > 1:
            multiple_codes_for_name.append({
                "ibge_municipality": municipality["municipality"],
                "uf": municipality["uf"],
                "rfb_codes": sorted(codes),
            })
        for code in codes:
            mapped[(municipality["uf"], code)] = municipality
    if missing:
        raise RuntimeError(
            f"{len(missing)} município(s) do IBGE não foram encontrados no domínio municipal da Receita: "
            + ", ".join(missing[:25])
        )
    return mapped, applied_overrides, multiple_codes_for_name


def matching_categories(code: str, categories: list[dict]) -> list[dict]:
    return [category for category in categories if any(code.startswith(prefix) for prefix in category["cnae_prefixes"])]


def matched_category_details(codes: list[str], cnaes: dict[str, str], categories: list[dict]) -> list[dict]:
    matches: dict[str, dict] = {}
    for code in codes:
        if code not in cnaes:
            continue
        for category in matching_categories(code, categories):
            match = matches.setdefault(category["id"], {
                "id": category["id"],
                "label": category["label"],
                "tier": category["tier"],
                "codes": [],
            })
            match["codes"].append({"code": code, "description": cnaes[code]})
    return list(matches.values())


def establishment_candidates(folder: Path, target_codes: dict[tuple[str, str], dict], cnaes: dict[str, str], categories: list[dict]) -> tuple[list[dict], dict]:
    candidates_by_cnpj: dict[str, dict] = {}
    counts = {"establishments_seen": 0, "in_area": 0, "active_in_area": 0, "with_matching_cnae": 0}
    for index in range(10):
        filename = folder / f"Estabelecimentos{index}.zip"
        print(f"Filtrando {filename.name}…", flush=True)
        for row in rows_from_zip(filename):
            counts["establishments_seen"] += 1
            if len(row) < 28:
                raise RuntimeError(f"Leiaute inesperado em {filename.name}: {len(row)} colunas.")
            uf = row[19].strip().upper()
            municipality = target_codes.get((uf, row[20].strip()))
            if not municipality:
                continue
            counts["in_area"] += 1
            if row[5].strip() != "02":
                continue
            counts["active_in_area"] += 1
            primary = row[11].strip()
            secondary = [code.strip() for code in row[12].split(",") if code.strip()]
            categories_matched = matched_category_details([primary, *secondary], cnaes, categories)
            if not categories_matched:
                continue
            counts["with_matching_cnae"] += 1
            base = row[0].strip().upper()
            order = row[1].strip().upper()
            verifier = row[2].strip()
            full_cnpj = base + order + verifier
            if len(full_cnpj) != 14 or not re.fullmatch(r"[A-Z0-9]{12}\d{2}", full_cnpj):
                continue
            unit_name = row[4].strip() or f"{municipality['municipality']} — CNPJ {full_cnpj}"
            candidate = {
                "cnpj": full_cnpj,
                "cnpj_base": base,
                "company_name": "",
                "unit_name": f"{unit_name} — {municipality['municipality']}",
                "branch_type": "Matriz" if row[3].strip() == "1" else "Filial",
                "municipality": municipality["municipality"],
                "municipality_code_ibge": municipality["ibge_code"],
                "prospecting_region_ids": municipality["prospecting_region_ids"],
                "uf": uf,
                "address": " ".join(part.strip() for part in row[13:18] if part.strip()),
                "address_type": row[13].strip(),
                "street_name": row[14].strip(),
                "street_number": row[15].strip(),
                "address_complement": row[16].strip(),
                "neighborhood": row[17].strip(),
                "postal_code": row[18].strip(),
                "phone": "".join(char for char in (row[21] + row[22]) if char.isdigit()),
                "email": row[27].strip(),
                "cnae_primary": primary,
                "cnae_primary_description": cnaes.get(primary, "NÃO ENCONTRADO"),
                "categories": categories_matched,
                "source_status": "ATIVA (Receita Federal)",
            }
            current = candidates_by_cnpj.get(full_cnpj)
            if current:
                raise RuntimeError(f"CNPJ repetido na fonte: {full_cnpj}")
            candidates_by_cnpj[full_cnpj] = candidate
    candidates = list(candidates_by_cnpj.values())
    counts["candidate_establishments"] = len(candidates)
    counts["candidate_company_bases"] = len({item["cnpj_base"] for item in candidates})
    return candidates, counts


def load_company_details(folder: Path, candidate_bases: set[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for index in range(10):
        filename = folder / f"Empresas{index}.zip"
        print(f"Relacionando razão social e porte: {filename.name}…", flush=True)
        for row in rows_from_zip(filename):
            if row and row[0].strip().upper() in candidate_bases:
                if len(row) < 6:
                    raise RuntimeError(f"Leiaute inesperado em {filename.name}: {len(row)} colunas.")
                found[row[0].strip().upper()] = {
                    "company_name": row[1].strip(),
                    "rfb_size_code": row[5].strip(),
                }
    missing = candidate_bases - found.keys()
    if missing:
        raise RuntimeError(f"{len(missing)} base(s) CNPJ sem razão social/porte na fonte.")
    return found


def csv_row(candidate: dict, details: dict, source_name: str, source_date: str) -> dict:
    candidate = {**candidate, **details}
    is_direct = any(item["tier"].startswith("Aderência direta") for item in candidate["categories"])
    size_labels = {"01": "Microempresa", "03": "Empresa de pequeno porte", "05": "Demais (porte não discriminado)"}
    size_label = size_labels.get(candidate["rfb_size_code"], "Porte não informado")
    cnae_context = " | ".join(
        f"{category['label']}: " + ", ".join(
            f"{entry['code']} {entry['description']}" for entry in category["codes"]
        )
        for category in candidate["categories"]
    )
    return {
        **candidate,
        "size_label": size_label,
        "size_confirmed_small": candidate["rfb_size_code"] in {"01", "03"},
        "scope_tier": "Aderência direta a validar" if is_direct else "Aderência adjacente a revisar",
        "cnae_context": cnae_context,
        "source": f"Dados abertos CNPJ da Receita Federal — carga {source_name}",
        "source_date": source_date,
        "coordinates_status": "Pendente; Receita não informa coordenada individual; validar endereço e raio antes de mapear",
        "review_status": "Revisão humana: CNAE/porte operacional e posição individual frente à região selecionada pendentes",
    }


def serialize_candidate_csv_row(candidate: dict) -> dict:
    row = {**candidate}
    row["categories"] = " | ".join(category["label"] for category in candidate["categories"])
    row["prospecting_region_ids"] = json.dumps(candidate.get("prospecting_region_ids", []), ensure_ascii=False)
    return row


def segment_for_candidate(candidate: dict) -> str:
    codes = [entry["code"] for category in candidate["categories"] for entry in category["codes"]]
    if any(code.startswith(("05", "07", "08", "09")) for code in codes):
        if any(code.startswith("0810006") for code in codes):
            return "Areal"
        if any(code.startswith(("0810002", "0810003", "0810004", "0810099", "23915")) for code in codes):
            return "Pedreira"
        return "Mineração"
    if any(code.startswith("232") for code in codes):
        return "Cimenteira"
    if any(code.startswith("233") for code in codes):
        return "Concreteira"
    if any(code.startswith("234") for code in codes):
        return "Cerâmica"
    if any(code.startswith(("241", "242", "243", "244", "245")) for code in codes):
        return "Siderurgia"
    if any(code.startswith(("021", "022", "161", "162")) for code in codes):
        return "Madeireira"
    if any(code.startswith(("383", "4687")) for code in codes):
        return "Sucateiro"
    if any(code.startswith("4621") for code in codes):
        return "Agro"
    return "Outros"


def import_contact_channels(candidate: dict) -> dict[str, str]:
    raw_email = candidate.get("email", "").strip()
    email = raw_email if re.fullmatch(r"\S+@\S+\.\S+", raw_email) else ""
    website = ""
    if not email and re.fullmatch(r"(?i)(?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/?", raw_email):
        website = raw_email if raw_email.lower().startswith(("http://", "https://")) else f"https://{raw_email}"
    raw_phone = re.sub(r"\D", "", candidate.get("phone", ""))
    phone = raw_phone if len(raw_phone) in {10, 11} and len(set(raw_phone)) > 1 else ""
    return {"email": email, "website": website, "phone": phone}


def contact_data_quality(candidates: list[dict]) -> dict[str, int]:
    quality = {
        "candidates": len(candidates),
        "usable_phone_in_import": 0,
        "phone_omitted_for_review": 0,
        "usable_email_in_import": 0,
        "website_recovered_from_registration_field": 0,
        "email_omitted_for_review": 0,
    }
    for candidate in candidates:
        channels = import_contact_channels(candidate)
        quality["usable_phone_in_import"] += bool(channels["phone"])
        quality["phone_omitted_for_review"] += bool(candidate.get("phone") and not channels["phone"])
        quality["usable_email_in_import"] += bool(channels["email"])
        quality["website_recovered_from_registration_field"] += bool(channels["website"])
        quality["email_omitted_for_review"] += bool(
            candidate.get("email") and not channels["email"] and not channels["website"]
        )
    return quality


def crm_import_rows(candidates: list[dict], source_month: str, source_date: str) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for candidate in candidates:
        if candidate["rfb_size_code"] in {"01", "03"}:
            grouped.setdefault(candidate["cnpj_base"], []).append(candidate)
    rows: list[dict] = []
    for company_candidates in grouped.values():
        company_candidates.sort(key=lambda item: (item["branch_type"] != "Matriz", item["cnpj"]))
        company_cnpj = company_candidates[0]["cnpj"]
        company_name = company_candidates[0]["company_name"]
        unit_names: set[str] = set()
        for candidate in company_candidates:
            unit_name = candidate["unit_name"]
            normalized = key(unit_name)
            if normalized in unit_names:
                unit_name += " — filial " + candidate["cnpj"][8:12]
            unit_names.add(key(unit_name))
            categories = ", ".join(category["label"] for category in candidate["categories"])
            evidence = (
                f"CNAE cadastrado: {candidate['cnae_primary']} {candidate['cnae_primary_description']}. "
                f"Categorias: {categories}. Indicador de prospecção a validar; sem coordenada individual na fonte."
            )
            channels = import_contact_channels(candidate)
            data_review_notes = []
            if candidate["email"] and not channels["email"] and not channels["website"]:
                data_review_notes.append("Campo de e-mail cadastral inconsistente; conferir na lista mestre antes de usar.")
            if candidate["phone"] and not channels["phone"]:
                data_review_notes.append("Telefone cadastral não passou na validação básica; conferir na lista mestre antes de usar.")
            size_label = "Microempresa" if candidate["rfb_size_code"] == "01" else "Empresa de pequeno porte"
            rows.append({
                "empresa": company_name,
                "unidade": unit_name,
                "cnpj": company_cnpj,
                "segmento": segment_for_candidate(candidate),
                "porte": "Pequeno",
                "evidencia_do_porte": "Confirmado",
                "fonte_do_porte": f"Receita Federal, carga {source_month}, código {candidate['rfb_size_code']} ({size_label}); campo classificado pelo cadastro empresarial.",
                "municipio": candidate["municipality"],
                "endereco": candidate["address"],
                "latitude": "",
                "longitude": "",
                "site": channels["website"],
                "maps": "",
                "prioridade": "Não definida",
                "justificativa_da_prioridade": "",
                "fonte": f"Dados Abertos CNPJ — Receita Federal — carga {source_month}",
                "data_da_fonte": source_date,
                "aderencia": evidence,
                "viabilidade": "Não confirmada; endereço cadastral requer conferência operacional.",
                "momento_comercial": "Não confirmado; não houve pesquisa de necessidade ou interlocutor.",
                "materiais": categories,
                "contato": "Contato cadastral a confirmar" if channels["phone"] or channels["email"] or channels["website"] else "",
                "funcao_do_contato": "",
                "telefone": channels["phone"],
                "email": channels["email"],
                "observacoes": (
                    f"CNPJ do estabelecimento: {candidate['cnpj']} ({candidate['branch_type']}). "
                    f"Porte RFB {candidate['rfb_size_code']}. CNAE principal/secundário é apenas sinal de prospecção; "
                    "validar estoque, porte operacional, localização, contato e demanda antes de abordar. "
                    "O município intersecta ao menos um recorte de prospecção, mas esta unidade pode estar fora do raio até a coordenada ser validada. "
                    + " ".join(data_review_notes)
                ),
                "_cnpj_base": candidate["cnpj_base"],
                "prospecting_region_ids": candidate.get("prospecting_region_ids", []),
            })
    rows.sort(key=lambda row: (row["_cnpj_base"], row["unidade"]))
    return rows


def write_crm_batches(output_dir: Path, rows: list[dict]) -> int:
    headers = [
        "empresa", "unidade", "cnpj", "segmento", "porte", "evidencia_do_porte", "fonte_do_porte",
        "municipio", "endereco", "latitude", "longitude", "site", "maps", "prioridade",
        "justificativa_da_prioridade", "fonte", "data_da_fonte", "aderencia", "viabilidade",
        "momento_comercial", "materiais", "contato", "funcao_do_contato", "telefone", "email", "observacoes",
    ]
    batches: list[list[dict]] = []
    batch: list[dict] = []
    index = 0
    while index < len(rows):
        base = rows[index]["_cnpj_base"]
        end = index + 1
        while end < len(rows) and rows[end]["_cnpj_base"] == base:
            end += 1
        group = rows[index:end]
        if len(group) > 100:
            raise RuntimeError(f"Empresa CNPJ {base} tem mais de 100 unidades elegíveis; requer revisão manual antes do importador.")
        if batch and len(batch) + len(group) > 100:
            batches.append(batch)
            batch = []
        batch.extend(group)
        index = end
    if batch:
        batches.append(batch)
    batch_dir = output_dir / "crm-import"
    batch_dir.mkdir(parents=True, exist_ok=True)
    for number, contents in enumerate(batches, start=1):
        filename = batch_dir / f"lote-{number:03d}.csv"
        with filename.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=headers, delimiter=";", extrasaction="ignore")
            writer.writeheader()
            writer.writerows(contents)
    return len(batches)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", help="Carga YYYY-MM; por padrão usa a mais recente completa disponível.")
    parser.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "workgeo-cnpj-cache")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "deliverables" / "prospecting-cnpj")
    parser.add_argument("--regions-file", type=Path, default=ROOT / "data" / "prospecting-regions" / "regions.json")
    parser.add_argument("--skip-download", action="store_true", help="Usa somente ZIPs já presentes no cache.")
    args = parser.parse_args()
    args.cache_dir = args.cache_dir.expanduser().resolve()
    args.output_dir = args.output_dir.expanduser().resolve()
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    if args.skip_download:
        month = args.month or ""
        if not month:
            raise RuntimeError("Informe --month ao usar --skip-download.")
        listing = None
    else:
        month, listing = share_files(args.month)
        names = required_files(listing)
        print(f"Fonte oficial RFB: carga {month}; {len(names)} arquivos necessários.", flush=True)
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = [pool.submit(download_one, month, name, listing[name], args.cache_dir) for name in names]
            for job in as_completed(jobs):
                print(f"Disponível: {job.result().name}", flush=True)
    if not re.fullmatch(r"20\d{2}-\d{2}", month):
        raise RuntimeError("Informe uma carga no formato AAAA-MM.")

    scope_path = ROOT / "data" / "prospecting-territory" / "cnae-scope.json"
    overrides_path = ROOT / "data" / "prospecting-territory" / "rfb-municipality-name-overrides.json"
    regions = json.loads(args.regions_file.read_text(encoding="utf-8"))
    universe = merged_region_universe(regions)
    universe_path = args.regions_file
    scope = json.loads(scope_path.read_text(encoding="utf-8"))
    overrides = json.loads(overrides_path.read_text(encoding="utf-8"))
    cnaes, rfb_names = load_domains(args.cache_dir)
    municipality_codes, applied_overrides, multiple_codes_for_name = target_municipality_codes(universe, rfb_names, overrides)
    candidates, counts = establishment_candidates(
        args.cache_dir, municipality_codes, cnaes, scope["categories"]
    )
    details = load_company_details(args.cache_dir, {item["cnpj_base"] for item in candidates})
    source_date = datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
    prepared = [csv_row(item, details[item["cnpj_base"]], month, source_date) for item in candidates]
    prepared.sort(key=lambda item: (item["municipality"], item["company_name"], item["cnpj"]))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "cnpj", "cnpj_base", "company_name", "unit_name", "branch_type", "rfb_size_code",
        "size_label", "size_confirmed_small", "scope_tier", "categories", "cnae_primary",
        "cnae_primary_description", "cnae_context", "municipality", "municipality_code_ibge",
        "uf", "prospecting_region_ids", "address", "address_type", "street_name", "street_number", "address_complement",
        "neighborhood", "postal_code", "phone", "email", "source_status", "source",
        "source_date", "coordinates_status", "review_status",
    ]
    output = args.output_dir / f"prospecting-cnpj-{month}.csv"
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames, delimiter=";", extrasaction="ignore")
        writer.writeheader()
        for item in prepared:
            writer.writerow(serialize_candidate_csv_row(item))
    crm_rows = crm_import_rows(prepared, month, source_date)
    batch_count = write_crm_batches(args.output_dir, crm_rows)
    region_municipality_counts: dict[tuple[str, str, str], int] = {}
    for item in prepared:
        for region_id in item.get("prospecting_region_ids", []):
            key_tuple = (region_id, item["uf"], item["municipality"])
            region_municipality_counts[key_tuple] = region_municipality_counts.get(key_tuple, 0) + 1
    candidate_counts_by_region_municipality = [
        {"region_id": region_id, "uf": uf, "municipality": municipality, "establishments": count}
        for (region_id, uf, municipality), count in sorted(region_municipality_counts.items())
    ]
    category_counts: dict[str, int] = {}
    size_counts: dict[str, int] = {}
    for item in prepared:
        for category in item["categories"]:
            category_counts[category["label"]] = category_counts.get(category["label"], 0) + 1
        size_code = item["rfb_size_code"] or "Não informado"
        size_counts[size_code] = size_counts.get(size_code, 0) + 1
    report = {
        "source": "Dados Abertos do CNPJ — Receita Federal",
        "source_month": month,
        "source_download_date": source_date,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "territory_file": str(universe_path.relative_to(ROOT)).replace("\\", "/"),
        "territory_municipalities": universe["municipalities_count"],
        "territory_municipality_codes_matched": len(municipality_codes),
        "municipality_name_overrides_applied": applied_overrides,
        "municipality_names_with_multiple_rfb_codes": multiple_codes_for_name,
        "cnae_scope_file": str(scope_path.relative_to(ROOT)).replace("\\", "/"),
        "cnae_categories": scope["categories"],
        "counts": counts,
        "candidate_establishments_by_region_municipality": candidate_counts_by_region_municipality,
        "candidate_establishments_by_cnae_category": category_counts,
        "candidate_establishments_by_rfb_size_code": size_counts,
        "import_contact_data_quality": contact_data_quality(prepared),
        "official_micro_or_small_establishments_ready_for_human_review": len(crm_rows),
        "crm_import_batches_max_100_units_without_splitting_company_groups": batch_count,
        "results_csv": output.name,
        "limits": [
            "O resultado cobre apenas estabelecimentos com CNPJ ativos no snapshot mensal, CNAE principal ou secundário nos prefixos configurados e código municipal reconhecido em municípios que intersectam as regiões de prospecção; a coordenada individual pode ficar fora do raio.",
            "O CNPJ informa microempresa e empresa de pequeno porte; a categoria ‘Demais’ não separa médias de grandes empresas e requer confirmação externa.",
            "CNAE não comprova pilhas, estoque, área, demanda, porte operacional nem interesse comercial.",
            "Como a Receita não publica coordenadas individuais, o filtro municipal inclui endereços de municípios que intersectam a região e pode trazer unidades fora do raio; cada localização deve ser validada antes de classificar como dentro ou plotar.",
            "Esta lista é uma base de descoberta para revisão humana; não cria registros no CRM nem autoriza contato comercial.",
        ],
    }
    (args.output_dir / f"report-{month}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "counts": counts}, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERRO: {error}", file=sys.stderr)
        sys.exit(1)

