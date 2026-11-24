import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { close, isTurso, query } from "../lib/db.mjs";
import { readProspectingSnapshot } from "../lib/prospecting-snapshot-csv.mjs";

const input = path.resolve(process.argv[2] || "deliverables/prospecting-cnpj-2026-10/coordinate-suggestions-cnefe-20261029.csv");
const backupDirectory = path.resolve("backups/ultrafine-integration-2026-11-04");
const backupPath = path.join(backupDirectory, "coordinate-suggestions-before-import.enc");
const dryRun = process.argv.includes("--dry-run");
const sourceHash = createHash("sha256");
const cnpjs = [];
if (!/^[a-f0-9]{64}$/i.test(process.env.BACKUP_KEY || "") && existsSync(".env.local")) {
  delete process.env.BACKUP_KEY;
  process.loadEnvFile(".env.local");
}
const backupKey = Buffer.from(process.env.BACKUP_KEY || "", "hex");

if (!dryRun && !isTurso()) throw new Error("A cópia para esta tarefa exige a conexão Turso de produção.");
if (!dryRun && backupKey.length !== 32) throw new Error("BACKUP_KEY precisa estar configurada para a cópia criptografada.");

try {
  const rows = await readProspectingSnapshot(createReadStream(input), async (batch) => {
    for (const row of batch) {
      const cnpj = String(row.cnpj || "").replace(/[.\-/]/g, "");
      if (!/^\d{14}$/.test(cnpj)) throw new Error(`CNPJ inválido no arquivo: ${row.cnpj}`);
      cnpjs.push(cnpj);
    }
  }, 250, (chunk) => sourceHash.update(chunk));
  const sha256 = sourceHash.digest("hex");
  if (new Set(cnpjs).size !== rows) throw new Error("O arquivo de coordenadas contém CNPJs repetidos.");
  if (dryRun) {
    console.log(JSON.stringify({ status: "validated", rows, unique_cnpjs: new Set(cnpjs).size, source_sha256: sha256 }));
  } else {
    mkdirSync(backupDirectory, { recursive: true });
    if (existsSync(backupPath)) {
      const bytes = readFileSync(backupPath);
      if (bytes.subarray(0, 5).toString() !== "WGUF1") throw new Error(`Cópia existente não reconhecida: ${backupPath}`);
      const decipher = createDecipheriv("aes-256-gcm", backupKey, bytes.subarray(5, 17));
      decipher.setAuthTag(bytes.subarray(17, 33));
      const content = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(33)), decipher.final()]).toString("utf8"));
      if (content.source_sha256 !== sha256 || content.source_rows !== rows) throw new Error("A cópia existente pertence a outra versão do arquivo.");
      console.log(JSON.stringify({ status: "already_backed_up", backup: backupPath, source_rows: rows, matched: content.rows.length, source_sha256: sha256 }));
    } else {
      const oldCoordinates = [];
      for (let index = 0; index < cnpjs.length; index += 250) {
        const batch = cnpjs.slice(index, index + 250);
        oldCoordinates.push(...await query(`SELECT cnpj,suggested_latitude,suggested_longitude,geocode_source,geocode_date,geocode_confidence,geocode_match_method,geocoded_at FROM prospecting_candidates WHERE cnpj IN (${batch.map((_, i) => `$${i + 1}`).join(",")})`, batch));
        if ((index + 250) % 25000 === 0 || index + 250 >= cnpjs.length) console.log(JSON.stringify({ checked: Math.min(index + 250, cnpjs.length), total: cnpjs.length, matched: oldCoordinates.length }));
      }
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", backupKey, iv);
      const plaintext = Buffer.from(JSON.stringify({ created_at: new Date().toISOString(), source_sha256: sha256, source_rows: rows, rows: oldCoordinates }));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      writeFileSync(backupPath, Buffer.concat([Buffer.from("WGUF1"), iv, cipher.getAuthTag(), ciphertext]), { flag: "wx" });
      console.log(JSON.stringify({ status: "backup_complete", backup: backupPath, source_rows: rows, matched: oldCoordinates.length, source_sha256: sha256 }));
    }
  }
} finally {
  await close();
}
