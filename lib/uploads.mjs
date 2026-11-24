import { head } from "@vercel/blob";
import { query, get, update, transaction } from "./db.mjs";
import { materialAllowed, fail, audit } from "./domain.mjs";
import { canWrite } from "./model.mjs";
export async function completeUpload(user, key) {
  if (!/^[a-f0-9-]{36}$/.test(key)) fail("Identificador de upload inválido.");
  const ticket = JSON.parse(
    (await query("SELECT data FROM settings WHERE id=$1", ["upload:" + key]))[0]
      ?.data || "null",
  );
  if (!ticket || ticket.user_id !== user.id || Date.now() > ticket.expires)
    fail("Upload não autorizado ou expirado.", 403);
  const meta = await head("files/" + key);
  if (meta.size !== ticket.size || meta.pathname !== "files/" + key)
    fail("Arquivo não corresponde ao upload autorizado.");
  return transaction(async () => {
    const m = await get("materials", ticket.material_id);
    if (
      !m ||
      !materialAllowed(user, m) ||
      !canWrite(user.role, "materials") ||
      m.status !== "Rascunho"
    )
      fail("Material indisponível para anexar.", 403);
    if ((await query("SELECT id FROM files WHERE id=$1", [key]))[0]) return m;
    await query(
      "INSERT INTO files(id,material_id,filename,content_type,storage_key,size_bytes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        key,
        m.id,
        ticket.filename,
        meta.contentType || "application/octet-stream",
        key,
        meta.size,
        new Date().toISOString(),
      ],
    );
    const updated = await update(
      "materials",
      m.id,
      { ...m, file_id: key },
      m.version,
    );
    await audit(user, "materials", m.id, "arquivo privado anexado", m, updated);
    return updated;
  });
}
