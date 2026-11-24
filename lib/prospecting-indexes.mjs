export const prospectingRegionIds = ["belo-horizonte-170km", "volta-redonda-100km", "campinas-250km"];

export function regionMembershipSql(regionId, table = "prospecting_candidates") {
  if (!prospectingRegionIds.includes(regionId)) throw new Error("Região de prospecção inválida.");
  return `INSTR(json_extract(${table}.data,'$.prospecting_region_ids'),'"${regionId}"')>0`;
}

export const candidateOrderSql = "CASE review_status WHEN 'Pendente' THEN 0 ELSE 1 END,CASE WHEN cnae_primary_in_scope THEN 0 ELSE 1 END,municipality,cnpj";

export function prospectingIndexStatements() {
  return [
    ...prospectingRegionIds.map((id, index) => `CREATE INDEX IF NOT EXISTS prospecting_region_queue_${index} ON prospecting_candidates(${candidateOrderSql}) WHERE ${regionMembershipSql(id, "prospecting_candidates").replaceAll("prospecting_candidates.", "")}`),
    "CREATE INDEX IF NOT EXISTS prospecting_positioned_sieve ON prospecting_candidates(id,latitude,longitude,suggested_latitude,suggested_longitude,scope_tier,segment_fit,review_status,size_label,operating_size,qualification_status,lead_score,cnpj,lead_tier) WHERE latitude IS NOT NULL OR suggested_latitude IS NOT NULL",
  ];
}
