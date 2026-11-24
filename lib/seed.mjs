import seed from "../data/seed.json" with { type: "json" };
import { transaction, query, insert } from "./db.mjs";
export { seed };
export async function seedDatabase() {
  return transaction(async () => {
    if (
      (
        await query("SELECT id FROM settings WHERE id=$1", ["initial-import"])
      )[0]
    )
      return { alreadyImported: true };
    for (const u of seed.units)
      if (
        !(
          await query("SELECT id FROM companies WHERE id=$1", [u.company_id])
        )[0]
      )
        await insert(
          "companies",
          {
            name: u.company_name,
            source: u.source,
            notes:
              u.company_id === "company-lhoist"
                ? "Agrupamento pelo nome nas duas unidades do arquivo; identidade jurídica a confirmar."
                : "",
          },
          u.company_id,
        );
    for (const u of seed.units) await insert("units", u, u.id);
    for (const c of seed.contacts) await insert("contacts", c, c.id);
    await query("INSERT INTO settings(id,data) VALUES($1,$2)", [
      "territory",
      JSON.stringify(seed.territory),
    ]);
    await query("INSERT INTO settings(id,data) VALUES($1,$2)", [
      "initial-import",
      JSON.stringify({
        date: new Date().toISOString(),
        units: seed.units.length,
        contacts: seed.contacts.length,
        issues: seed.issues,
        excludedNumberOnly: 40,
        source: "Planilha fornecida pelo usuário",
        grouping: "Lhoist agrupada por nome; CNPJ não confirmado.",
      }),
    ]);
    return { units: seed.units.length, contacts: seed.contacts.length };
  });
}
