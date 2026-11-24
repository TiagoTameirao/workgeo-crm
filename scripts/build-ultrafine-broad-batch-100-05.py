#!/usr/bin/env python3
"""Create the three globally disjoint batch-100-05 broad-source manifests."""
from __future__ import annotations
import csv, hashlib, heapq, json, math, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "workgeo-crm" / "deliverables" / "prospecting-cnpj-2026-10"
OUT = BASE / "ultrafine-broad"
SOURCE = BASE / "prospecting-cnpj-2026-10.csv"
SUGGESTIONS = BASE / "coordinate-suggestions-cnefe-20261029.csv"
SCOPE_PATH = ROOT / "workgeo-crm" / "data" / "prospecting-territory" / "cnae-scope.json"
CENTERS_PATH = ROOT / "workgeo-crm" / "data" / "prospecting-regions" / "region-centers.json"
DATE = "2026-10-30"
REGION_ORDER = ["belo-horizonte-170km", "volta-redonda-100km", "campinas-250km"]
QUOTAS = {"belo-horizonte-170km": 34, "volta-redonda-100km": 33, "campinas-250km": 33}
REGION_LABELS = {
    "belo-horizonte-170km": "Belo Horizonte (170 km)",
    "volta-redonda-100km": "Volta Redonda (100 km)",
    "campinas-250km": "Campinas (250 km)",
}
BATCH_POOL = 10000
CONFLICT_BASES = {"52881925"}
OUTPUTS = {
    "belo-horizonte-170km": "batch-100-05-belo-horizonte-manifest.json",
    "volta-redonda-100km": "batch-100-05-volta-redonda-manifest.json",
    "campinas-250km": "batch-100-05-campinas-manifest.json",
}
PILOT_FILES = [
    OUT / "input-manifest-belo-horizonte-pilot.json",
    OUT / "pilot-volta-redonda-manifest.json",
    OUT / "input-manifest-campinas-pilot-2026-10-30.json",
]
PREVIOUS_BATCHES = [1, 2, 3, 4]


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def digits(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))


def base_from(value: object) -> str:
    value = digits(value)
    return value[:8] if len(value) >= 8 else ""


def cnpj_valid(value: object) -> bool:
    number = digits(value)
    if len(number) != 14 or len(set(number)) == 1:
        return False
    nums = [int(x) for x in number]
    for pos, weights in ((12, [5,4,3,2,9,8,7,6,5,4,3,2]), (13, [6,5,4,3,2,9,8,7,6,5,4,3,2])):
        total = sum(nums[i] * weights[i] for i in range(pos))
        remainder = total % 11
        expected = 0 if remainder < 2 else 11 - remainder
        if nums[pos] != expected:
            return False
    return True


def canonical_hash(values: set[str]) -> str:
    content = ("\n".join(sorted(values)) + "\n").encode("utf-8")
    return sha_bytes(content)


def json_file(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def group_entries(data):
    return data.get("groups") or data.get("selected_bases") or data.get("bases") or data.get("candidates") or []


def groups_bases(paths):
    found = set()
    for path in paths:
        data = json_file(path)
        for group in group_entries(data):
            base = base_from(group.get("cnpj_base"))
            if not base:
                units = group.get("units") or [group.get("selected_unit", {})]
                base = base_from(units[0].get("cnpj") if units else "")
            if base:
                found.add(base)
    return found


def load_legacy_sets():
    old = BASE / "ultrafine"
    csv_bases = set()
    for name in ("leads-ultrafine-selected-2026-10.csv", "leads-ultrafine-pending-2026-10.csv"):
        path = old / name
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f, delimiter=";"):
                b = base_from(row.get("cnpj"))
                if b:
                    csv_bases.add(b)
    json_bases = set()
    files = sorted(old.glob("batch-*.json"))
    for path in files:
        data = json_file(path)
        if not isinstance(data, list):
            continue
        for row in data:
            b = base_from(row.get("cnpj"))
            if b:
                json_bases.add(b)
    return csv_bases, json_bases, files


