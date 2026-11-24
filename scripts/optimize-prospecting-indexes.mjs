import { query, close, isPostgres } from "../lib/db.mjs";
import { prospectingIndexStatements } from "../lib/prospecting-indexes.mjs";

try {
  if (isPostgres()) throw new Error("Este ajuste é específico do banco SQLite/libSQL.");
  for (const sql of prospectingIndexStatements()) {
    const start = performance.now();
    await query(sql);
    console.log(JSON.stringify({ index: sql.match(/EXISTS (\w+)/)[1], ms: Math.round(performance.now() - start) }));
  }
} finally { await close(); }
