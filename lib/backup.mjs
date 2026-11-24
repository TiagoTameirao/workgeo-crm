import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { query, transaction, isPostgres } from "./db.mjs";
import { entityKeys } from "./model.mjs";
import { putFile, readStoredFile } from "./storage.mjs";
import { fail } from "./domain.mjs";
export const backupTables = [
  "users",
  ...[
    "companies",
    "units",
    "contacts",
    "opportunities",
    "proposals",
    "contracts",
    "services",
    "materials",
    "requests",
    "conversations",
    "messages",
    "activities",
    "templates",
    "invoices",
    "receipts",
    "admin_documents",
    "renewals",
  ],
  "allocations",
  "audit",
  "settings",
  "files",
  "inbox_events",
  "pilot_feedback",
  "prospecting_candidates",
  "prospecting_activities",
  "user_profiles",
  "notifications",
  "flight_authorizations",
  "flight_files",
  "record_files",
  "bulletin_versions",
  "document_analyses",
];
function key() {
  const k = Buffer.from(process.env.BACKUP_KEY || "", "hex");
  if (k.length !== 32)
    fail("Configure BACKUP_KEY com 32 bytes hexadecimais.", 503);
  return k;
}
export function encryptBackup(data) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv),
    bytes = Buffer.concat([
      cipher.update(JSON.stringify(data), "utf8"),
      cipher.final(),
    ]);
  return Buffer.concat([Buffer.from("WG01"), iv, cipher.getAuthTag(), bytes]);
}
export function decryptBackup(bytes) {
  if (bytes.subarray(0, 4).toString() !== "WG01")
    fail("Formato de backup inválido.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    bytes.subarray(4, 16),
  );
  decipher.setAuthTag(bytes.subarray(16, 32));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(32)),
      decipher.final(),
    ]).toString(),
  );
}
export async function snapshot() {
  const tables = await transaction(async () => {
    if (isPostgres())
      await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const tables = {};
    const agendaMigrated = (await query("SELECT version FROM schema_versions WHERE version=13")).length > 0;
    const flightsMigrated = (await query("SELECT version FROM schema_versions WHERE version=14")).length > 0;
    const documentsMigrated = (await query("SELECT version FROM schema_versions WHERE version=17")).length > 0;
    for (const name of backupTables)
      tables[name] = !documentsMigrated && ["record_files","bulletin_versions","document_analyses"].includes(name) ? [] : !flightsMigrated && ["flight_authorizations", "flight_files"].includes(name) ? [] : !agendaMigrated && ["user_profiles", "notifications"].includes(name) ? [] : await query(`SELECT * FROM ${name}`);
    return tables;
  });
  const binaries = {};
  for(const file of tables.record_files || [])binaries[file.storage_key]=(await readStoredFile(file.storage_key)).toString('base64');
  for (const f of tables.files)
    binaries[f.storage_key] = (await readStoredFile(f.storage_key)).toString(
      "base64",
    );
  for (const file of tables.flight_files || []) binaries[file.storage_key] = (await readStoredFile(file.storage_key)).toString("base64");
  const attachmentKeys = new Set();
  for (const message of tables.messages) {
    const data = typeof message.data === "string" ? JSON.parse(message.data) : message.data;
    for (const attachment of data.attachments || [])
      if (attachment.storage_key) attachmentKeys.add(attachment.storage_key);
  }
  for (const row of tables.inbox_events) {
    const event = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    for (const attachment of event.attachments || [])
      if (attachment.storage_key) attachmentKeys.add(attachment.storage_key);
  }
  for (const storageKey of attachmentKeys)
    binaries[storageKey] = (await readStoredFile(storageKey)).toString("base64");
  return {
    schemaVersion: 2,
    created_at: new Date().toISOString(),
    tables,
    binaries,
  };
}
export async function backup() {
  const started_at=new Date().toISOString();
  const record=async data=>query('INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2',['last-backup-attempt',JSON.stringify(data)]);
  await record({started_at,status:'Em andamento'});
  try {
    const result=await completeBackup();
    await record({started_at,finished_at:new Date().toISOString(),status:'Concluído',records:result.records});
    return result;
  } catch(error) {
    await record({started_at,finished_at:new Date().toISOString(),status:'Falhou',message:'A cópia não foi concluída. Preserve a última cópia válida e confira a recuperação.'}).catch(()=>{});
    throw error;
  }
}
async function completeBackup() {
  const content = await snapshot();
  const key = "backup-" + new Date().toISOString().replace(/[:.]/g, "-");
  await putFile(key, encryptBackup(content), "application/octet-stream");
  await query(
    "INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2",
    [
      "last-backup",
      JSON.stringify({
        key,
        date: new Date().toISOString(),
        status: "Concluído",
      }),
    ],
  );
  return {
    key,
    records: Object.values(content.tables).reduce((n, r) => n + r.length, 0),
  };
}
export async function restoreSnapshot(snapshot) {
  if (snapshot.schemaVersion !== 2 || !snapshot.tables)
    fail("Versão de backup incompatível.");
  await transaction(async () => {
    for (const name of backupTables)
      if ((await query(`SELECT COUNT(*) AS n FROM ${name}`))[0].n > 0)
        fail(
          "Restaure somente em uma base vazia; a base existente não será sobrescrita.",
        );
    for (const name of backupTables) {
      for (const row of snapshot.tables[name] || []) {
        const cols = Object.keys(row);
        if (cols.some((c) => !/^\w+$/.test(c)))
          fail("Colunas de backup inválidas.");
        await query(
          `INSERT INTO ${name} (${cols.join(",")}) VALUES(${cols.map((_, i) => "$" + (i + 1)).join(",")})`,
          Object.values(row),
        );
      }
    }
  });
  for (const [key, encoded] of Object.entries(snapshot.binaries || {}))
    await putFile(
      key,
      Buffer.from(encoded, "base64"),
      "application/octet-stream",
    );
}
