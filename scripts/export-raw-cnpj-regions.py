"""Export raw Receita Federal establishment rows for WorkGeo prospecting regions."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "scripts" / "build-cnpj-prospects.py"
SPEC = importlib.util.spec_from_file_location("build_cnpj_prospects", BUILDER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Não foi possível carregar {BUILDER_PATH}")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)

SOURCE_FIELDS = [
    "cnpj_basico",
    "cnpj_ordem",
    "cnpj_dv",
    "identificador_matriz_filial",
    "nome_fantasia",
    "situacao_cadastral",
    "data_situacao_cadastral",
    "motivo_situacao_cadastral",
    "nome_cidade_exterior",
    "pais",
    "data_inicio_atividade",
    "cnae_fiscal_principal",
    "cnae_fiscal_secundaria",
    "tipo_logradouro",
    "logradouro",
    "numero",
    "complemento",
    "bairro",
    "cep",
    "uf",
    "municipio_codigo_receita",
    "ddd_1",
    "telefone_1",
    "ddd_2",
    "telefone_2",
    "ddd_fax",
    "fax",
    "correio_eletronico",
    "situacao_especial",
    "data_situacao_especial",
]
OUTPUT_FIELDS = SOURCE_FIELDS + [
    "municipio_nome_ibge",
    "municipio_codigo_ibge",
    "regioes_prospeccao",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    month = "2026-10"
    cache = Path(tempfile.gettempdir()) / "workgeo-cnpj-raw-cache"
    output_dir = ROOT / "deliverables" / "raw-cnpj-2026-10"
    output = output_dir / "estabelecimentos-rfb-2026-10-tres-regioes.csv"
    output_dir.mkdir(parents=True, exist_ok=True)

    regions_path = ROOT / "data" / "prospecting-regions" / "regions.json"
    overrides_path = ROOT / "data" / "prospecting-territory" / "rfb-municipality-name-overrides.json"
    regions_data = json.loads(regions_path.read_text(encoding="utf-8"))
    universe = BUILDER.merged_region_universe(regions_data)
    rfb_municipalities = {
        row[0].strip(): row[1].strip()
        for row in BUILDER.rows_from_zip(cache / "Municipios.zip")
        if len(row) >= 2
    }
    overrides = json.loads(overrides_path.read_text(encoding="utf-8"))
    target_codes, applied_overrides, multiple_codes = BUILDER.target_municipality_codes(
        universe, rfb_municipalities, overrides
    )
    region_names = {region["id"]: region["name"] for region in regions_data["regions"]}

    counts = {
        "records_scanned": 0,
        "records_exported": 0,
        "records_by_region": {region_id: 0 for region_id in region_names},
        "records_by_status_code": {},
        "records_by_municipality": {},
    }
    partial = output.with_suffix(output.suffix + ".part")
    with partial.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream, delimiter=";", quotechar='"', lineterminator="\n")
        writer.writerow(OUTPUT_FIELDS)
        for index in range(10):
            archive = cache / f"Estabelecimentos{index}.zip"
            if not archive.is_file():
                raise FileNotFoundError(f"Arquivo RFB ausente: {archive}")
            print(f"Lendo {archive.name}…", flush=True)
            for row in BUILDER.rows_from_zip(archive):
                counts["records_scanned"] += 1
                if len(row) != len(SOURCE_FIELDS):
                    raise RuntimeError(
                        f"Leiaute inesperado em {archive.name}, linha {counts['records_scanned']}: "
                        f"{len(row)} campos (esperados {len(SOURCE_FIELDS)})."
                    )
                municipality = target_codes.get((row[19].strip().upper(), row[20].strip()))
                if municipality is None:
                    continue
                region_ids = municipality["prospecting_region_ids"]
                writer.writerow(row + [
                    municipality["municipality"],
                    municipality["ibge_code"],
                    ",".join(region_ids),
                ])
                counts["records_exported"] += 1
                status = row[5].strip() or "(vazio)"
                counts["records_by_status_code"][status] = counts["records_by_status_code"].get(status, 0) + 1
                city_key = f"{municipality['municipality']}/{row[19].strip().upper()}"
                city_counts = counts["records_by_municipality"].setdefault(city_key, {
                    "municipio_codigo_ibge": municipality["ibge_code"],
                    "estabelecimentos": 0,
                    "regioes_prospeccao": region_ids,
                })
                city_counts["estabelecimentos"] += 1
                for region_id in region_ids:
                    counts["records_by_region"][region_id] += 1
            print(
                f"{archive.name}: lidos {counts['records_scanned']:,}; "
                f"exportados {counts['records_exported']:,} até agora.",
                flush=True,
            )

    partial.replace(output)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    report = {
        "source": "Dados Abertos do CNPJ — Receita Federal",
        "source_month": month,
        "generated_at_utc": generated_at,
        "generated_at_local": datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds"),
        "source_url": "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos/cnpj",
        "territory_file": str(regions_path.relative_to(ROOT)).replace("\\", "/"),
        "territory_municipalities_ibge": universe["municipalities_count"],
        "territory_rfb_uf_municipality_codes": len(target_codes),
        "municipality_name_overrides_applied": applied_overrides,
        "municipality_names_with_multiple_rfb_codes": multiple_codes,
        "regions": [
            {
                "id": region["id"],
                "name": region["name"],
                "reference_city": region["city"],
                "uf": region["uf"],
                "radius_km": region["radius_km"],
                "municipalities_intersecting": len(region["municipalities"]),
            }
            for region in regions_data["regions"]
        ],
        "counts": counts,
        "file": output.name,
        "file_size_bytes": output.stat().st_size,
        "file_sha256": sha256(output),
        "encoding": "UTF-8 with BOM",
        "delimiter": ";",
        "record_definition": "Uma linha por registro da tabela Estabelecimentos da RFB; valores brutos da fonte mantidos nas 30 colunas originais.",
        "added_columns": [
            "municipio_nome_ibge",
            "municipio_codigo_ibge",
            "regioes_prospeccao",
        ],
        "limitations": [
            "O universo inclui estabelecimentos de todos os CNAEs e de todas as situações cadastrais, desde que o município conste nos recortes.",
            "Município que intersecta um raio é universo de busca, não prova que cada endereço esteja dentro do círculo.",
            "Sobreposição de regiões é anotada na mesma linha; cada registro de origem é escrito uma vez.",
            "Este CSV contém a tabela bruta de estabelecimentos. Tabelas relacionadas de empresas, Simples Nacional e sócios não são achatadas neste arquivo para evitar omissão ou multiplicação de registros por relacionamentos um-para-muitos.",
            "A Receita Federal não fornece coordenadas individuais neste conjunto de dados.",
        ],
    }
    report_path = output_dir / "relatorio-exportacao.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"csv": str(output), "rows": counts["records_exported"], "bytes": output.stat().st_size, "report": str(report_path)}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"ERRO: {error}", file=sys.stderr)
        sys.exit(1)
