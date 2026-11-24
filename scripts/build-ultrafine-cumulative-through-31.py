#!/usr/bin/env python3
"""Build cumulative ultrafine CSVs from the broad pilot and completed batches."""
import csv
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "workgeo-crm" / "deliverables" / "prospecting-cnpj-2026-10"
OUT = BASE / "ultrafine-broad"
CUMULATIVE_OUT = OUT / "cumulative-through-100-31-all-units"
SOURCE = BASE / "prospecting-cnpj-2026-10.csv"
SUGGESTIONS = BASE / "coordinate-suggestions-cnefe-20261029.csv"
DATE = "2026-10-30"
RADIUS = {"belo-horizonte-170km": 170, "volta-redonda-100km": 100, "campinas-250km": 250}
REGION_SOURCE = ROOT / "workgeo-crm" / "data" / "prospecting-regions" / "region-centers.json"
REGION_DATA = {r["id"]: r for r in json.loads(REGION_SOURCE.read_text(encoding="utf-8"))["regions"]}
CENTERS = {rid: (r["center"]["latitude"], r["center"]["longitude"]) for rid, r in REGION_DATA.items()}
RADIUS = {rid: r["radius_km"] for rid, r in REGION_DATA.items()}
PILOT_SELECTED = OUT / "leads-ultrafine-broad-selected-2026-10.csv"
PILOT_PENDING = OUT / "leads-ultrafine-broad-pending-2026-10.csv"
BATCH_FILES = [
    (OUT / "batch-100-01-belo-horizonte-manifest.json", OUT / "batch-100-01-belo-horizonte-research.json"),
    (OUT / "batch-100-01-volta-redonda-manifest.json", OUT / "batch-100-01-volta-redonda-research.json"),
    (OUT / "batch-100-01-campinas-manifest.json", OUT / "batch-100-01-campinas-research.json"),
    (OUT / "batch-100-02-belo-horizonte-manifest.json", OUT / "batch-100-02-belo-horizonte-research.json"),
    (OUT / "batch-100-02-volta-redonda-manifest.json", OUT / "batch-100-02-volta-redonda-research.json"),
    (OUT / "batch-100-02-campinas-manifest.json", OUT / "batch-100-02-campinas-research.json"),
    (OUT / "batch-100-03-belo-horizonte-manifest.json", OUT / "batch-100-03-belo-horizonte-research.json"),
    (OUT / "batch-100-03-volta-redonda-manifest.json", OUT / "batch-100-03-volta-redonda-research.json"),
    (OUT / "batch-100-03-campinas-manifest.json", OUT / "batch-100-03-campinas-research.json"),
    (OUT / "batch-100-04-belo-horizonte-manifest.json", OUT / "batch-100-04-belo-horizonte-research.json"),
    (OUT / "batch-100-04-volta-redonda-manifest.json", OUT / "batch-100-04-volta-redonda-research.json"),
    (OUT / "batch-100-04-campinas-manifest.json", OUT / "batch-100-04-campinas-research.json"),
    (OUT / "batch-100-05-belo-horizonte-manifest.json", OUT / "batch-100-05-belo-horizonte-research.json"),
    (OUT / "batch-100-05-volta-redonda-manifest.json", OUT / "batch-100-05-volta-redonda-research.json"),
    (OUT / "batch-100-05-campinas-manifest.json", OUT / "batch-100-05-campinas-research.json"),
    (OUT / "batch-100-06-belo-horizonte-manifest.json", OUT / "batch-100-06-belo-horizonte-research.json"),
    (OUT / "batch-100-06-volta-redonda-manifest.json", OUT / "batch-100-06-volta-redonda-research.json"),
    (OUT / "batch-100-06-campinas-manifest.json", OUT / "batch-100-06-campinas-research.json"),
    (OUT / "batch-100-07-belo-horizonte-manifest.json", OUT / "batch-100-07-belo-horizonte-research.json"),
    (OUT / "batch-100-07-volta-redonda-manifest.json", OUT / "batch-100-07-volta-redonda-research.json"),
    (OUT / "batch-100-07-campinas-manifest.json", OUT / "batch-100-07-campinas-research.json"),
    (OUT / "batch-100-08-belo-horizonte-manifest.json", OUT / "batch-100-08-belo-horizonte-research.json"),
    (OUT / "batch-100-08-volta-redonda-manifest.json", OUT / "batch-100-08-volta-redonda-research.json"),
    (OUT / "batch-100-08-campinas-manifest.json", OUT / "batch-100-08-campinas-research.json"),
    (OUT / "batch-100-09-belo-horizonte-manifest.json", OUT / "batch-100-09-belo-horizonte-research.json"),
    (OUT / "batch-100-09-volta-redonda-manifest.json", OUT / "batch-100-09-volta-redonda-research.json"),
    (OUT / "batch-100-09-campinas-manifest.json", OUT / "batch-100-09-campinas-research.json"),
    (OUT / "batch-100-10-belo-horizonte-manifest.json", OUT / "batch-100-10-belo-horizonte-research.json"),
    (OUT / "batch-100-10-volta-redonda-manifest.json", OUT / "batch-100-10-volta-redonda-research.json"),
    (OUT / "batch-100-10-campinas-manifest.json", OUT / "batch-100-10-campinas-research.json"),
    (OUT / "batch-100-11-belo-horizonte-manifest.json", OUT / "batch-100-11-belo-horizonte-research.json"),
    (OUT / "batch-100-11-volta-redonda-manifest.json", OUT / "batch-100-11-volta-redonda-research.json"),
    (OUT / "batch-100-11-campinas-manifest.json", OUT / "batch-100-11-campinas-research.json"),
    (OUT / "batch-100-12-belo-horizonte-manifest.json", OUT / "batch-100-12-belo-horizonte-research.json"),
    (OUT / "batch-100-12-volta-redonda-manifest.json", OUT / "batch-100-12-volta-redonda-research.json"),
    (OUT / "batch-100-12-campinas-manifest.json", OUT / "batch-100-12-campinas-research.json"),
    (OUT / "batch-100-13-belo-horizonte-manifest.json", OUT / "batch-100-13-belo-horizonte-research.json"),
    (OUT / "batch-100-13-volta-redonda-manifest.json", OUT / "batch-100-13-volta-redonda-research.json"),
    (OUT / "batch-100-13-campinas-manifest.json", OUT / "batch-100-13-campinas-research.json"),
    (OUT / "batch-100-14-belo-horizonte-manifest.json", OUT / "batch-100-14-belo-horizonte-research.json"),
    (OUT / "batch-100-14-volta-redonda-manifest.json", OUT / "batch-100-14-volta-redonda-research.json"),
    (OUT / "batch-100-14-campinas-manifest.json", OUT / "batch-100-14-campinas-research.json"),
    (OUT / "batch-100-15-belo-horizonte-manifest.json", OUT / "batch-100-15-belo-horizonte-research.json"),
    (OUT / "batch-100-15-volta-redonda-manifest.json", OUT / "batch-100-15-volta-redonda-research.json"),
    (OUT / "batch-100-15-campinas-manifest.json", OUT / "batch-100-15-campinas-research.json"),
    (OUT / "batch-100-16-belo-horizonte-manifest.json", OUT / "batch-100-16-belo-horizonte-research.json"),
    (OUT / "batch-100-16-volta-redonda-manifest.json", OUT / "batch-100-16-volta-redonda-research.json"),
    (OUT / "batch-100-16-campinas-manifest.json", OUT / "batch-100-16-campinas-research.json"),
    (OUT / "batch-100-17-belo-horizonte-manifest.json", OUT / "batch-100-17-belo-horizonte-research.json"),
    (OUT / "batch-100-17-volta-redonda-manifest.json", OUT / "batch-100-17-volta-redonda-research.json"),
    (OUT / "batch-100-17-campinas-manifest.json", OUT / "batch-100-17-campinas-research.json"),
    (OUT / "batch-100-18-belo-horizonte-manifest.json", OUT / "batch-100-18-belo-horizonte-research.json"),
    (OUT / "batch-100-18-volta-redonda-manifest.json", OUT / "batch-100-18-volta-redonda-research.json"),
    (OUT / "batch-100-18-campinas-manifest.json", OUT / "batch-100-18-campinas-research.json"),
    (OUT / "batch-100-19-belo-horizonte-manifest.json", OUT / "batch-100-19-belo-horizonte-research.json"),
    (OUT / "batch-100-19-volta-redonda-manifest.json", OUT / "batch-100-19-volta-redonda-research.json"),
    (OUT / "batch-100-19-campinas-manifest.json", OUT / "batch-100-19-campinas-research.json"),
    (OUT / "batch-100-20-belo-horizonte-manifest.json", OUT / "batch-100-20-belo-horizonte-research.json"),
    (OUT / "batch-100-20-volta-redonda-manifest.json", OUT / "batch-100-20-volta-redonda-research.json"),
    (OUT / "batch-100-20-campinas-manifest.json", OUT / "batch-100-20-campinas-research.json"),
    (OUT / "batch-100-21-belo-horizonte-manifest.json", OUT / "batch-100-21-belo-horizonte-research.json"),
    (OUT / "batch-100-21-volta-redonda-manifest.json", OUT / "batch-100-21-volta-redonda-research.json"),
    (OUT / "batch-100-21-campinas-manifest.json", OUT / "batch-100-21-campinas-research.json"),
    (OUT / "batch-100-22-belo-horizonte-manifest.json", OUT / "batch-100-22-belo-horizonte-research.json"),
    (OUT / "batch-100-22-volta-redonda-manifest.json", OUT / "batch-100-22-volta-redonda-research.json"),
    (OUT / "batch-100-22-campinas-manifest.json", OUT / "batch-100-22-campinas-research.json"),
    (OUT / "batch-100-23-belo-horizonte-manifest.json", OUT / "batch-100-23-belo-horizonte-research.json"),
    (OUT / "batch-100-23-volta-redonda-manifest.json", OUT / "batch-100-23-volta-redonda-research.json"),
    (OUT / "batch-100-23-campinas-manifest.json", OUT / "batch-100-23-campinas-research.json"),
    (OUT / "batch-100-24-belo-horizonte-manifest.json", OUT / "batch-100-24-belo-horizonte-research.json"),
    (OUT / "batch-100-24-volta-redonda-manifest.json", OUT / "batch-100-24-volta-redonda-research.json"),
    (OUT / "batch-100-24-campinas-manifest.json", OUT / "batch-100-24-campinas-research.json"),
    (OUT / "batch-100-25-belo-horizonte-manifest.json", OUT / "batch-100-25-belo-horizonte-research.json"),
    (OUT / "batch-100-25-volta-redonda-manifest.json", OUT / "batch-100-25-volta-redonda-research.json"),
    (OUT / "batch-100-25-campinas-manifest.json", OUT / "batch-100-25-campinas-research.json"),
    (OUT / "batch-100-26-belo-horizonte-manifest.json", OUT / "batch-100-26-belo-horizonte-research.json"),
    (OUT / "batch-100-26-volta-redonda-manifest.json", OUT / "batch-100-26-volta-redonda-research.json"),
    (OUT / "batch-100-26-campinas-manifest.json", OUT / "batch-100-26-campinas-research.json"),
    (OUT / "batch-100-27-belo-horizonte-manifest.json", OUT / "batch-100-27-belo-horizonte-research.json"),
    (OUT / "batch-100-27-volta-redonda-manifest.json", OUT / "batch-100-27-volta-redonda-research.json"),
    (OUT / "batch-100-27-campinas-manifest.json", OUT / "batch-100-27-campinas-research.json"),
    (OUT / "batch-100-28-belo-horizonte-manifest.json", OUT / "batch-100-28-belo-horizonte-research.json"),
    (OUT / "batch-100-28-volta-redonda-manifest.json", OUT / "batch-100-28-volta-redonda-research.json"),
    (OUT / "batch-100-28-campinas-manifest.json", OUT / "batch-100-28-campinas-research.json"),
    (OUT / "batch-100-29-belo-horizonte-manifest.json", OUT / "batch-100-29-belo-horizonte-research.json"),
    (OUT / "batch-100-29-volta-redonda-manifest.json", OUT / "batch-100-29-volta-redonda-research.json"),
    (OUT / "batch-100-29-campinas-manifest.json", OUT / "batch-100-29-campinas-research.json"),
    (OUT / "batch-100-30-belo-horizonte-manifest.json", OUT / "batch-100-30-belo-horizonte-research.json"),
    (OUT / "batch-100-30-volta-redonda-manifest.json", OUT / "batch-100-30-volta-redonda-research.json"),
    (OUT / "batch-100-30-campinas-manifest.json", OUT / "batch-100-30-campinas-research.json"),
    (OUT / "batch-100-31-belo-horizonte-manifest.json", OUT / "batch-100-31-belo-horizonte-research.json"),
    (OUT / "batch-100-31-volta-redonda-manifest.json", OUT / "batch-100-31-volta-redonda-research.json"),
    (OUT / "batch-100-31-campinas-manifest.json", OUT / "batch-100-31-campinas-research.json"),
]
RESEARCH_FIELDS = [
    "research_region_id", "research_region_name", "research_batch", "research_status", "status_reason",
    "operational_evidence", "materials_or_stock", "size_assessment", "public_contact_assessment",
    "public_channel_usable", "address_assessment", "operational_address_confirmed", "latitude_confirmed",
    "longitude_confirmed", "coordinate_reference_latitude", "coordinate_reference_longitude", "coordinate_source",
    "coordinate_scope", "coordinate_confidence", "coordinate_status", "latitude_suggested", "longitude_suggested",
    "distance_km_suggested", "suggested_point_within_radius", "distance_km_confirmed", "within_radius_confirmed", "research_name_reference",
    "company_name_match_status", "research_sources", "research_date", "research_notes",
]
RESEARCH_BOOLEAN_FIELDS = {
    "public_channel_usable", "operational_address_confirmed", "within_radius_confirmed"
}


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def digits(s):
    return "".join(c for c in str(s or "") if c.isdigit())


