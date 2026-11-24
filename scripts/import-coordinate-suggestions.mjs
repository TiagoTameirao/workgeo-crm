import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { migrate, close, isPostgres, isTurso } from "../lib/db.mjs";
import { importCoordinateSuggestions } from "../lib/prospecting-candidates.mjs";
import { readProspectingSnapshot } from "../lib/prospecting-snapshot-csv.mjs";

const input = path.resolve(process.argv[2] || "deliverables/prospecting-cnpj/suggestions-2026-10-expanded.csv");
if (!isPostgres() && !isTurso()) throw new Error("A carga oficial exige PostgreSQL ou Turso; SQLite não é suportado.");
const systemUser = { id: null, name: "IBGE CNEFE 2022", role: "Administrador" };
const digest = createHash("sha256");
let received = 0, matched = 0, updated = 0, skipped = 0, notFound = 0, batches = 0;
const source = createReadStream(input);
try {
  await migrate();
  const records = await readProspectingSnapshot(source, async (rows) => {
    const result = await importCoordinateSuggestions(systemUser, rows);
    received += result.received;
    matched += result.matched;
    updated += result.updated;
    skipped += result.skipped;
    notFound += result.not_found;
    batches++;
    if (batches % 10 === 0) console.log(JSON.stringify({ batches, received, matched, updated, skipped, not_found: notFound }));
  }, 250, (chunk) => digest.update(chunk));
  console.log(JSON.stringify({ status: "complete", input, sha256: digest.digest("hex"), records, batches, matched, updated, skipped, not_found: notFound }));
} finally {
  source.destroy();
  await close();
}
