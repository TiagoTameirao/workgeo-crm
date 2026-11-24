import { readFile, writeFile } from "node:fs/promises";
import { seed } from "../lib/seed.mjs";
import { pointInTerritory } from "../lib/geo.mjs";
import { query, get, update, close, transaction } from "../lib/db.mjs";
import { audit } from "../lib/domain.mjs";
const report = JSON.parse(await readFile("data/geocoding-report.json", "utf8"));
for (const item of report) {
  if (item.id === "unit-006") {
    item.status = "Conflito no link Maps";
    item.issue =
      "O link fornecido para Campos Laminadora de Pneus aponta para Transportadora Kairós Log Ltda. Conferir localização antes de posicionar.";
    continue;
  }
  if (item.latitude == null || item.longitude == null) continue;
  const u = seed.units.find((u) => u.id === item.id);
  Object.assign(u, {
    latitude: item.latitude,
    longitude: item.longitude,
    geo_status: pointInTerritory(
      item.longitude,
      item.latitude,
      seed.territory.geometry.coordinates[0],
    ),
    geo_source: u.maps_url,
    geo_source_date: "2026-10-13",
    geo_evidence:
      "Coordenadas extraídas do ponto do link Maps fornecido; visita à unidade não confirmada.",
  });
}
seed.issues.push({
  unit_id: "unit-006",
  description: report.find((r) => r.id === "unit-006").issue,
});
await writeFile("data/seed.json", JSON.stringify(seed, null, 2) + "\n");
await writeFile(
  "data/geocoding-report.json",
  JSON.stringify(report, null, 2) + "\n",
);
if (process.env.DATABASE_URL) {
  for (const schema of ["crm_development", "crm_preview", "crm_production"]) {
    process.env.CRM_DB_SCHEMA = schema;
    for (const u of seed.units) {
      const old = await get("units", u.id);
      if (!old || old.latitude != null) continue;
      await transaction(async () => {
        const enriched = {
          ...old,
          ...Object.fromEntries(
            Object.entries(u).filter(
              ([k]) =>
                k.startsWith("geo_") || ["latitude", "longitude"].includes(k),
            ),
          ),
        };
        if (u.id === "unit-006")
          enriched.geo_issue = report.find((r) => r.id === u.id).issue;
        await update("units", u.id, enriched, old.version);
        await audit(
          null,
          "units",
          u.id,
          "extração de localização do link fornecido",
          old,
          enriched,
        );
      });
    }
    console.log(schema, "localizações incorporadas");
    await close();
  }
}
console.log({
  positioned: seed.units.filter((u) => u.latitude != null).length,
  conflicts: seed.issues.filter((i) => i.unit_id === "unit-006"),
});
