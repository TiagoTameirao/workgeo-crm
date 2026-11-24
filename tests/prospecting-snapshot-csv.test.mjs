import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readProspectingSnapshot } from "../lib/prospecting-snapshot-csv.mjs";

test("streaming parser preserves semicolons, escaped quotes, newlines, UTF-8 chunk boundaries and batches", async () => {
  const source = 'cnpj;company_name;address\r\n12345678000199;"Empresa; ""A""";"Rua um\nbloco dois"\r\n12345678000199;"Mineração Árvore";Centro';
  const bytes = Buffer.from(source);
  const chunks = [bytes.subarray(0, 37), bytes.subarray(37, 61), bytes.subarray(61)];
  const batches = [], imported = await readProspectingSnapshot(Readable.from(chunks), async (rows) => batches.push(rows), 1);
  assert.equal(imported, 2); assert.equal(batches.length, 2);
  assert.equal(batches[0][0].company_name, 'Empresa; "A"');
  assert.equal(batches[0][0].address, "Rua um\nbloco dois");
  assert.equal(batches[1][0].company_name, "Mineração Árvore");
});

test("streaming parser rejects inconsistent field counts and unterminated quotes", async () => {
  await assert.rejects(readProspectingSnapshot(Readable.from([Buffer.from("cnpj;company_name\n1;Nome;extra")]), async () => {}), /campos/);
  await assert.rejects(readProspectingSnapshot(Readable.from([Buffer.from('cnpj;company_name\n1;"Nome')]), async () => {}), /aspa/);
});
