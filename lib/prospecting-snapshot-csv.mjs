import { StringDecoder } from "node:string_decoder";

export async function readProspectingSnapshot(stream, onBatch, batchSize = 250, onChunk = () => {}) {
  const decoder = new StringDecoder("utf8");
  let headers = null, row = [], cell = "", inQuotes = false, quotePending = false, skipLf = false;
  let batch = [], records = 0;
  async function finishRow() {
    row.push(cell); cell = "";
    if (!row.some((value) => value.trim())) { row = []; return; }
    if (!headers) headers = row.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "").trim() : value.trim());
    else {
      if (row.length !== headers.length) throw new Error(`Linha ${records + batch.length + 2} tem ${row.length} campos; esperado ${headers.length}.`);
      batch.push(Object.fromEntries(headers.map((key, index) => [key, row[index]])));
      if (batch.length >= batchSize) { const sent = batch; batch = []; await onBatch(sent); records += sent.length; }
    }
    row = [];
  }
  async function consume(chunk) {
    for (const ch of chunk) {
      if (skipLf) { skipLf = false; if (ch === "\n") continue; }
      if (inQuotes) {
        if (quotePending) {
          if (ch === '"') { cell += '"'; quotePending = false; continue; }
          inQuotes = false; quotePending = false;
        } else if (ch === '"') { quotePending = true; continue; }
        else { cell += ch; continue; }
      }
      if (ch === '"' && cell.length === 0) inQuotes = true;
      else if (ch === ";") { row.push(cell); cell = ""; }
      else if (ch === "\r" || ch === "\n") { await finishRow(); if (ch === "\r") skipLf = true; }
      else cell += ch;
    }
  }
  for await (const bytes of stream) {
    onChunk(bytes);
    await consume(decoder.write(bytes));
  }
  const remaining = decoder.end();
  await consume(remaining);
  if (quotePending) { quotePending = false; inQuotes = false; }
  if (inQuotes) throw new Error("O CSV termina com uma aspa sem fechamento.");
  if (cell.length || row.length) await finishRow();
  if (!headers?.includes("cnpj")) throw new Error("O arquivo não tem coluna cnpj.");
  if (batch.length) { const sent = batch; batch = []; await onBatch(sent); records += sent.length; }
  return records;
}
