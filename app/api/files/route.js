import { randomUUID } from "node:crypto";
import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { get, query, update, transaction } from "../../../lib/db.mjs";
import { fail, materialAllowed, audit } from "../../../lib/domain.mjs";
import { canWrite } from "../../../lib/model.mjs";
import { putFile } from "../../../lib/storage.mjs";
import { errorResponse } from "../../../lib/http.mjs";
export const runtime = "nodejs";
export async function POST(request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    if (!canWrite(u.role, "materials"))
      fail("Sem permissão para anexar materiais.", 403);
    if (Number(request.headers.get("content-length") || 0) > 4000000)
      fail("Limite de upload: 3 MB por arquivo.", 413);
    const f = await request.formData(),
      file = f.get("file"),
      materialId = f.get("material_id"),
      m = await get("materials", materialId);
    if (!m || !materialAllowed(u, m)) fail("Material indisponível.", 403);
    if (m.status !== "Rascunho")
      fail("Anexe o arquivo em uma versão de rascunho.");
    if (!file || !file.name || file.size > 3000000)
      fail("Arquivo inválido ou maior que 3 MB.");
    const ext = file.name.split(".").at(-1).toLowerCase();
    if (
      ![
        "pdf",
        "docx",
        "xlsx",
        "png",
        "jpg",
        "jpeg",
        "csv",
        "kml",
        "zip",
      ].includes(ext)
    )
      fail("Formato de arquivo não permitido.");
    const id = randomUUID();
    await putFile(
      id,
      Buffer.from(await file.arrayBuffer()),
      file.type || "application/octet-stream",
    );
    await transaction(async () => {
      await query(
        "INSERT INTO files(id,material_id,filename,content_type,storage_key,size_bytes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          m.id,
          file.name.replace(/[\r\n]/g, ""),
          file.type || "application/octet-stream",
          id,
          file.size,
          new Date().toISOString(),
        ],
      );
      const saved = await update(
        "materials",
        m.id,
        { ...m, file_id: id },
        m.version,
      );
      await audit(u, "materials", m.id, "arquivo anexado", m, saved);
    });
    return Response.json({ id });
  } catch (e) {
    return errorResponse(e);
  }
}