def haversine_km(lat1, lon1, lat2, lon2):
    rad = math.pi / 180
    dlat = (lat2-lat1)*rad
    dlon = (lon2-lon1)*rad
    a = math.sin(dlat/2)**2 + math.cos(lat1*rad)*math.cos(lat2*rad)*math.sin(dlon/2)**2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def read_suggestions():
    suggestions = {}
    with SUGGESTIONS.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            cnpj = digits(row.get("cnpj"))
            if len(cnpj) == 14:
                suggestions[cnpj] = {
                    "latitude": float(row["latitude"]),
                    "longitude": float(row["longitude"]),
                    "source": row.get("source", ""),
                    "source_date": row.get("source_date", ""),
                    "confidence": row.get("confidence", ""),
                    "match_method": row.get("match_method", ""),
                    "match_count": row.get("match_count", ""),
                }
    return suggestions


def direct_primary(code, prefixes):
    code = digits(code)
    return any(code.startswith(prefix) for prefix in prefixes)


def candidate_score(unit, suggestion, regions, centers):
    contact_count = int(bool(str(unit.get("phone", "")).strip())) + int(bool(str(unit.get("email", "")).strip()))
    has_suggestion = int(suggestion is not None)
    distances = {}
    if suggestion:
        for rid in regions:
            center = centers[rid]["center"]
            distances[rid] = haversine_km(suggestion["latitude"], suggestion["longitude"], center["latitude"], center["longitude"])
    return contact_count, has_suggestion, distances


def better_unit(a, b):
    # Prefer more public registry contact fields, then a CNEFE queue signal,
    # nearest associated center, and finally the smallest CNPJ for a stable tie.
    return a[0] > b[0] or (a[0] == b[0] and a[1] > b[1]) or \
        (a[0] == b[0] and a[1] == b[1] and a[2] < b[2]) or \
        (a[0] == b[0] and a[1] == b[1] and a[2] == b[2] and a[3] < b[3])


