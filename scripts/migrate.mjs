import { migrate, close } from "../lib/db.mjs";
if (process.env.DATABASE_URL_UNPOOLED)
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
await migrate();
await close();
console.log("Migrações de schema concluídas.");
