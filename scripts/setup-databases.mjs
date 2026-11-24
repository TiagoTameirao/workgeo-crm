import { migrate, close } from "../lib/db.mjs";
import { seedDatabase } from "../lib/seed.mjs";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurado.");
if (process.env.DATABASE_URL_UNPOOLED)
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
for (const schema of ["crm_development", "crm_preview", "crm_production"]) {
  process.env.CRM_DB_SCHEMA = schema;
  await migrate();
  const result = await seedDatabase();
  console.log(schema, result);
  await close();
}
