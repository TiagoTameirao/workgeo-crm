import { Pool } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encryptBackup } from "../lib/backup.mjs";
import { migrationDigest } from "../lib/migration-integrity.mjs";

const schema = process.env.CRM_DB_SCHEMA;
if (!schema || !/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Informe explicitamente CRM_DB_SCHEMA da fonte.");
const sourceUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!sourceUrl || sourceUrl === "[SENSITIVE]") throw new Error("A conexão PostgreSQL da fonte não está configurada.");
const directory = path.resolve(process.argv[2] || path.join("backups", "neon-source-" + new Date().toISOString().replace(/[:.]/g, "-")));
const pool = new Pool({ connectionString: sourceUrl.replace("sslmode=require", "sslmode=verify-full"), max: 1, connectionTimeoutMillis: 15000 });
let connection;
try {
  connection = await pool.connect();
  await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tables = (await connection.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows;
  if (!tables.some((table) => table.table_name === "prospecting_candidates")) throw new Error("A fonte selecionada não contém a tabela de prospectos.");
  await mkdir(directory);
  const manifest = { kind: "workgeo-postgres-migration", complete: false, schema, created_at: new Date().toISOString(), tables: [] };
  for (const { table_name: table } of tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error("Nome de tabela não suportado; revisar a fonte sem omitir dados.");
    const columns = (await connection.query("SELECT column_name AS name,data_type AS type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position", [schema, table])).rows;
    const primary = (await connection.query("SELECT k.column_name FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k ON k.constraint_name=t.constraint_name AND k.table_schema=t.table_schema AND k.table_name=t.table_name WHERE t.table_schema=$1 AND t.table_name=$2 AND t.constraint_type='PRIMARY KEY' ORDER BY k.ordinal_position", [schema, table])).rows;
    if (primary.length !== 1) throw new Error(`A tabela ${table} exige revisão da chave antes de exportar.`);
    const key = primary[0].column_name;
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error("Chave inválida.");
    const expected = Number((await connection.query(`SELECT COUNT(*) AS n FROM ${schema}.${table}`)).rows[0].n);
    const parents = (await connection.query("SELECT DISTINCT ccu.table_name AS parent FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=$1 AND tc.table_name=$2", [schema, table])).rows.map((row) => row.parent);
    const digest = migrationDigest(), files = [];
    let last;
    for (;;) {
      const rows = (await connection.query(`SELECT * FROM ${schema}.${table}${last === undefined ? "" : ` WHERE ${key}>$1`} ORDER BY ${key} LIMIT 1000`, last === undefined ? [] : [last])).rows;
      if (!rows.length) break;
      rows.forEach((row) => digest.add(row, columns));
      const filename = `${table}-${String(files.length + 1).padStart(5, "0")}.enc`;
      await writeFile(path.join(directory, filename), encryptBackup({ table, rows }));
      files.push(filename);
      last = rows.at(-1)[key];
    }
    const result = digest.finish();
    if (result.count !== expected) throw new Error(`Contagem divergente na fonte: ${table}`);
    manifest.tables.push({ name: table, key, columns, parents, ...result, files });
    console.log(`${table}: ${result.count} registros preservados`);
  }
  await connection.query("COMMIT");
  manifest.complete = true;
  await writeFile(path.join(directory, "manifest.enc"), encryptBackup(manifest));
  console.log(`Exportação consistente concluída: ${directory}`);
} catch (error) {
  if (connection) await connection.query("ROLLBACK").catch(() => {});
  console.error(error.code || "EXPORT_FAILED", error.message);
  process.exitCode = 1;
} finally { connection?.release(); await pool.end(); }
