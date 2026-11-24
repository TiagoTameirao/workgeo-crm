import { migrate, query, close } from "../lib/db.mjs";

await migrate();
await query("DELETE FROM prospecting_candidate_map_regions");
await query(`INSERT INTO prospecting_candidate_map_regions(candidate_id,region_id)
  SELECT prospecting_candidates.id,region.value
  FROM prospecting_candidates,json_each(prospecting_candidates.data,'$.prospecting_region_ids') AS region
  WHERE prospecting_candidates.latitude IS NOT NULL OR prospecting_candidates.suggested_latitude IS NOT NULL`);
const [counts] = await query("SELECT COUNT(DISTINCT candidate_id) AS geolocated_candidates,COUNT(*) AS region_links FROM prospecting_candidate_map_regions");
console.log(JSON.stringify(counts));
await close();
