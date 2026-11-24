import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationDigest, migrationRow } from "../lib/migration-integrity.mjs";

const columns = [{ name: "id", type: "text" }, { name: "data", type: "text" }, { name: "review_note", type: "text" }, { name: "size_bytes", type: "bigint" }, { name: "active", type: "boolean" }];
const row = { id: "id-preservado", data: '{"cnpj":"00000000000001","qualification_evidence":"Ligação com responsável"}', review_note: "Confirmado pela equipe — não substituir", size_bytes: "22000000", active: true };
const digest = (value) => { const hash = migrationDigest(); hash.add(value, columns); return hash.finish(); };
test("reconciliação aceita representação PostgreSQL/libSQL equivalente sem alterar textos ou IDs", () => {
  assert.deepEqual(digest(row), digest({ ...row, size_bytes: 22000000, active: 1 }));
  assert.equal(migrationRow(row, columns)[0], row.id);
});
test("perda de nota, qualificação, vínculo ou ID altera a conferência", () => {
  for (const changed of [{ review_note: "" }, { data: "{}" }, { id: "novo-id" }]) assert.notEqual(digest(row).sha256, digest({ ...row, ...changed }).sha256);
});
test("coluna ausente e inteiro sem representação segura impedem alegar migração integral", () => {
  const { review_note, ...missing } = row;
  assert.throws(() => digest(missing), /Coluna ausente/);
  assert.throws(() => digest({ ...row, size_bytes: "9007199254740993" }), /representação exata/);
});
