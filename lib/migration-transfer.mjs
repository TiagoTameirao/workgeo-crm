import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { decryptBackup, encryptBackup } from "./backup.mjs";
import { migrationDigest, migrationRow } from "./migration-integrity.mjs";

export async function importMigration(client, directory, { resume = false, allowRecovery = false } = {}) {
  const manifestBytes = await readFile(path.join(directory, "manifest.enc"));
  const manifest = decryptBackup(manifestBytes);
  const permittedKind = manifest.kind === "workgeo-postgres-migration" || (allowRecovery && manifest.kind === "workgeo-authorized-recovery" && manifest.authorization?.date === "2026-10-26");
  if (!permittedKind || manifest.complete !== true || !manifest.tables.some((table) => table.name === "prospecting_candidates"))
    throw new Error("A exportação atual e completa da fonte é obrigatória. CSV público e cópia parcial não são aceitos.");
  const execute = async (sql, args = []) => {
    for (let attempt = 0; ; attempt++) {
      try { return (await client.execute({ sql, args })).rows; }
      catch (error) {
        const code = error.cause?.code || error.code;
        if (attempt >= 3 || !["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_CONTENT_LENGTH_MISMATCH", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "HRANA_WEBSOCKET_ERROR"].includes(code)) throw error;
        console.log(`Conexão transitória; repetindo comando idempotente (${attempt + 1}/3).`);
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  };
  const tables = new Map(manifest.tables.map((table) => [table.name, table]));
  const ordered = [], visiting = new Set(), visited = new Set();
  function visit(table) {
    if (visited.has(table.name)) return;
    if (visiting.has(table.name)) throw new Error(`Vínculo circular exige revisão: ${table.name}`);
    visiting.add(table.name);
    for (const parent of table.parents || []) if (parent !== table.name && tables.has(parent)) visit(tables.get(parent));
    visiting.delete(table.name); visited.add(table.name); ordered.push(table);
  }
  for (const table of tables.values()) {
    if (![table.name, table.key, ...table.columns.map((column) => column.name)].every((name) => /^[a-z][a-z0-9_]*$/.test(name))) throw new Error("Identificador inválido no manifesto.");
    if (!(await execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table.name])).length) throw new Error(`Tabela não preparada no destino: ${table.name}`);
    if (table.name !== "schema_versions" && !resume && Number((await execute(`SELECT COUNT(*) AS n FROM ${table.name}`))[0].n)) throw new Error("A carga inicial exige destino vazio; não sobrescreva o banco de um site em uso.");
    const source = migrationDigest();
    for (const filename of table.files) {
      if (!/^[a-z0-9_-]+\.enc$/.test(filename)) throw new Error("Arquivo inválido no manifesto.");
      const part = decryptBackup(await readFile(path.join(directory, filename)));
      if (part.table !== table.name) throw new Error("Tabela divergente no arquivo criptografado.");
      part.rows.forEach((row) => source.add(row, table.columns));
    }
    const result = source.finish();
    if (result.count !== table.count || result.sha256 !== table.sha256) throw new Error(`Exportação incompleta ou alterada: ${table.name}`);
    visit(table);
  }
  for (const table of ordered) {
    let transferred = 0;
    const columns = table.columns.map((column) => column.name);
    const conflict = table.name === "schema_versions" ? " DO UPDATE SET applied_at=excluded.applied_at" : " DO NOTHING";
    const rowParameters = `(${columns.map(() => "?").join(",")})`;
    for (const filename of table.files) {
      const part = decryptBackup(await readFile(path.join(directory, filename)));
      if (resume && part.rows.length) {
        const existing = await execute(`SELECT * FROM ${table.name} WHERE ${table.key}>=? AND ${table.key}<=? ORDER BY ${table.key}`, [part.rows[0][table.key], part.rows.at(-1)[table.key]]);
        const expectedDigest = migrationDigest(), actualDigest = migrationDigest();
        part.rows.forEach((row) => expectedDigest.add(row, table.columns));
        existing.forEach((row) => actualDigest.add(row, table.columns));
        const expected = expectedDigest.finish(), actual = actualDigest.finish();
        if (expected.count === actual.count && expected.sha256 === actual.sha256) {
          transferred += part.rows.length;
          if (transferred % 5000 === 0) console.log(`${table.name}: ${transferred}/${table.count} conferidos`);
          continue;
        }
      }
      for (let start = 0; start < part.rows.length; start += 250) {
        const rows = part.rows.slice(start, start + 250);
        await execute(`INSERT INTO ${table.name}(${columns.join(",")}) VALUES${rows.map(() => rowParameters).join(",")} ON CONFLICT(${table.key})${conflict}`, rows.flatMap((row) => migrationRow(row, table.columns)));
        transferred += rows.length;
        if (transferred % 5000 === 0) console.log(`${table.name}: ${transferred}/${table.count}`);
      }
    }
    console.log(`${table.name}: carga concluída; conferência integral a seguir`);
  }
  const report = { source_kind: manifest.kind, manifest_sha256: createHash("sha256").update(manifestBytes).digest("hex"), source_at: manifest.created_at, verified_at: new Date().toISOString(), tables: [] };
  for (const table of ordered) {
    const digest = migrationDigest();
    const versions = [];
    if (table.name === "schema_versions") for (const filename of table.files) {
      const part = decryptBackup(await readFile(path.join(directory, filename)));
      versions.push(...part.rows.map((row) => row[table.key]));
    }
    let last;
    for (;;) {
      const filters = [], args = [];
      if (table.name === "schema_versions") {
        if (!versions.length) break;
        filters.push(`${table.key} IN (${versions.map(() => "?").join(",")})`); args.push(...versions);
      }
      if (last !== undefined) { filters.push(`${table.key}>?`); args.push(last); }
      const rows = await execute(`SELECT * FROM ${table.name}${filters.length ? " WHERE " + filters.join(" AND ") : ""} ORDER BY ${table.key} LIMIT 1000`, args);
      if (!rows.length) break;
      for (const row of rows) {
        digest.add(row, table.columns);
      }
      last = rows.at(-1)[table.key];
    }
    const result = digest.finish();
    if (result.count !== table.count || result.sha256 !== table.sha256) throw new Error(`Destino não reconciliado integralmente: ${table.name}`);
    report.tables.push({ name: table.name, scope: table.name === "schema_versions" ? "Versões da fonte; novas migrações do destino são preservadas" : "Tabela integral", ...result });
  }
  if ((await execute("PRAGMA foreign_key_check")).length) throw new Error("Existem vínculos inconsistentes no destino.");
  await writeFile(path.join(directory, "target-verification.enc"), encryptBackup(report));
  return report;
}
