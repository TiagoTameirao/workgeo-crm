import { requireUser, checkOrigin } from "../../../../../../lib/auth.mjs";
import { get, query } from "../../../../../../lib/db.mjs";
import { fail, messagingRoles } from "../../../../../../lib/domain.mjs";
import { readStoredFile } from "../../../../../../lib/storage.mjs";
import { retryWhatsappAttachment } from "../../../../../../lib/messaging.mjs";
import { errorResponse } from "../../../../../../lib/http.mjs";

export async function GET(request, { params }) {
  try {
    const user = await requireUser();
    if (!messagingRoles.includes(user.role)) fail("Sem permissão de atendimento.", 403);
    const { id, index } = await params;
    if (!/^\d+$/.test(index)) fail("Anexo não encontrado.", 404);
    const position = Number(index);
    const message = await get("messages", id);
    let attachment = message?.attachments?.[position];
    if (!message) {
      const row = (await query("SELECT data FROM inbox_events WHERE id=$1", [id]))[0];
      if (row) attachment = JSON.parse(row.data).attachments?.[position];
    }
    if (!attachment?.storage_key || !/^(?:mail|whatsapp)-attachment-[\w-]+$/.test(attachment.storage_key))
      fail("Anexo não encontrado.", 404);
    const filename = String(attachment.filename || "anexo").replace(/[\r\n"\\/]/g, "_");
    const contentType = /^[\w.+-]+\/[\w.+-]+(?:;\s*charset=[\w-]+)?$/i.test(attachment.contentType || "")
      ? attachment.contentType
      : "application/octet-stream";
    const safeFallback = filename.replace(/[^\x20-\x7E]/g, "_");
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase());
    const bytes = await readStoredFile(attachment.storage_key);
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeFallback}"; filename*=UTF-8''${encoded}`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request, { params }) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    const { id, index } = await params;
    if (!/^\d+$/.test(index)) fail("Anexo não encontrado.", 404);
    return Response.json(await retryWhatsappAttachment(user, id, Number(index)));
  } catch (error) {
    return errorResponse(error);
  }
}