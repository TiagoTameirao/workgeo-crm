"""Summarize CNPJ candidates and CNEFE suggestions against an IBGE circle audit."""

from __future__ import annotations

import argparse
import csv
from collections import Counter
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EARTH_RADIUS_METERS = 6_371_008.8


def ring_from_kml(path: Path) -> list[list[float]]:
    source = path.read_text(encoding="utf-8")
    coordinates = re.search(r"<coordinates\b[^>]*>([\s\S]*?)</coordinates>", source, re.I)
    if not coordinates:
        raise ValueError("KML sem anel de coordenadas.")
    ring = [[float(item) for item in coordinate.split(",")[:2]] for coordinate in coordinates.group(1).split()]
    if ring[0] != ring[-1]:
        ring.append(ring[0][:])
    return ring


def point_in_ring(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    previous = ring[-1]
    for current in ring:
        if (current[1] > y) != (previous[1] > y):
            crossing = (previous[0] - current[0]) * (y - current[1]) / (previous[1] - current[1]) + current[0]
            if x < crossing:
                inside = not inside
        previous = current
    return inside


def distance_km(center: tuple[float, float], point: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, center)
    lon2, lat2 = map(math.radians, point)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    haversine = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(haversine)) / 1000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", type=Path, default=ROOT / "deliverables/prospecting-cnpj/prospecting-cnpj-2026-10.csv")
    parser.add_argument("--suggestions", type=Path, default=ROOT / "deliverables/prospecting-cnpj/suggestions-2026-10-expanded.csv")
    parser.add_argument("--radius-audit", type=Path, default=ROOT / "deliverables/prospecting-cnpj/territory-radius-170km-audit.json")
    parser.add_argument("--kml", type=Path, default=ROOT / "data/area_170km.original.kml")
    parser.add_argument("--output", type=Path, default=ROOT / "deliverables/prospecting-cnpj/radius-170km-candidate-summary.json")
    args = parser.parse_args()

    radius_audit = json.loads(args.radius_audit.read_text(encoding="utf-8"))
    circle = radius_audit["circle"]
    center = (circle["center"]["longitude"], circle["center"]["latitude"])
    radius = float(circle["radius_km"])
    kml_ring = ring_from_kml(args.kml)
    kml_codes = {item["ibge_code"] for item in radius_audit["municipality_intersection"]["kml_municipalities"]}
    circle_codes = {item["ibge_code"] for item in radius_audit["municipality_intersection"]["circle_municipalities"]}
    circle_candidates = Counter()
    circle_sizes = Counter()
    outside_kml_candidates = Counter()
    outside_kml_cnpjs: set[str] = set()
    unknown_municipality_codes = Counter()

    with args.candidates.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream, delimiter=";"):
            code = row.get("municipality_code_ibge", "")
            size = row.get("size_label", "Desconhecido") or "Desconhecido"
            if code in circle_codes:
                circle_candidates["total"] += 1
                circle_sizes[size] += 1
            elif code not in kml_codes:
                unknown_municipality_codes[code if code else "NÃO INFORMADO"] += 1
            if code in kml_codes and code not in circle_codes:
                outside_kml_candidates[row.get("municipality", "NÃO INFORMADO")] += 1
                outside_kml_cnpjs.add(row.get("cnpj", ""))

    crosstab = Counter()
    distances = Counter()
    confidence = Counter()
    municipality_outside_circle_suggestions = Counter()
    suggestion_count = 0
    with args.suggestions.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream, delimiter=";"):
            suggestion_count += 1
            point = (float(row["longitude"]), float(row["latitude"]))
            within_circle = distance_km(center, point) <= radius
            inside_kml = point_in_ring(point, kml_ring)
            crosstab[("inside_kml" if inside_kml else "outside_kml", "inside_circle" if within_circle else "outside_circle")] += 1
            distances["within_170km" if within_circle else "over_170km"] += 1
            confidence[("within_170km" if within_circle else "over_170km", row.get("confidence", "unknown").split(";", 1)[0])] += 1
            if row.get("cnpj") in outside_kml_cnpjs:
                municipality_outside_circle_suggestions["within_170km" if within_circle else "over_170km"] += 1

    summary = {
        "generated_at": radius_audit["generated_at"],
        "classification": "PROVISÓRIO: o círculo de 170 km usa o centro ajustado ao KML; isso não confirma que seja o ponto central desejado para Belo Horizonte.",
        "sources": {
            "candidate_snapshot": "Dados Abertos CNPJ Receita Federal, competência 2026-10",
            "address_suggestions": "IBGE CNEFE 2022; posições continuam sugestões",
            "radius_audit": args.radius_audit.name,
        },
        "municipal_candidate_superset": {
            "current_kml_intersections": len(kml_codes),
            "170km_circle_intersections": len(circle_codes),
            "candidates_in_circle_intersection_municipalities": circle_candidates["total"],
            "candidates_by_rfb_size_label_in_circle_intersection_municipalities": dict(sorted(circle_sizes.items())),
            "candidates_only_in_kml_intersection_municipalities": sum(outside_kml_candidates.values()),
            "candidates_only_in_kml_by_municipality": dict(sorted(outside_kml_candidates.items())),
            "unmapped_municipality_code_candidate_count": sum(unknown_municipality_codes.values()),
        },
        "suggested_address_points": {
            "total": suggestion_count,
            "radial_distance_from_center": dict(distances),
            "kml_vs_170km_cross_tab": {f"{kml};{radius}": count for (kml, radius), count in sorted(crosstab.items())},
            "confidence_by_radius": {f"{radius};{level}": count for (radius, level), count in sorted(confidence.items())},
            "suggestions_in_only_kml_municipalities": dict(municipality_outside_circle_suggestions),
            "candidates_without_suggestion": max(0, circle_candidates["total"] + sum(outside_kml_candidates.values()) - suggestion_count),
        },
        "limitations": [
            "Cruzar o limite municipal do círculo inclui candidatos possíveis, mesmo que o estabelecimento individual esteja fora do raio.",
            "CNEFE 2022 não confirma endereço atual, endereço de operação ou coordenada individual.",
            "Não excluir candidato automaticamente por sugestão de endereço ou cidade; conferir endereço e posição na unidade.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output.relative_to(ROOT)), **summary["municipal_candidate_superset"], "suggestions": summary["suggested_address_points"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
