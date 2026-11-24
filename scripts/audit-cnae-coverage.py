"""Count active CNPJ establishments by CNAE class in the KML-intersecting municipalities.

Uses an already downloaded Receita Federal snapshot and does not create or import CRM records.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "scripts" / "build-cnpj-prospects.py"
SPEC = importlib.util.spec_from_file_location("build_cnpj_prospects", BUILD_SCRIPT)
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)


def count_cnae_classes(rows, target_codes: set[str], categories: list[dict], cnaes: dict[str, str]) -> dict:
    counts: Counter[str] = Counter()
    primary_counts: Counter[str] = Counter()
    subclass_counts: dict[str, Counter[str]] = defaultdict(Counter)
    subclass_primary_counts: Counter[str] = Counter()
    outside_scope_counts: Counter[str] = Counter()
    subclass_outside_scope_counts: dict[str, Counter[str]] = defaultdict(Counter)
    metrics = {"establishments_seen": 0, "in_intersecting_municipalities": 0, "active_in_intersecting_municipalities": 0, "active_in_current_scope": 0}
    for row in rows:
        metrics["establishments_seen"] += 1
        if len(row) < 28:
            raise RuntimeError(f"Leiaute inesperado: {len(row)} colunas.")
        if row[19].strip().upper() != "MG" or row[20].strip() not in target_codes:
            continue
        metrics["in_intersecting_municipalities"] += 1
        if row[5].strip() != "02":
            continue
        metrics["active_in_intersecting_municipalities"] += 1
        primary = row[11].strip()
        codes = list(dict.fromkeys([primary, *(code.strip() for code in row[12].split(",") if code.strip())]))
        valid_codes = [code for code in codes if code in cnaes and len(code) >= 4]
        in_scope = any(BUILDER.matching_categories(code, categories) for code in valid_codes)
        if in_scope:
            metrics["active_in_current_scope"] += 1
        for code in valid_codes:
            group = code[:4]
            subclass_counts[group][code] += 1
        if primary in cnaes and len(primary) >= 4:
            subclass_primary_counts[primary] += 1
        for group in {code[:4] for code in valid_codes}:
            counts[group] += 1
            if not in_scope:
                outside_scope_counts[group] += 1
        if not in_scope:
            for code in valid_codes:
                subclass_outside_scope_counts[code[:4]][code] += 1
        if primary in cnaes and len(primary) >= 4:
            primary_counts[primary[:4]] += 1
    classes = []
    subclasses = []
    for group, count in counts.items():
        examples = sorted(subclass_counts[group].items(), key=lambda pair: (-pair[1], pair[0]))[:5]
        classes.append({
            "cnae_class_prefix": group,
            "active_establishments_any_code": count,
            "active_establishments_primary_code": primary_counts[group],
            "active_establishments_outside_current_scope": outside_scope_counts[group],
            "already_in_scope": any(
                any(group.startswith(prefix) or prefix.startswith(group) for prefix in category["cnae_prefixes"])
                for category in categories
            ),
            "common_subclasses": [
                {"code": code, "description": cnaes.get(code, "NÃO ENCONTRADO"), "active_establishments": subclass_count, "outside_current_scope": subclass_outside_scope_counts[group][code]}
                for code, subclass_count in examples
            ],
        })
        for code, subclass_count in subclass_counts[group].items():
            in_scope = any(code.startswith(prefix) for category in categories for prefix in category["cnae_prefixes"])
            if in_scope:
                continue
            subclasses.append({
                "cnae_class_prefix": group,
                "cnae_code": code,
                "description": cnaes.get(code, "NÃO ENCONTRADO"),
                "active_establishments_any_code": subclass_count,
                "active_establishments_primary_code": subclass_primary_counts[code],
                "active_establishments_outside_current_scope": subclass_outside_scope_counts[group][code],
            })
    classes.sort(key=lambda item: (-item["active_establishments_any_code"], item["cnae_class_prefix"]))
    subclasses.sort(key=lambda item: (-item["active_establishments_outside_current_scope"], item["cnae_code"]))
    return {"metrics": metrics, "classes": classes, "unselected_subclasses": subclasses}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", required=True, help="Carga CNPJ local, formato AAAA-MM.")
    parser.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "workgeo-cnpj-cache")
    parser.add_argument("--output", type=Path, default=ROOT / "deliverables" / "prospecting-cnpj" / "cnae-coverage-audit-2026-10.json")
    args = parser.parse_args()
    if not BUILDER.re.fullmatch(r"20\d{2}-\d{2}", args.month):
        raise RuntimeError("Informe a carga no formato AAAA-MM.")
    cache = args.cache_dir.expanduser().resolve()
    for name in ["Cnaes.zip", "Municipios.zip", *(f"Estabelecimentos{i}.zip" for i in range(10))]:
        if not (cache / name).is_file():
            raise RuntimeError(f"Arquivo ausente no cache local: {name}. Nenhum download foi iniciado.")
    universe = json.loads((ROOT / "data/prospecting-territory/municipalities.json").read_text(encoding="utf-8"))
    scope = json.loads((ROOT / "data/prospecting-territory/cnae-scope.json").read_text(encoding="utf-8"))
    overrides = json.loads((ROOT / "data/prospecting-territory/rfb-municipality-name-overrides.json").read_text(encoding="utf-8"))
    cnaes, rfb_names = BUILDER.load_domains(cache)
    target_codes, applied_overrides = BUILDER.target_municipality_codes(universe, rfb_names, overrides)

    def active_rows():
        for index in range(10):
            archive = cache / f"Estabelecimentos{index}.zip"
            print(f"Lendo {archive.name} para auditoria de CNAE…", flush=True)
            yield from BUILDER.rows_from_zip(archive)

    result = count_cnae_classes(active_rows(), set(target_codes), scope["categories"], cnaes)
    report = {
        "source": "Dados Abertos do CNPJ — Receita Federal",
        "source_month": args.month,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "territory_file": "data/prospecting-territory/municipalities.json",
        "territory_rule": "municípios cuja geometria cruza o KML; isso não afirma que cada sede/unidade fica dentro do polígono",
        "territory_municipalities": universe["municipalities_count"],
        "municipality_name_overrides_applied": applied_overrides,
        "cnae_scope_file": "data/prospecting-territory/cnae-scope.json",
        "metrics": result["metrics"],
        "classes": result["classes"],
        "unselected_subclasses": result["unselected_subclasses"],
        "limits": [
            "Contagem reproduz o snapshot e status cadastral; CNAE não prova estoque, pilha, área, porte operacional, demanda ou interesse.",
            "Unidades de municípios que apenas intersectam o KML podem estar fora do polígono.",
            "CNAEs secundários podem fazer a mesma unidade aparecer em várias classes; establishments_any_code não é aditivo.",
            "Uma categoria econômica só deve ser adicionada ao escopo após revisão comercial da descrição e do volume operacional provável.",
        ],
    }
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    unselected = [row for row in result["classes"] if not row["already_in_scope"]]
    print(json.dumps({
        "output": str(output),
        "metrics": result["metrics"],
        "unselected_classes": len(unselected),
        "unselected_subclasses": len(result["unselected_subclasses"]),
        "top_unselected": unselected[:20],
        "top_unselected_subclasses": result["unselected_subclasses"][:30],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERRO: {error}", file=sys.stderr)
        raise SystemExit(1)
