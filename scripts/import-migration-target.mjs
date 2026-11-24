import { createClient } from "@libsql/client";
import path from "node:path";
import { importMigration } from "../lib/migration-transfer.mjs";

const [directoryArgument, ...flags] = process.argv.slice(2);
if (!directoryArgument || flags.some((flag) => !["--resume", "--recovery"].includes(flag)))
  throw new Error("Informe pasta exportada e, somente ao retomar uma carga interrompida, --resume.");
if (!/^(libsql|https):\/\//.test(process.env.TURSO_DATABASE_URL || "") || !process.env.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN === "[SENSITIVE]")
  throw new Error("Configure as variáveis privadas do Turso no ambiente de destino.");
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  await importMigration(client, path.resolve(directoryArgument), { resume: flags.includes("--resume"), allowRecovery: flags.includes("--recovery") });
  console.log("Todas as tabelas conferidas por quantidade e conteúdo. Nenhuma configuração de produção foi alterada.");
} finally { client.close(); }
