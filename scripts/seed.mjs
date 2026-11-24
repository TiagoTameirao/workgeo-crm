import { migrate, close } from "../lib/db.mjs";
import { seedDatabase } from "../lib/seed.mjs";
await migrate();
console.log(await seedDatabase());
await close();
