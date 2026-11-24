import { requireUser } from "../../../../lib/auth.mjs";
import { query, get } from "../../../../lib/db.mjs";
import { fail, materialAllowed } from "../../../../lib/domain.mjs";
import { storedFileStream } from "../../../../lib/storage.mjs";
import { errorResponse } from "../../../../lib/http.mjs";
import {getDocumentFile} from '../../../../lib/document-files.mjs';
export async function GET(request, { params }) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const legacy = (await query("SELECT * FROM files WHERE id=$1", [id]))[0];
    const f = legacy || await getDocumentFile(u,id);
    if (!f) fail("Arquivo não encontrado.", 404);
    if (legacy && !materialAllowed(u, await get("materials", f.material_id)))
      fail("Arquivo restrito.", 403);
    const filename = String(f.filename || "arquivo").replace(/[\r\n"]/g, "_");
    const extension = filename.split(".").at(-1).toLowerCase();
    const knownTypes = {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      csv: "text/csv; charset=utf-8",
      kml: "application/vnd.google-earth.kml+xml",
      zip: "application/zip",
    };
    const contentType =
      f.content_type && f.content_type !== "application/octet-stream"
        ? f.content_type
        : knownTypes[extension] || "application/octet-stream";
    const preview = new URL(request.url).searchParams.get("view") === "1";
    if (preview && contentType !== "application/pdf")
      fail("A visualização no navegador está disponível somente para PDF.");
    const fallbackName = filename.replace(/[^\x20-\x7E]/g, "_");
    const encodedName = encodeURIComponent(filename).replace(
      /['()*]/g,
      (character) =>
        "%" + character.charCodeAt(0).toString(16).toUpperCase(),
    );
    return new Response(await storedFileStream(f.storage_key), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(f.size_bytes),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
