import { seed } from "../lib/seed.mjs";
import { get, update, close } from "../lib/db.mjs";
if (process.env.DATABASE_URL)
  throw new Error("Este script é exclusivo da base local de testes.");
for (const u of seed.units) {
  const old = await get("units", u.id);
  if (old)
    await update(
      "units",
      u.id,
      {
        ...old,
        ...Object.fromEntries(
          Object.entries(u).filter(
            ([k]) =>
              k.startsWith("geo_") || ["latitude", "longitude"].includes(k),
          ),
        ),
      },
      old.version,
    );
}
await close();
console.log("Mapa da base local de testes atualizado.");
