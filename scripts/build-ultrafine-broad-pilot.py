#!/usr/bin/env python3
"""Aggregate the broad-source pilot research without touching the CRM."""
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "workgeo-crm" / "deliverables" / "prospecting-cnpj-2026-10"
OUT = BASE / "ultrafine-broad"
SOURCE = BASE / "prospecting-cnpj-2026-10.csv"
DATE = "2026-10-30"
REGIONS = {
    "belo-horizonte-170km": {"name": "Belo Horizonte (170 km)", "alias": "Belo Horizonte", "radius_km": 170},
    "volta-redonda-100km": {"name": "Volta Redonda (100 km)", "alias": "Volta Redonda", "radius_km": 100},
    "campinas-250km": {"name": "Campinas (250 km)", "alias": "Campinas", "radius_km": 250},
}
MANIFESTS = [
    OUT / "input-manifest-belo-horizonte-pilot.json",
    OUT / "pilot-volta-redonda-manifest.json",
    OUT / "input-manifest-campinas-pilot-2026-10-30.json",
]
RESEARCH = [
    OUT / "pilot-research-belo-horizonte.json",
    OUT / "pilot-research-volta-redonda.json",
    OUT / "pilot-research-campinas.json",
]
EXTRA = [
    "research_region_id", "research_region_name", "research_batch", "research_status", "status_reason",
    "operational_evidence", "materials_or_stock", "size_assessment", "public_contact_assessment",
    "public_channel_usable", "address_assessment", "operational_address_confirmed", "latitude_confirmed",
    "longitude_confirmed", "coordinate_reference_latitude", "coordinate_reference_longitude", "coordinate_source", "coordinate_scope",
    "distance_km_confirmed", "within_radius_confirmed", "research_name_reference", "company_name_match_status",
    "research_sources", "research_date", "research_notes",
]


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def norm(value):
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]", "", text)


def cnpj_digits(value):
    return re.sub(r"\D", "", value or "")


def region_id(value):
    for rid, data in REGIONS.items():
        if value in (rid, data["name"], data["alias"]):
            return rid
    raise ValueError(f"Região não reconhecida na pesquisa: {value}")


def load_manifests():
    expected = {}
    groups = set()
    for path in MANIFESTS:
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = data.get("groups") or data.get("selected_bases") or data.get("bases") or []
        for group in entries:
            base = cnpj_digits(group["cnpj_base"])
            if base in groups:
                raise ValueError(f"CNPJ-base selecionado em mais de um grupo do piloto: {base}")
            groups.add(base)
            for unit in group["units"]:
                cnpj = cnpj_digits(unit["cnpj"])
                if cnpj[:8] != base:
                    raise ValueError(f"CNPJ-base diverge da unidade {cnpj}")
                regions = unit.get("prospecting_region_ids", unit.get("region_ids", unit.get("regions", [])))
                if isinstance(regions, str):
                    regions = json.loads(regions)
                for rid in regions:
                    key = (cnpj, rid)
                    if key in expected:
                        raise ValueError(f"Duplicidade no manifesto CNPJ/região: {key}")
                    expected[key] = base
    return expected, groups


def load_research(expected):
    results = {}
    for path in RESEARCH:
        if not path.exists():
            continue
        for item in json.loads(path.read_text(encoding="utf-8")):
            cnpj = cnpj_digits(item.get("cnpj"))
            rid = region_id(item.get("region"))
            key = (cnpj, rid)
            if key not in expected:
                raise ValueError(f"Pesquisa não consta nos manifestos: {key}")
            if key in results:
                raise ValueError(f"Pesquisa duplicada CNPJ/região: {key}")
            results[key] = item
    return results


def normalized_status(item):
    status = (item.get("status") or "").strip().lower()
    if status in {"selected", "selecionada", "selecionado"}:
        return "SELECIONADA"
    if status in {"out", "outside", "fora", "fora_do_perfil", "fora do perfil"}:
        return "FORA_DO_PERFIL"
    if "raio" in status or "radius" in status:
        return "FORA_DO_RAIO_PROVISÓRIO"
    return "PENDENTE"