def make_manifest(rid, assigned, audit, source_rows, scope_version, source_hash, suggestions_hash, scope_hash, centers):
    region_meta = centers[rid]
    groups = []
    for rank, item in enumerate(assigned, 1):
        unit = item["unit"]
        regions = item["regions"]
        suggestion = item["suggestion"]
        distances = item["distances"]
        cnae = digits(unit.get("cnae_primary"))
        groups.append({
            "cnpj_base": item["base"],
            "selection_rank": rank,
            "priority_order": 1,
            "priority_stratum": "primary_direct",
            "selected_region_id": rid,
            "region_associations": regions,
            "selected_unit": unit,
            "queue_signals_only": {
                "cadastral_phone_present": bool(str(unit.get("phone", "")).strip()),
                "cadastral_email_present": bool(str(unit.get("email", "")).strip()),
                "cnefe_suggestion_used_for_queue_order": suggestion is not None,
                "cnefe_is_not_operation_or_radius_confirmation": True,
                "cnefe_suggestion": None if not suggestion else {
                    **suggestion,
                    "suggested_distance_to_region_center_km": round(distances.get(rid), 2) if rid in distances else None,
                    "classification": "suggestion_only_not_operational_confirmation",
                },
            },
            "research_status": "not_started",
        })
    return {
        "project": "WorkGeo ultrafine broad-base research queue",
        "manifest_type": "public_research",
        "batch": "LOTE-100-05",
        "created_date": DATE,
        "status": "awaiting_cross_region_audit",
        "research_started": False,
        "crm_modified": False,
        "region": {"id": rid, "name": region_meta["name"], "city": region_meta["city"], "uf": region_meta["uf"], "radius_km": region_meta["radius_km"], "center": region_meta["center"], "center_status": region_meta.get("center_status"), "center_source": region_meta.get("center_source")},
        "source_file": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "source_snapshot": "RFB CNPJ October 2026; 1,062,956 establishment rows; generated 2026-10-29T19:56:10Z",
        "source_rows_streamed": source_rows,
        "source_sha256": source_hash,
        "suggestion_source_file": str(SUGGESTIONS.relative_to(ROOT)).replace("\\", "/"),
        "suggestion_source_sha256": suggestions_hash,
        "scope_file": str(SCOPE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "scope_version": scope_version,
        "scope_sha256": scope_hash,
        "selection_method": {
            "eligibility": "Primary-direct v5 candidate CNPJ-base with at least one selected establishment carrying this source region ID; no size, address, contact, CNEFE, or coordinate filter.",
            "priority_order": "Recomputed from cnae-scope.json v5 by matching primary CNAE against prefixes in categories with direct tier; scope_tier is not used as proof. This batch contains primary_direct candidates only.",
            "tie_breakers": "More RFB phone/email fields, presence of a CNEFE suggestion, nearest suggested distance to an associated region center, then smallest CNPJ. These order queue candidates only; they do not prove operation, channel, or radius.",
            "size": "Not filtered or used for priority; RFB size attributes are carried forward.",
            "batch_unit_rule": "One representative establishment CNPJ per CNPJ-base. A base is assigned to one queue region only; all region IDs associated with the selected establishment are preserved.",
            "region_assignment": "Keep the top 10,000 representative units per region by regional priority score, then repeatedly assign the highest next candidate among unfilled queues; skip bases already assigned. Ties use Belo Horizonte, Volta Redonda, Campinas order. Regional quotas are 34/33/33.",
            "candidate_pool_limit_per_region": BATCH_POOL,
            "geography": "Region associations come from the broad source municipal assignment; neither that assignment nor CNEFE proves the operational site is within the exact radius.",
            "public_research": "Not started; waiting for independent cross-region audit.",
        },
        "selection_counts": {"primary_direct": len(groups), "secondary_direct_only": 0, "primary_adjacent": 0, "secondary_adjacent_only": 0, "other": 0},
        "exclusion_audit": audit,
        "global_audit": {
            "completed_date": DATE,
            "selected_base_count": 100,
            "selected_establishment_count": 100,
            "region_queue_counts": QUOTAS,
            "invalid_cnpj_dv": 0,
            "source_mismatches": 0,
            "duplicate_bases_within_batch_or_prior_research": 0,
            "all_regions_match_source": True,
            "all_primary_direct_v5": True,
            "audit_status": "self_audited_awaiting_independent_cross_region_audit",
        },
        "groups": groups,
    }


def main():
    for path in [SOURCE, SUGGESTIONS, SCOPE_PATH, CENTERS_PATH, *PILOT_FILES]:
        if not path.exists():
            raise FileNotFoundError(path)
    legacy_csv, legacy_json, legacy_files = load_legacy_sets()
    legacy_union = legacy_csv | legacy_json
    pilot_bases = groups_bases(PILOT_FILES)
    prior_sets = {}
    for batch in PREVIOUS_BATCHES:
        files = [OUT / f"batch-100-{batch:02d}-{slug}-manifest.json" for slug in ("belo-horizonte", "volta-redonda", "campinas")]
        prior_sets[f"batch{batch:02d}"] = groups_bases(files)
    all_nonlegacy = [pilot_bases, *prior_sets.values(), CONFLICT_BASES]
    conflict = set(CONFLICT_BASES)
    if len(legacy_json) != 1256 or len(legacy_csv) != 1120 or len(legacy_union) != 1285:
        raise RuntimeError(f"Legacy counts mismatch csv={len(legacy_csv)} json={len(legacy_json)} union={len(legacy_union)}")
    if len(pilot_bases) != 30 or any(len(s) != 100 for s in prior_sets.values()):
        raise RuntimeError(f"Prior count mismatch pilot={len(pilot_bases)} batches={[len(s) for s in prior_sets.values()]}")
    named_sets = [("legacy", legacy_union), ("pilot", pilot_bases), *prior_sets.items(), ("conflict", conflict)]
    overlaps = {}
    for i, (name1, set1) in enumerate(named_sets):
        for name2, set2 in named_sets[i+1:]:
            overlaps[f"{name1}__{name2}"] = len(set1 & set2)
    if any(overlaps.values()):
        raise RuntimeError(f"Prior exclusion sets overlap unexpectedly: {overlaps}")
    excluded = set().union(*(s for _, s in named_sets))
    if len(excluded) != 1716:
        raise RuntimeError(f"Expected 1716 excluded bases, got {len(excluded)}")
    legacy_hash = canonical_hash(legacy_union)
    exclusion_hash = canonical_hash(excluded)
    exclusion_audit = {
        "legacy_csv_unique_bases": len(legacy_csv),
        "legacy_json_unique_bases": len(legacy_json),
        "legacy_csv_json_union_excluded": len(legacy_union),
        "broad_pilot_bases_excluded": len(pilot_bases),
        "batch_100_01_bases_excluded": len(prior_sets["batch01"]),
        "batch_100_02_bases_excluded": len(prior_sets["batch02"]),
        "batch_100_03_bases_excluded": len(prior_sets["batch03"]),
        "batch_100_04_bases_excluded": len(prior_sets["batch04"]),
        "conflict_base_excluded": sorted(conflict),
        "exclusion_union_count": len(excluded),
        "overlap_counts": overlaps,
        "legacy_union_sha256": legacy_hash,
        "exclusion_union_sha256": exclusion_hash,
        "canonical_hash_method": "SHA-256 of UTF-8 bytes (no BOM) for lexicographically ascending unique 8-digit CNPJ-base strings joined by LF (0A), with a trailing LF after the final value; lowercase hexadecimal digest.",
        "inherited_legacy_union_sha256": "3347605c18bcee965d86bcc72890852814c23baf0634afbdb14b7becf03cef12",
        "inherited_hash_method_status": "Historical hash copied from approved lot 100-01/02 metadata; their canonicalization was undocumented. The canonical digest above is independently recomputed and documented.",
        "legacy_json_files_count": len(legacy_files),
    }
    scope = json_file(SCOPE_PATH)
    centers_data = json_file(CENTERS_PATH)
    centers = {r["id"]: r for r in centers_data["regions"]}
    direct_prefixes = sorted({str(prefix) for cat in scope["categories"] if "direta" in str(cat.get("tier", "")).lower() for prefix in cat.get("cnae_prefixes", [])}, key=lambda x: (-len(x), x))
    if not direct_prefixes:
        raise RuntimeError("No direct CNAE prefixes found")
    suggestions = read_suggestions()
    suggestion_hash = sha_file(SUGGESTIONS)
    source_hash = sha_file(SOURCE)
    scope_hash = sha_file(SCOPE_PATH)
    pools = {rid: [] for rid in REGION_ORDER}
    best_by_base = {}
    source_rows = 0
    with SOURCE.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            source_rows += 1
            base = base_from(row.get("cnpj_base") or row.get("cnpj"))
            if not base or base in excluded or not direct_primary(row.get("cnae_primary"), direct_prefixes):
                continue
            cnpj = digits(row.get("cnpj"))
            if not cnpj_valid(cnpj) or cnpj[:8] != base:
                continue
            regions_raw = row.get("prospecting_region_ids", "[]")
            try:
                regions = json.loads(regions_raw) if isinstance(regions_raw, str) else list(regions_raw)
            except Exception:
                regions = []
            regions = [rid for rid in REGION_ORDER if rid in regions]
            if not regions:
                continue
            unit = dict(row)
            unit["cnpj"] = cnpj
            unit["cnpj_base"] = base
            unit["prospecting_region_ids"] = json.dumps(regions, ensure_ascii=False, separators=(",", ":"))
            suggestion = suggestions.get(cnpj)
            contact, has_suggestion, distances = candidate_score(unit, suggestion, regions, centers)
            nearest = min(distances.values()) if distances else float("inf")
            quality = (contact, has_suggestion, -nearest, -int(cnpj))
            candidate = {"base": base, "unit": unit, "regions": regions, "suggestion": suggestion, "distances": distances, "quality": quality}
            previous = best_by_base.get(base)
            if previous is None or candidate["quality"] > previous["quality"]:
                best_by_base[base] = candidate
    for base, best in best_by_base.items():
        for rid in best["regions"]:
            center_distance = best["distances"].get(rid, float("inf"))
            region_quality = (best["quality"][0], best["quality"][1], -center_distance, best["quality"][3])
            candidate = {**best, "region_quality": region_quality}
            heap = pools[rid]
            entry = (region_quality, base, candidate)
            if len(heap) < BATCH_POOL:
                heapq.heappush(heap, entry)
            elif entry[0] > heap[0][0]:
                heapq.heapreplace(heap, entry)
    if source_rows != 1062956:
        raise RuntimeError(f"Source row count mismatch: {source_rows}")
    queues = {}
    for rid, heap in pools.items():
        queues[rid] = [entry[2] for entry in sorted(heap, key=lambda x: x[0], reverse=True)]
    ptr = {rid: 0 for rid in REGION_ORDER}
    assigned = {rid: [] for rid in REGION_ORDER}
    used_bases = set()
    while any(len(assigned[rid]) < QUOTAS[rid] for rid in REGION_ORDER):
        options = []
        for rid in REGION_ORDER:
            if len(assigned[rid]) >= QUOTAS[rid]:
                continue
            queue = queues[rid]
            while ptr[rid] < len(queue) and queue[ptr[rid]]["base"] in used_bases:
                ptr[rid] += 1
            if ptr[rid] < len(queue):
                options.append((queue[ptr[rid]]["region_quality"], -REGION_ORDER.index(rid), rid, queue[ptr[rid]]))
        if not options:
            raise RuntimeError(f"Insufficient globally unique candidates: {[len(assigned[r]) for r in REGION_ORDER]}")
        _, _, rid, candidate = max(options)
        assigned[rid].append(candidate)
        used_bases.add(candidate["base"])
        ptr[rid] += 1
    if len(used_bases) != 100:
        raise RuntimeError(f"Expected 100 unique selected bases, got {len(used_bases)}")
    if used_bases & excluded:
        raise RuntimeError("Selected base collides with exclusion set")
    all_groups = []
    for rid in REGION_ORDER:
        for candidate in assigned[rid]:
            if candidate["unit"]["cnpj_base"] != candidate["base"]:
                raise RuntimeError("CNPJ-base mismatch")
            if not cnpj_valid(candidate["unit"]["cnpj"]):
                raise RuntimeError("Invalid selected CNPJ DV")
            all_groups.append((rid, candidate))
    if len({x[1]["unit"]["cnpj"] for x in all_groups}) != 100:
        raise RuntimeError("Selected establishment CNPJ is not globally unique")
    common_audit = {
        "source_rows_streamed": source_rows,
        "selected_base_count": 100,
        "selected_establishment_count": 100,
        "unique_bases": len(used_bases),
        "invalid_cnpj_dv": 0,
        "overlap_with_exclusions": 0,
        "region_quota_counts": {rid: len(assigned[rid]) for rid in REGION_ORDER},
    }
    for rid in REGION_ORDER:
        if len(assigned[rid]) != QUOTAS[rid]:
            raise RuntimeError(f"Quota mismatch for {rid}")
    # Write all three manifests only after the entire global selection passes local audits.
    for rid in REGION_ORDER:
        manifest = make_manifest(rid, assigned[rid], exclusion_audit, source_rows, scope["version"], source_hash, suggestion_hash, scope_hash, centers)
        manifest["global_audit"].update(common_audit)
        manifest["global_audit"]["source_mismatches"] = 0
        manifest["global_audit"]["all_regions_match_source"] = True
        manifest["global_audit"]["all_primary_direct_v5"] = True
        manifest["global_audit"]["audit_status"] = "self_audited_awaiting_independent_cross_region_audit"
        out_path = OUT / OUTPUTS[rid]
        temp = out_path.with_suffix(out_path.suffix + ".tmp")
        temp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        temp.replace(out_path)
    print(json.dumps({
        "status": "awaiting_cross_region_audit",
        "source_rows": source_rows,
        "direct_primary_prefixes": direct_prefixes,
        "legacy_csv": len(legacy_csv),
        "legacy_json": len(legacy_json),
        "legacy_union": len(legacy_union),
        "pilot": len(pilot_bases),
        "prior_batches": {k: len(v) for k,v in prior_sets.items()},
        "conflict": len(conflict),
        "exclusion_union": len(excluded),
        "legacy_union_sha256": legacy_hash,
        "exclusion_union_sha256": exclusion_hash,
        "pool_sizes": {rid: len(pools[rid]) for rid in REGION_ORDER},
        "selected": {rid: {"count":len(assigned[rid]),"cnpjs":[x["unit"]["cnpj"] for x in assigned[rid]]} for rid in REGION_ORDER},
        "selected_unique_bases": len(used_bases),
        "selected_unique_cnpjs": len({x[1]["unit"]["cnpj"] for x in all_groups}),
        "hashes": {OUTPUTS[rid]: sha_file(OUT / OUTPUTS[rid]) for rid in REGION_ORDER},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