def records(path):
    obj = json.loads(path.read_text(encoding="utf-8"))
    return obj.get("records", []) if isinstance(obj, dict) else obj


def region_ids(value):
    try:
        parsed = json.loads(value or "[]") if isinstance(value, str) else value
    except (TypeError, json.JSONDecodeError):
        return []
    return [rid for rid in parsed if rid in RADIUS] if isinstance(parsed, list) else []


def load_suggestions(target_cnpjs):
    result = {}
    if not target_cnpjs:
        return result
    with SUGGESTIONS.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            cnpj = digits(row.get("cnpj"))
            if cnpj not in target_cnpjs or cnpj in result:
                continue
            try:
                lat, lon = float(row["latitude"]), float(row["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            if math.isfinite(lat) and math.isfinite(lon):
                result[cnpj] = {**row, "latitude": lat, "longitude": lon}
    return result


def normalize_status(s):
    x = str(s or "").strip().lower()
    return {"selected": "selecionada", "selecionado": "selecionada", "selecionada": "selecionada", "pending": "pendente", "pendente": "pendente", "outside": "fora_do_perfil", "fora do perfil": "fora_do_perfil"}.get(x, x)


def coordinate_is_suggestion(source, scope):
    text = f"{source or ''} {scope or ''}".lower()
    if any(token in text for token in (
        "coordenadas projetadas", "coordenada municipal declarada",
        "coordenada oficial do empreendimento", "pino indicado pelo site",
        "pino do google maps aberto pelo link",
    )):
        return False
    return any(token in text for token in (
        "cnefe", "nominatim",
        "trecho de via", "trecho da rua", "ponto aproximado", "ponto de endereço/lote aproximado", "ponto sugerido",
        "geocodifica", "sugerido", "sugestão", "suggestion",
    ))


def distance(lat, lon, center):
    p1, p2 = math.radians(lat), math.radians(center[0])
    dp, dl = p2 - p1, math.radians(center[1] - lon)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def load_batch():
    expected, researched = {}, {}
    research_batch_by_key = {}
    research_batch_by_base = {}
    selected_cn = set()
    manifest_summary = []
    for manifest_path, research_path in BATCH_FILES:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        groups = manifest.get("groups") or manifest.get("selected_bases") or manifest.get("bases") or manifest.get("candidates") or []
        local = set()
        for group in groups:
            base = digits(group["cnpj_base"])
            unit = group.get("selected_unit")
            if unit is None:
                units = group.get("units", [])
                if len(units) != 1:
                    raise ValueError(f"Lote deve selecionar exatamente uma unidade por base: {base}")
                unit = units[0]
            cnpj = digits(unit["cnpj"])
            if cnpj[:8] != base:
                raise ValueError(f"Unidade diverge da base: {cnpj}")
            research_batch_by_base[base] = manifest.get("batch", research_path.stem)
            regions = unit.get("prospecting_region_ids", unit.get("region_ids", unit.get("regions", [])))
            if isinstance(regions, str):
                regions = json.loads(regions)
            for region in regions:
                key = (cnpj, region)
                if key in expected:
                    raise ValueError(f"Duplicidade CNPJ/região em manifestos: {key}")
                expected[key] = base
                selected_cn.add(cnpj)
                local.add(key)
        for item in records(research_path):
            cnpj = digits(item.get("cnpj"))
            # A batch record represents one CNPJ-region link. Some researchers
            # also repeat the CNPJ's full region list on each link; prefer the
            # explicit per-record region to avoid duplicating those links.
            regions = [item.get("region")] if item.get("region") else (item.get("region_ids") or [])
            for region in regions:
                if region not in RADIUS:
                    aliases = {"Belo Horizonte": "belo-horizonte-170km", "Volta Redonda": "volta-redonda-100km", "Campinas": "campinas-250km"}
                    region = aliases.get(region, region)
                key = (cnpj, region)
                if key not in expected:
                    raise ValueError(f"Pesquisa fora do manifesto: {key}")
                if key in researched:
                    raise ValueError(f"Pesquisa CNPJ/região duplicada: {key}")
                researched[key] = item
                research_batch_by_key[key] = manifest.get("batch", research_path.stem)
        manifest_summary.append({"manifest": manifest_path.name, "research": research_path.name, "base_groups": len(groups), "links": len(local)})
    if set(expected) != set(researched):
        missing = sorted(set(expected) - set(researched))[:5]
        extra = sorted(set(researched) - set(expected))[:5]
        raise ValueError(f"Manifesto/pesquisa divergentes; faltantes={missing}; extras={extra}")
    source = {}
    with SOURCE.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            cnpj = digits(row["cnpj"])
            if cnpj in selected_cn:
                source[cnpj] = row
                if len(source) == len(selected_cn):
                    break
    if set(source) != selected_cn:
        raise ValueError(f"CNPJs ausentes da base ampla: {sorted(selected_cn-set(source))[:10]}")
    return source, expected, researched, manifest_summary, research_batch_by_key, research_batch_by_base


def main():
    CUMULATIVE_OUT.mkdir(exist_ok=True)
    source, expected, research, manifest_summary, research_batch_by_key, research_batch_by_base = load_batch()
    with PILOT_SELECTED.open(encoding="utf-8-sig", newline="") as f:
        pilot_selected = list(csv.DictReader(f, delimiter=";"))
        fields = list(pilot_selected[0])
    with PILOT_PENDING.open(encoding="utf-8-sig", newline="") as f:
        pilot_pending = list(csv.DictReader(f, delimiter=";"))
    out = []
    for key in sorted(research):
        cnpj, region = key
        item = research[key]
        row = dict(source[cnpj])
        status = normalize_status(item.get("status"))
        if status not in {"selecionada", "pendente", "fora_do_perfil"}:
            raise ValueError(f"Status desconhecido em {key}: {item.get('status')}")
        lat, lon = item.get("latitude"), item.get("longitude")
        dist = distance(float(lat), float(lon), CENTERS[region]) if lat is not None and lon is not None else None
        declared_distance = item.get("distance_km")
        if dist is not None and declared_distance is not None and abs(float(declared_distance) - dist) > 0.05:
            raise ValueError(f"Distância declarada diverge do recálculo: {key}; declarada={declared_distance}, recalculada={dist:.2f}")
        within = item.get("within_radius_confirmed") is True
        operational_address_confirmed = item.get("operational_address_confirmed") is True
        coordinate_scope = item.get("coordinate_scope", "")
        coordinate_source = item.get("coordinate_source", "")
        coordinate_confirmed = lat is not None and lon is not None and not coordinate_is_suggestion(coordinate_source, coordinate_scope)
        if lat is not None and lon is not None and not operational_address_confirmed and "suger" not in coordinate_scope.lower():
            coordinate_scope = "Ponto sugerido/indicativo, sem confirmação de operação; " + coordinate_scope
        if status == "selecionada":
            actual_distance = distance(float(lat), float(lon), CENTERS[region])
            if abs(dist - actual_distance) > 0.01:
                raise ValueError(f"Distância declarada diverge do recálculo: {key}; declarada={dist:.2f}, recalculada={actual_distance:.2f}")
            dist = actual_distance
        if status == "selecionada":
            required = [item.get("public_channel_usable") is True, within, lat is not None, lon is not None,
                        item.get("coordinate_source"), item.get("coordinate_scope"), item.get("source_urls")]
            if not all(required):
                raise ValueError(f"Selecionada sem requisitos mínimos: {key}")
            if dist > RADIUS[region] + 0.05:
                raise ValueError(f"Selecionada fora do raio recalculado: {key}, {dist:.2f} km")
        if status == "fora_do_perfil":
            required = [item.get("operational_address_confirmed") is True, lat is not None, lon is not None,
                        item.get("coordinate_source"), item.get("coordinate_scope"), item.get("source_urls")]
            if not all(required):
                raise ValueError(f"Fora do raio sem endereço operacional, coordenada e fonte: {key}")
            if within or dist <= RADIUS[region]:
                raise ValueError(f"Fora do raio diverge da coordenada ou do limite: {key}, {dist:.2f} km")
        row.update({
            "research_region_id": region,
            "research_region_name": {"belo-horizonte-170km": "Belo Horizonte (170 km)", "volta-redonda-100km": "Volta Redonda (100 km)", "campinas-250km": "Campinas (250 km)"}[region],
            "research_batch": research_batch_by_key[key], "research_status": status,
            "status_reason": item.get("evidence", ""), "operational_evidence": item.get("evidence", ""),
            "materials_or_stock": item.get("materials_or_stock", ""), "size_assessment": item.get("size_assessment", ""),
            "public_contact_assessment": item.get("public_contact_assessment", ""),
            "public_channel_usable": str(item.get("public_channel_usable") is True).lower(),
            "address_assessment": item.get("address_assessment", ""),
            "operational_address_confirmed": str(operational_address_confirmed).lower(),
            "latitude_confirmed": lat if coordinate_confirmed else "",
            "longitude_confirmed": lon if coordinate_confirmed else "",
            "latitude_suggested": lat if lat is not None and not coordinate_confirmed else "",
            "longitude_suggested": lon if lon is not None and not coordinate_confirmed else "",
            "coordinate_reference_latitude": CENTERS[region][0], "coordinate_reference_longitude": CENTERS[region][1],
            "coordinate_source": coordinate_source, "coordinate_scope": coordinate_scope,
            "coordinate_confidence": item.get("coordinate_confidence", ""),
            "coordinate_status": "confirmed_source_point" if coordinate_confirmed else ("suggestion_only" if lat is not None and lon is not None else "not_found"),
            "distance_km_suggested": f"{dist:.2f}" if dist is not None and not coordinate_confirmed else "",
            "suggested_point_within_radius": str(dist <= RADIUS[region]).lower() if dist is not None and not coordinate_confirmed else "",
            "distance_km_confirmed": f"{dist:.2f}" if dist is not None and coordinate_confirmed else "",
            "within_radius_confirmed": str(within).lower(), "research_name_reference": item.get("company_name", ""),
            "company_name_match_status": item.get("company_name_match_status", "Correspondência descrita na evidência; revisar manualmente"),
            "research_sources": " | ".join(item.get("source_urls", [])), "research_date": DATE,
            "research_notes": item.get("notes", ""),
        })
        out.append(row)
    researched_rows = len(out)
    pilot_rows = pilot_selected + pilot_pending
    sampled_bases = {digits(r.get("cnpj_base")) for r in pilot_rows + out}
    existing_keys = {(digits(r.get("cnpj")), r.get("research_region_id")) for r in pilot_rows + out if r.get("research_region_id") in RADIUS}
    extra_source_rows = []
    source_links = set()
    supplemental_cnpjs = set()
    with SOURCE.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            base, cnpj = digits(row.get("cnpj_base")), digits(row.get("cnpj"))
            if base not in sampled_bases:
                continue
            for region in region_ids(row.get("prospecting_region_ids", "")):
                key = (cnpj, region)
                source_links.add(key)
                if key not in existing_keys:
                    extra_source_rows.append((base, cnpj, region, row))
                    supplemental_cnpjs.add(cnpj)
    cnefe = load_suggestions(supplemental_cnpjs)
    supplementary = []
    for base, cnpj, region, source_row in extra_source_rows:
        point = cnefe.get(cnpj)
        lat = point.get("latitude") if point else None
        lon = point.get("longitude") if point else None
        suggested_distance = distance(lat, lon, CENTERS[region]) if lat is not None and lon is not None else None
        complement = (source_row.get("address_complement") or "").strip()
        house_note = (f" Complemento cadastral contém '{complement}'; verificar o local sem presumir residência nem excluir automaticamente." if "CASA" in complement.upper() else "")
        coordinate_source = (f"IBGE CNEFE 2022 — {point.get('source','')}; referência {point.get('source_date','')}" if point else "")
        coordinate_scope = ("Sugestão geográfica do endereço cadastral; não confirma endereço operacional, instalação, pátio ou estoque." if point else "Sem ponto individual disponível nesta fonte; localização e raio pendentes.")
        row = dict(source_row)
        row.update({
            "research_region_id": region,
            "research_region_name": {"belo-horizonte-170km": "Belo Horizonte (170 km)", "volta-redonda-100km": "Volta Redonda (100 km)", "campinas-250km": "Campinas (250 km)"}[region],
            "research_batch": research_batch_by_base.get(base, "PILOTO-AMPLA"),
            "research_status": "pendente",
            "status_reason": "Unidade adicional de um CNPJ-base já amostrado; pendente de pesquisa pública individual. Evidências de outra filial ou da empresa não foram transferidas para esta unidade.",
            "operational_evidence": "Não pesquisada individualmente nesta etapa; atividade, porte e endereço são apenas dados cadastrais da RFB.",
            "materials_or_stock": "Não confirmados para esta unidade; não inferir estoque, materiais armazenados ou volumetria a partir de outra unidade.",
            "size_assessment": f"Porte cadastral RFB: {source_row.get('size_label','DESCONHECIDO')}; porte operacional desta unidade não pesquisado.",
            "public_contact_assessment": "Telefone/e-mail eventualmente presentes são dados cadastrais RFB; canal comercial público desta unidade não validado.",
            "public_channel_usable": "false",
            "address_assessment": f"Endereço cadastral RFB: {source_row.get('address','')}, {source_row.get('neighborhood','')}, {source_row.get('municipality','')}/{source_row.get('uf','')}; endereço operacional não confirmado.{house_note}",
            "operational_address_confirmed": "false",
            "latitude_confirmed": "", "longitude_confirmed": "",
            "latitude_suggested": lat if lat is not None else "",
            "longitude_suggested": lon if lon is not None else "",
            "coordinate_reference_latitude": CENTERS[region][0], "coordinate_reference_longitude": CENTERS[region][1],
            "coordinate_source": coordinate_source,
            "coordinate_scope": coordinate_scope,
            "coordinate_confidence": point.get("confidence", "") if point else "",
            "coordinate_status": "suggestion_only" if point else "not_found",
            "distance_km_suggested": f"{suggested_distance:.2f}" if suggested_distance is not None else "",
            "suggested_point_within_radius": str(suggested_distance <= RADIUS[region]).lower() if suggested_distance is not None else "",
            "distance_km_confirmed": "",
            "within_radius_confirmed": "false",
            "research_name_reference": source_row.get("company_name", ""),
            "company_name_match_status": "Identidade cadastral RFB; vínculo com unidade operacional atual não pesquisado.",
            "research_sources": "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos/cadastros" + (" | https://censo2022.ibge.gov.br/" if point else ""),
            "research_date": "",
            "research_notes": "PENDENTE — unidade adicional da base amostrada, ainda sem pesquisa individual; dados RFB/CNEFE não demonstram operação nem coordenada operacional.",
        })
        supplementary.append(row)
    supplemental_keys = {(digits(r.get("cnpj")), r.get("research_region_id")) for r in supplementary}
    if source_links != existing_keys | supplemental_keys:
        raise ValueError(f"Cobertura das unidades de bases amostradas diverge da fonte: faltam={len(source_links-(existing_keys|supplemental_keys))}, extras={len((existing_keys|supplemental_keys)-source_links)}")
    all_rows = pilot_rows + out + supplementary
    seen = set()
    for row in all_rows:
        key = (digits(row.get("cnpj")), row.get("research_region_id"))
        if key in seen:
            raise ValueError(f"Duplicidade acumulada CNPJ/região: {key}")
        seen.add(key)
        row.setdefault("research_region_id", "")
        row["research_status"] = normalize_status(row.get("research_status"))
        region = row.get("research_region_id")
        if region in CENTERS:
            row["coordinate_reference_latitude"], row["coordinate_reference_longitude"] = CENTERS[region]
            lat, lon = row.get("latitude_confirmed"), row.get("longitude_confirmed")
            op_address = str(row.get("operational_address_confirmed", "")).lower() == "true"
            point_is_suggestion = coordinate_is_suggestion(row.get("coordinate_source"), row.get("coordinate_scope"))
            if not op_address:
                if lat not in (None, "") and lon not in (None, ""):
                    row["latitude_suggested"], row["longitude_suggested"] = lat, lon
                row["latitude_confirmed"], row["longitude_confirmed"] = "", ""
                row["distance_km_confirmed"] = ""
                slat, slon = row.get("latitude_suggested"), row.get("longitude_suggested")
                if slat not in (None, "") and slon not in (None, ""):
                    sd = distance(float(slat), float(slon), CENTERS[region])
                    row["distance_km_suggested"] = f"{sd:.2f}"
                    row["suggested_point_within_radius"] = str(sd <= RADIUS[region]).lower()
                    row["coordinate_status"] = "suggestion_only"
                else:
                    row["coordinate_status"] = row.get("coordinate_status") or "not_found"
            elif point_is_suggestion:
                if lat not in (None, "") and lon not in (None, ""):
                    row["latitude_suggested"], row["longitude_suggested"] = lat, lon
                row["latitude_confirmed"], row["longitude_confirmed"] = "", ""
                row["distance_km_confirmed"] = ""
                row["coordinate_status"] = "suggestion_only"
                slat, slon = row.get("latitude_suggested"), row.get("longitude_suggested")
                if slat not in (None, "") and slon not in (None, ""):
                    sd = distance(float(slat), float(slon), CENTERS[region])
                    row["distance_km_suggested"] = f"{sd:.2f}"
                    row["suggested_point_within_radius"] = str(sd <= RADIUS[region]).lower()
            elif lat not in (None, "") and lon not in (None, ""):
                row["coordinate_status"] = "confirmed_source_point"
            elif row.get("latitude_suggested") not in (None, "") and row.get("longitude_suggested") not in (None, ""):
                row["coordinate_status"] = "suggestion_only"
                slat, slon = row["latitude_suggested"], row["longitude_suggested"]
                sd = distance(float(slat), float(slon), CENTERS[region])
                row["distance_km_suggested"] = f"{sd:.2f}"
                row["suggested_point_within_radius"] = str(sd <= RADIUS[region]).lower()
            if row["research_status"] == "selecionada":
                point_lat = lat if lat not in (None, "") else row.get("latitude_suggested")
                point_lon = lon if lon not in (None, "") else row.get("longitude_suggested")
                if point_lat in (None, "") or point_lon in (None, ""):
                    raise ValueError(f"Selecionada sem coordenada: {key}")
                dist = distance(float(point_lat), float(point_lon), CENTERS[region])
                if dist > RADIUS[region] + 0.05:
                    raise ValueError(f"Selecionada fora do raio recalculado: {key}, {dist:.2f} km")
                if row.get("coordinate_status") == "suggestion_only":
                    row["distance_km_suggested"] = f"{dist:.2f}"
                    row["suggested_point_within_radius"] = "true"
                else:
                    row["distance_km_confirmed"] = f"{dist:.2f}"
                row["within_radius_confirmed"] = "true"
    selected = [r for r in all_rows if normalize_status(r.get("research_status")) == "selecionada"]
    pending = [r for r in all_rows if normalize_status(r.get("research_status")) == "pendente"]
    outside = [r for r in all_rows if normalize_status(r.get("research_status")) == "fora_do_perfil"]
    unique_cnpjs = {digits(r.get("cnpj")) for r in all_rows}
    unique_bases = {digits(r.get("cnpj_base")) for r in all_rows}
    cross_region_cnpjs = Counter(digits(r.get("cnpj")) for r in all_rows)
    cross_region_count = sum(count > 1 for count in cross_region_cnpjs.values())
    fields = list(dict.fromkeys(fields + RESEARCH_FIELDS))
    for name, rows in [("leads-ultrafine-cumulative-selected-2026-10.csv", selected),
                       ("leads-ultrafine-cumulative-pending-2026-10.csv", pending),
                       ("leads-ultrafine-cumulative-outside-2026-10.csv", outside)]:
        path = CUMULATIVE_OUT / name
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fields, delimiter=";", extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
    counts = Counter(row["research_region_id"] for row in all_rows)
    md = ["# Peneira ultrafina WorkGeo — piloto e lotes acumulados", "", f"**Data de corte:** {DATE}. Arquivos desta versão em `{CUMULATIVE_OUT.relative_to(ROOT).as_posix()}`; os CSVs anteriores na pasta-pai foram mantidos, mas esta versão é a mais recente. CRM/Turso/site não alterados.", "",
          "## Escopo", "", f"Base: 1.062.956 estabelecimentos / 996.532 CNPJs-base. Inclui piloto de 30 grupos empresariais e lotes 100-01 a 100-{len(manifest_summary)//3:02d}, com {100 * (len(manifest_summary)//3)} bases empresariais priorizadas. A pesquisa pública detalhada foi feita em uma unidade representativa por base; todas as outras unidades dessas mesmas bases foram preservadas individualmente como pendentes, sem herdar evidência de outra filial.", "", "Seleção exige operação da unidade sustentada por evidência pública, localização individual dentro do raio e canal comercial público utilizável. Pendências permanecem visíveis; ausência de evidência não é tratada como reprovação definitiva.", "",
          "Porte operacional desconhecido e ausência de sugestão CNEFE não são eliminatórios. Pesquisa pública sem contato direto e sem serviço pago. Coordenadas devem ser específicas da unidade; endereço residencial/CASA não foi presumido como operação.",
          "Dados geográficos de OpenStreetMap usados em alguns registros são © OpenStreetMap contributors, licenciados sob ODbL; os pontos representam as feições descritas em cada linha e não implicam o limite completo do terreno. Atribuição: https://www.openstreetmap.org/copyright.", "",
          "## Resultado acumulado", "", f"- Vínculos CNPJ-região pesquisados: {len(all_rows)}.", f"- CNPJs de estabelecimento únicos: {len(unique_cnpjs)} ({cross_region_count} aparecem em mais de uma região e foram preservados por vínculo).", f"- CNPJs-base únicos: {len(unique_bases)}.", f"- Selecionadas: {len(selected)}.", f"- Pendentes: {len(pending)}.", f"- Fora do perfil: {len(outside)}.", "", "| Região | Vínculos pesquisados | Selecionadas | Pendentes | Fora do perfil |", "|---|---:|---:|---:|---:|"]
    for rid, label in [("belo-horizonte-170km", "Belo Horizonte"), ("volta-redonda-100km", "Volta Redonda"), ("campinas-250km", "Campinas")]:
        rows = [r for r in all_rows if r.get("research_region_id") == rid]
        md.append(f"| {label} | {len(rows)} | {sum(normalize_status(r.get('research_status')) == 'selecionada' for r in rows)} | {sum(normalize_status(r.get('research_status')) == 'pendente' for r in rows)} | {sum(normalize_status(r.get('research_status')) == 'fora_do_perfil' for r in rows)} |")
    md += ["", "## Lotes concluídos", "", "| Manifesto | Pesquisa | Bases | Vínculos |", "|---|---|---:|---:|"]
    md += [f"| {x['manifest']} | {x['research']} | {x['base_groups']} | {x['links']} |" for x in manifest_summary]
    recent_batches = {f"batch-100-{n:02d}" for n in range(max(1, len(manifest_summary) // 3 - 1), len(manifest_summary) // 3 + 1)}
    recent = [x for x in manifest_summary if any(tag in x["manifest"] for tag in recent_batches)]
    recent_links = sum(x["links"] for x in recent)
    recent_bases = sum(x["base_groups"] for x in recent)
    md += ["", f"Os lotes 100-01 a 100-{len(manifest_summary)//3:02d} têm {100 * (len(manifest_summary)//3)} grupos/base priorizados; por associações multi-regionais, esses lotes geraram mais vínculos. Os dois lotes mais recentes somam {recent_bases} CNPJs-base em {recent_links} vínculos."]
    md += ["", "### Selecionadas", ""]
    for r in selected:
        evidence = r.get("operational_evidence", "")
        md.append(f"- **{r.get('company_name')} — CNPJ {r.get('cnpj')} ({r.get('research_region_name')}).** {evidence}")
    missing_research_sources = sum(not r.get("research_sources") for r in all_rows)
    not_individually_researched = sum(not r.get("research_date") for r in all_rows)
    md += ["", "Os campos seguem como referência as 27 unidades originais em `workgeo-crm/deliverables/WorkGeo_CRM_Transicao.xlsx`. Centros/raios e limitações vêm de `workgeo-crm/data/prospecting-regions/region-centers.json`; os centros são referências territoriais aproximadas, não endereços confirmados da WorkGeo. Cada selecionada deve continuar sob revisão humana antes de qualquer uso comercial. CSVs não confirmam intenção ou demanda de compra.", "", f"Unidades adicionais de bases amostradas, sem pesquisa pública individual nesta etapa: {len(supplementary)} vínculos CNPJ-região ({len(supplemental_cnpjs)} unidades). Foram incluídas como pendentes com dados RFB; CNEFE, quando existe, aparece como ponto sugerido em colunas próprias. Não foram transferidas evidências de outra filial.", "", f"Em {missing_research_sources} registros com pesquisa individual, a busca não encontrou fonte pública específica útil para comprovar operação/localização/canal. Esses registros mantêm os dados de identidade e endereço da base RFB, justificativa e data; `research_sources` fica vazio quando não houve URL individual útil. Além disso, {not_individually_researched} vínculos ainda não foram pesquisados individualmente. Isso não significa que a empresa não opere.", "", "## Arquivos e hashes", ""]
    for name in ["leads-ultrafine-cumulative-selected-2026-10.csv", "leads-ultrafine-cumulative-pending-2026-10.csv", "leads-ultrafine-cumulative-outside-2026-10.csv"]:
        p = CUMULATIVE_OUT / name
        md.append(f"- `{name}` — {sum(1 for _ in p.open(encoding='utf-8-sig')) - 1} linhas; SHA-256 `{sha(p)}`.")
    (CUMULATIVE_OUT / "ultrafine-cumulative-report-2026-10.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    meta = {"as_of_date": DATE, "output_directory": CUMULATIVE_OUT.relative_to(ROOT).as_posix(), "source_base": SOURCE.name, "source_base_rows": 1062956, "pilot_rows": 108, "batch_links": researched_rows, "additional_unit_links_not_individually_researched": len(supplementary), "additional_unit_cnpjs": len(supplemental_cnpjs), "all_source_region_links_for_sampled_bases": len(source_links), "batch_manifests": manifest_summary, "total_links": len(all_rows), "unique_establishment_cnpjs": len(unique_cnpjs), "unique_cnpj_bases": len(unique_bases), "cnpjs_in_multiple_regions": cross_region_count, "selected": len(selected), "pending": len(pending), "outside": len(outside), "files": {name: {"sha256": sha(CUMULATIVE_OUT / name)} for name in ["leads-ultrafine-cumulative-selected-2026-10.csv", "leads-ultrafine-cumulative-pending-2026-10.csv", "leads-ultrafine-cumulative-outside-2026-10.csv"]}, "crm_modified": False, "turso_modified": False, "site_modified": False}
    (CUMULATIVE_OUT / "ultrafine-cumulative-metadata-2026-10.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"links": len(all_rows), "selected": len(selected), "pending": len(pending), "outside": len(outside), "regions": counts, "files": meta["files"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

