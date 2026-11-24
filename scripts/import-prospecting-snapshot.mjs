import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { migrate, close, isPostgres, isTurso } from "../lib/db.mjs";
import { importCandidateBatch } from "../lib/prospecting-candidates.mjs";
import { readProspectingSnapshot } from "../lib/prospecting-snapshot-csv.mjs";

const input = path.resolve(process.argv[2] || "deliverables/prospecting-cnpj/prospecting-cnpj-2026-10.csv");
if (!isPostgres() && !isTurso()) throw new Error("A carga oficial exige PostgreSQL ou Turso; SQLite não é suportado.");
const systemUser = { id: null, name: "Snapshot CNPJ Receita Federal", role: "Administrador" };
const digest = createHash("sha256");
let inserted = 0, updated = 0, batches = 0;
const pending = [];
async function flushBatches() {
  const results = await Promise.all(pending.splice(0));
  for (const result of results) {
    inserted += result.inserted;
    updated += result.updated;
    batches++;
  }
  if (batches && batches % 10 === 0) console.log(JSON.stringify({ batches, processed: inserted + updated, inserted, updated }));
}
const source = createReadStream(input);
try {
  await migrate();
  const records = await readProspectingSnapshot(source, async (rows) => {
    pending.push(importCandidateBatch(systemUser, rows));
    if (pending.length >= 5) await flushBatches();
  }, 250, (chunk) => digest.update(chunk));
  if (pending.length) await flushBatches();
  console.log(JSON.stringify({ status: "complete", input, sha256: digest.digest("hex"), records, batches, inserted, updated, contacted: 0, converted_to_clients: 0 }));
} finally {
  source.destroy();
  await close();
}