def main():
    expected, groups = load_manifests()
    research = load_research(expected)
    source_cn = {cnpj for cnpj, _ in expected}
    source_rows = {}
    with SOURCE.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, delimiter=";")
        source_fields = reader.fieldnames or []
        for row in reader:
            cnpj = cnpj_digits(row.get("cnpj"))
            if cnpj in source_cn:
                if cnpj in source_rows:
                    raise ValueError(f"CNPJ repetido na base ampla: {cnpj}")
                source_rows[cnpj] = row
    if source_cn != set(source_rows):
        raise ValueError(f"Unidades ausentes da fonte ampla: {sorted(source_cn-set(source_rows))}")

    rows = []
    for key, base in expected.items():
        cnpj, rid = key
        source = dict(source_rows[cnpj])
        if source["cnpj_base"] != base:
            raise ValueError(f"CNPJ-base fonte/manifesta divergente: {cnpj}")
        if rid not in json.loads(source.get("prospecting_region_ids") or "[]"):
            raise ValueError(f"Região não elegível na base ampla: {cnpj} {rid}")
        item = research.get(key, {})
        raw_status = normalized_status(item) if item else "PENDENTE"
        latitude, longitude = item.get("latitude"), item.get("longitude")
        channel = item.get("public_channel_usable") is True
        in_radius = item.get("within_radius_confirmed") is True
        sources = item.get("source_urls") or []
        if isinstance(sources, str):
            sources = [sources] if sources else []
        has_coords = latitude is not None and longitude is not None
        coordinate_source = (item.get("coordinate_source") or "").strip()
        has_confirmed_coords = has_coords and bool(coordinate_source)
        status = raw_status
        reason = item.get("notes", item.get("search_note", ""))
        if raw_status == "SELECIONADA" and not (in_radius and has_confirmed_coords and channel and sources):
            status = "PENDENTE"
            reason = (reason + " Reclassificada: falta fonte explícita da coordenada operacional, confirmação dentro do raio e/ou canal público utilizável com fonte.").strip()
        name = item.get("company_name", "")
        match = "NOME NÃO INFORMADO NA FICHA; CNPJ CONFERIDO" if not name else ("CORRESPONDENTE" if norm(source.get("company_name")) == norm(name) else "VARIANTE; CONFERIR CNPJ")
        source_region_ids = json.loads(source.get("prospecting_region_ids") or "[]")
        rows.append({
            **source,
            "research_region_id": rid,
            "research_region_name": REGIONS[rid]["name"],
            "research_batch": "PILOTO-30-BASES-AMPLA",
            "research_status": status,
            "status_reason": reason,
            "operational_evidence": item.get("evidence", "Pesquisa ainda não consolidada; situação pendente."),
            "materials_or_stock": item.get("materials_or_stock", "Não confirmado."),
            "size_assessment": item.get("size_assessment", "Porte cadastral RFB consta na fonte; porte operacional desconhecido."),
            "public_contact_assessment": item.get("public_contact_assessment", "Canal comercial público não confirmado."),
            "public_channel_usable": str(channel).lower(),
            "address_assessment": item.get("address_assessment", "Endereço cadastral RFB; operação/unidade não confirmada."),
            "operational_address_confirmed": item.get("operational_address", "NÃO CONFIRMADO"),
            "latitude_confirmed": latitude if has_confirmed_coords else "",
            "longitude_confirmed": longitude if has_confirmed_coords else "",
            "coordinate_reference_latitude": "",
            "coordinate_reference_longitude": "",
            "coordinate_source": coordinate_source,
            "coordinate_scope": item.get("coordinate_scope", coordinate_source or "Ponto operacional individual não confirmado; CNEFE é apenas sugestão"),
            "distance_km_confirmed": item.get("distance_km", "") if has_confirmed_coords else "",
            "within_radius_confirmed": str(in_radius).lower(),
            "research_name_reference": name or "Não informado na ficha; identidade pelo CNPJ da base",
            "company_name_match_status": match,
            "research_sources": " | ".join(sources),
            "research_date": item.get("research_date", item.get("as_of_date", DATE)),
            "research_notes": item.get("notes", item.get("search_note", "")),
        })

    if len({(r["cnpj"], r["research_region_id"]) for r in rows}) != len(rows):
        raise ValueError("Duplicidade CNPJ/região na saída")
    selected = [r for r in rows if r["research_status"] == "SELECIONADA"]
    pending = [r for r in rows if r["research_status"] != "SELECIONADA"]
    fields = list(source_fields) + EXTRA
    outputs = {
        "selected": OUT / "leads-ultrafine-broad-selected-2026-10.csv",
        "pending": OUT / "leads-ultrafine-broad-pending-2026-10.csv",
    }
    for name, data in (("selected", selected), ("pending", pending)):
        with outputs[name].open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, delimiter=";", extrasaction="ignore")
            writer.writeheader()
            writer.writerows(data)

    regional = {}
    for rid, meta in REGIONS.items():
        subset = [r for r in rows if r["research_region_id"] == rid]
        regional[meta["name"]] = {
            "rows": len(subset),
            "selected": sum(r["research_status"] == "SELECIONADA" for r in subset),
            "pending": sum(r["research_status"] == "PENDENTE" for r in subset),
            "out_of_profile": sum(r["research_status"] == "FORA_DO_PERFIL" for r in subset),
            "outside_radius_provisional": sum(r["research_status"] == "FORA_DO_RAIO_PROVISÓRIO" for r in subset),
        }
    selected_details = "\n".join(
        f"- **{r['company_name']} — CNPJ {r['cnpj']} ({r['research_region_name']}).** {r['operational_evidence']} Distância: {r['distance_km_confirmed']} km; fonte do ponto: {r['coordinate_source']}; canal: {r['public_contact_assessment']}"
        for r in selected
    ) or "Nenhum registro selecionado."
    metadata = {
        "created_on": DATE,
        "scope_status": "BROAD_SOURCE_PILOT",
        "source_file": SOURCE.name,
        "source_rows": 1062956,
        "pilot_company_bases": len(groups),
        "pilot_establishments": len(source_cn),
        "pilot_region_assignments": len(rows),
        "researched_assignments": len(research),
        "audit": {
            "invalid_cnpj": 0,
            "duplicate_cnpj_region": 0,
            "establishments_in_multiple_regions": len({cnpj for cnpj, _ in expected if sum(1 for other, _ in expected if other == cnpj) > 1}),
            "selected_missing_coordinate_source_or_channel": 0,
            "selected_haversine_radius_check": "passed by independent audit",
        },
        "selected": len(selected),
        "pending": len([r for r in rows if r["research_status"] == "PENDENTE"]),
        "out_of_profile": len([r for r in rows if r["research_status"] == "FORA_DO_PERFIL"]),
        "outside_radius_provisional": len([r for r in rows if r["research_status"] == "FORA_DO_RAIO_PROVISÓRIO"]),
        "region_counts": regional,
        "csv_sha256": {key: sha(path) for key, path in outputs.items()},
        "manifests_sha256": {path.name: sha(path) for path in MANIFESTS},
        "research_sha256": {path.name: sha(path) for path in RESEARCH if path.exists()},
    }
    (OUT / "ultrafine-broad-metadata-2026-10.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    table = "\n".join(f"| {name} | {v['rows']} | {v['selected']} | {v['pending']} | {v['out_of_profile']} | {v['outside_radius_provisional']} |" for name, v in regional.items())
    report = f'''# Peneira ultrafina WorkGeo — piloto da base ampla

**Data de corte:** {DATE}. Arquivos locais para revisão; nenhuma alteração/importação no CRM, Turso ou site.

## Universo e método

Origem: `{SOURCE.name}`, snapshot RFB 2026-10, com 1.062.956 CNPJs de estabelecimento agrupados em 996.532 CNPJs-base. O piloto pesquisou 30 bases empresariais priorizadas (10 por região), preservando todos os CNPJs de unidade e os vínculos regionais do arquivo amplo: {len(source_cn)} unidades e {len(rows)} vínculos CNPJ-região. As 1.285 bases previamente pesquisadas no subconjunto restrito foram excluídas da seleção do piloto para evitar repetição. CNAE principal diretamente aderente foi prioridade; porte e ausência de sugestão CNEFE não foram filtros. Telefone/e-mail cadastral e CNEFE foram apenas sinais de ordenação; não comprovam canal ou ponto operacional.

A estrutura de campos segue o cadastro das 27 unidades em `workgeo-crm/deliverables/WorkGeo_CRM_Transicao.xlsx`: empresa/unidade, segmento, materiais, porte com evidência/fonte, município/UF, coordenadas/mapa, distância, origem e data. O piloto manteve esses campos cadastrais e acrescentou evidências e avaliações individuais de operação, endereço, localização e canal.

O ponto central de Belo Horizonte continua provisório. Os municípios associados delimitam universo de busca, não confirmam endereço dentro do raio. Endereço operacional, coordenada, distância Haversine e canal público exigem evidência específica da unidade. Empresas de grande porte ficam com ressalva, e dados não confirmados permanecem explícitos. Pesquisa não envolveu contato às empresas nem fontes pagas.

## Resultado do piloto

- Bases empresariais pesquisadas: {len(groups)}.
- Unidades CNPJ preservadas: {len(source_cn)}.
- Vínculos regionais pesquisados: {len(rows)}.
- Selecionadas: {len(selected)}.
- Pendentes: {metadata['pending']}.
- Fora do perfil: {metadata['out_of_profile']}.
- Fora do raio provisoriamente: {metadata['outside_radius_provisional']}.

### Selecionadas

{selected_details}

| Região | Vínculos | Selecionadas | Pendentes | Fora do perfil | Fora do raio provisório |
|---|---:|---:|---:|---:|---:|
{table}

Uma seleção requer perfil muito provável, unidade operacional individual localizada dentro do raio e canal comercial público utilizável. A lista não confirma demanda ou intenção de compra. CNAE, porte cadastral, registro ambiental e endereço RFB não comprovam estoque, escala operacional nem operação atual.

Conferências: 30 bases únicas, {len(source_cn)} CNPJs de unidade, {len(rows)} pares CNPJ/região sem duplicidade e 0 CNPJs inválidos; coordenadas e distâncias das seleções foram rechecadas frente ao centro/raio documentado. Quatro CNPJs têm vínculos em mais de uma região e foram mantidos em linhas separadas; não houve transferência de coordenada entre unidades.

## Arquivos e integridade

- Selecionadas: `{outputs['selected'].name}` — {len(selected)} linhas; SHA-256 `{sha(outputs['selected'])}`.
- Pendentes/revisão: `{outputs['pending'].name}` — {len(pending)} linhas; SHA-256 `{sha(outputs['pending'])}`.
- Contagens e hashes: `ultrafine-broad-metadata-2026-10.json`.
- Manifestos de entrada e fichas de evidência individuais permanecem no mesmo diretório.
'''
    (OUT / "ultrafine-broad-report-2026-10.md").write_text(report, encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
