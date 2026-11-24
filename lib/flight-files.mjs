import { randomUUID, createHash } from "node:crypto";
import { query, transaction } from "./db.mjs";
import { fail, audit } from "./domain.mjs";
import { flightEditors } from "./access.mjs";
import { getFlight, flightFileKinds } from "./flights.mjs";
import { putFile } from "./storage.mjs";

export function inspectFlightFile(filename, bytes) {
  if (typeof filename !== "string" || !filename || filename.length > 200 || !bytes.length || bytes.length > 30000000) fail("Envie um PDF, PNG ou JPG com até 30 MB.");
  const extension = filename.split(".").at(-1).toLowerCase();
  const types = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
  const valid = extension === "pdf" ? bytes.subarray(0, 5).toString() === "%PDF-" : extension === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : ["jpg", "jpeg"].includes(extension) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) fail("O conteúdo não corresponde a um PDF, PNG ou JPG válido.");
  return { filename: filename.replace(/[\x00-\x1f\x7f/\\"]/g, "_"), content_type: types[extension], sha256: createHash("sha256").update(bytes).digest("hex") };
}
export async function attachFlightFile(user, flightId, kind, filename, bytes, {storageKey}={}) {
  if (!flightEditors(user)) fail("Seu perfil não pode enviar documentos de voo.", 403);
  if (!(await getFlight(user, flightId))) fail("Registro de voo não encontrado.", 404);
  if (!flightFileKinds.includes(kind)) fail("Selecione o tipo do documento.");
  const meta = inspectFlightFile(filename, bytes), id = storageKey || randomUUID();
  if(!storageKey)await putFile(id, bytes, meta.content_type);
  return transaction(async () => {
    if((await query('SELECT id FROM flight_files WHERE id=$1',[id])).length)return {id};
    await query("INSERT INTO flight_files(id,flight_id,filename,content_type,storage_key,size_bytes,kind,uploaded_by,created_at,sha256) VALUES($1,$2,$3,$4,$1,$5,$6,$7,$8,$9)", [id, flightId, meta.filename, meta.content_type, bytes.length, kind, user.id, new Date().toISOString(), meta.sha256]);
    await audit(user, "flight_files", id, "arquivo de voo anexado", null, { flight_id: flightId, kind, ...meta, size_bytes: bytes.length });
    return { id, flight_id: flightId, kind, ...meta };
  });
}
