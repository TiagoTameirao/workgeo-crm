"""Build a review-ready prospect list for the three WorkGeo regions."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EARTH_RADIUS_METERS = 6_371_008.8
CANDIDATES = ROOT / "deliverables" / "prospecting-cnpj-2026-10" / "prospecting-cnpj-2026-10.csv"
SUGGESTIONS = ROOT / "deliverables" / "prospecting-cnpj-2026-10" / "coordinate-suggestions-cnefe-20261029.csv"
REGIONS = ROOT / "data" / "prospecting-regions" / "regions.json"
OUTPUT = ROOT / "deliverables" / "prospecting-cnpj-2026-10" / "leads-potential-3-regions-2026-10.csv"
REPORT = ROOT / "deliverables" / "prospecting-cnpj-2026-10" / "leads-potential-3-regions-report-2026-10.json"

EXTRA_FIELDS = [
    "lead_review_status",
    "lead_segment_evidence",
    "lead_size_evidence",
    "contact_availability",
    "suggested_latitude",
    "suggested_longitude",
    "suggestion_confidence",
    "suggestion_source",
    "eligible_region_ids",
    "eligible_region_names",
    "distance_to_eligible_region_km",
    "lead_basis",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def distance_meters(latitude: float, longitude: float, center_lat: float, center_lon: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (center_lat, center_lon, latitude, longitude))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(h))


def main() -> None:
    regions_data = json.loads(REGIONS.read_text(encoding="utf-8"))
    regions = {item["id"]: item for item in regions_data["regions"]}
    suggestions: dict[str, dict] = {}
    suggestion_rows = duplicate_suggestions = 0
    with SUGGESTIONS.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream, delimiter=";"):
            suggestion_rows += 1
            cnpj = row["cnpj"].strip()
            if cnpj in suggestions:
                duplicate_suggestions += 1
                continue
            try:
                latitude, longitude = float(row["latitude"]), float(row["longitude"])
            except (ValueError, TypeError):
                continue
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                continue
            suggestions[cnpj] = {**row, "latitude_num": latitude, "longitude_num": longitude}

    counts = {
        "candidate_records": 0,
        "direct_segment": 0,
        "cadastral_micro_or_small": 0,
        "with_coordinate_suggestion": 0,
        "eligible_for_human_review": 0,
        "eligible_by_region": {region_id: 0 for region_id in regions},
        "eligible_by_confidence": {},
        "eligible_with_cadastral_contact": 0,
        "eligible_without_cadastral_contact": 0,
        "excluded_segment": 0,
        "excluded_size": 0,
        "excluded_without_suggestion": 0,
        "excluded_outside_applicable_radii": 0,
        "matched_suggestions": 0,
        "unmatched_unique_suggestions": 0,
    }
    candidate_seen: set[str] = set()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with CANDIDATES.open("r", encoding="utf-8-sig", newline="") as source, OUTPUT.open(
        "w", encoding="utf-8-sig", newline=""
    ) as destination:
        reader = csv.DictReader(source, delimiter=";")
        if not reader.fieldnames or "prospecting_region_ids" not in reader.fieldnames:
            raise RuntimeError("CSV mestre não contém os vínculos das regiões.")
        writer = csv.DictWriter(destination, fieldnames=[*reader.fieldnames, *EXTRA_FIELDS], delimiter=";", extrasaction="ignore")
        writer.writeheader()
        for row in reader:
            counts["candidate_records"] += 1
            cnpj = row["cnpj"].strip()
            if cnpj in candidate_seen:
                raise RuntimeError(f"CNPJ duplicado no CSV mestre: {cnpj}")
            candidate_seen.add(cnpj)
            direct = str(row.get("scope_tier", "")).startswith("Aderência direta")
            small = row.get("size_label") in {"Microempresa", "Empresa de pequeno porte"}
            if direct:
                counts["direct_segment"] += 1
            if small:
                counts["cadastral_micro_or_small"] += 1
            if not direct:
                counts["excluded_segment"] += 1
            if not small:
                counts["excluded_size"] += 1

            suggestion = suggestions.get(cnpj)
            if suggestion:
                counts["with_coordinate_suggestion"] += 1
                counts["matched_suggestions"] += 1
            if not direct or not small:
                continue
            if not suggestion:
                counts["excluded_without_suggestion"] += 1
                continue

            try:
                region_ids = json.loads(row.get("prospecting_region_ids") or "[]")
            except json.JSONDecodeError as error:
                raise RuntimeError(f"Lista de regiões inválida no CNPJ {cnpj}.") from error
            eligible_regions = []
            distances = {}
            for region_id in region_ids:
                region = regions.get(region_id)
                if region is None:
                    continue
                center = region["center"]
                distance = distance_meters(
                    suggestion["latitude_num"], suggestion["longitude_num"],
                    float(center["latitude"]), float(center["longitude"]),
                )
                distances[region_id] = distance
                if distance <= float(region["radius_km"]) * 1000:
                    eligible_regions.append(region_id)
            if not eligible_regions:
                counts["excluded_outside_applicable_radii"] += 1
                continue

            counts["eligible_for_human_review"] += 1
            for region_id in eligible_regions:
                counts["eligible_by_region"][region_id] += 1
            confidence = str(suggestion.get("confidence", "Desconhecida")).split(";", 1)[0].strip() or "Desconhecida"
            counts["eligible_by_confidence"][confidence] = counts["eligible_by_confidence"].get(confidence, 0) + 1
            has_contact = bool(row.get("phone", "").strip() or row.get("email", "").strip())
            contact_label = "Telefone/e-mail cadastral disponível" if has_contact else "Sem telefone/e-mail cadastral"
            if has_contact:
                counts["eligible_with_cadastral_contact"] += 1
            else:
                counts["eligible_without_cadastral_contact"] += 1

            matched_distances = [distances[region_id] for region_id in eligible_regions]
            enriched = {
                **row,
                "lead_review_status": "Potencial — revisão humana pendente",
                "lead_segment_evidence": "Segmento direto presumido pelo CNAE; confirmar aderência operacional",
                "lead_size_evidence": f"Porte cadastral RFB: {row['size_label']}; porte operacional não confirmado",
                "contact_availability": contact_label,
                "suggested_latitude": suggestion["latitude"],
                "suggested_longitude": suggestion["longitude"],
                "suggestion_confidence": confidence,
                "suggestion_source": suggestion["source"],
                "eligible_region_ids": json.dumps(eligible_regions, ensure_ascii=False),
                "eligible_region_names": " | ".join(regions[region_id]["name"] for region_id in eligible_regions),
                "distance_to_eligible_region_km": f"{min(matched_distances) / 1000:.2f}".replace(".", ","),
                "lead_basis": "CNAE direto + ME/EPP cadastral + sugestão CNEFE dentro de ao menos um raio; sem confirmação humana",
            }
            writer.writerow(enriched)

    counts["unmatched_unique_suggestions"] = len(suggestions) - counts["matched_suggestions"]
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "classification": "Lista local de potenciais Leads para revisão; nenhum registro foi promovido/qualificado no CRM.",
        "source_month": "2026-10",
        "sources": {
            "candidate_master": str(CANDIDATES.relative_to(ROOT)).replace("\\", "/"),
            "coordinate_suggestions": str(SUGGESTIONS.relative_to(ROOT)).replace("\\", "/"),
            "regions": str(REGIONS.relative_to(ROOT)).replace("\\", "/"),
        },
        "rules": {
            "segment": "Aderência direta presumida pela classificação CNAE vigente; segmentos adjacentes não incluídos sem confirmação humana.",
            "size": "Microempresa ou Empresa de pequeno porte conforme Receita Federal; porte operacional não confirmado.",
            "location": "Sugestão IBGE CNEFE associada ao CNPJ dentro do raio de ao menos uma região municipalmente associada.",
            "contact_required": False,
            "regions": [
                {"id": region["id"], "name": region["name"], "center": region["center"], "radius_km": region["radius_km"]}
                for region in regions.values()
            ],
        },
        "counts": counts,
        "output": {
            "file": OUTPUT.name,
            "rows": counts["eligible_for_human_review"],
            "bytes": OUTPUT.stat().st_size,
            "sha256": sha256(OUTPUT),
        },
        "limitations": [
            "A lista segue a peneira cadastral disponível e não comprova demanda, estoque, porte operacional, interesse ou contato comercial validado.",
            "Telefone/e-mail cadastral é incluído quando disponível, mas não é requisito de elegibilidade.",
            "Coordenadas CNEFE 2022 são sugestões de endereço e permanecem pendentes de validação humana.",
            "Candidatos sem sugestão de coordenada ficam no CSV mestre de prospecção, mas não entram nesta lista de potenciais Leads com localização no raio.",
            "Os centros e raios são referências territoriais documentadas; município associado não garante que cada unidade esteja dentro do raio.",
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "rows": counts["eligible_for_human_review"], "bytes": OUTPUT.stat().st_size, "counts": counts, "report": str(REPORT)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
