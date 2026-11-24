import { readFile } from "node:fs/promises";
import { migrate, close } from "../lib/db.mjs";
import { decryptBackup, restoreSnapshot } from "../lib/backup.mjs";
if (!process.argv[2])
  throw new Error("Informe o caminho do backup criptografado.");
await migrate();
await restoreSnapshot(decryptBackup(await readFile(process.argv[2])));
await close();
console.log("Restauração concluída em base vazia.");
