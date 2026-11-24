import { backup } from "../lib/backup.mjs";
import { close } from "../lib/db.mjs";
console.log(await backup());
await close();
