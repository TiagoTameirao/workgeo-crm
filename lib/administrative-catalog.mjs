import { query } from "./db.mjs";

export const administrativeCatalogKey = "administrative-catalog";
export const emptyAdministrativeCatalog = () => ({ version: 0, client_ids: [], service_types: [{ id: "volumetria", name: "Volumetria", active: true }] });

export async function administrativeCatalog() {
  const row = (await query("SELECT data FROM settings WHERE id=$1", [administrativeCatalogKey]))[0];
  return row ? JSON.parse(row.data) : emptyAdministrativeCatalog();
}
