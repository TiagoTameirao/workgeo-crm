import { requireUser } from "../../../../lib/auth.mjs";
import { query } from "../../../../lib/db.mjs";
import { getFlight } from "../../../../lib/flights.mjs";
import { fail } from "../../../../lib/domain.mjs";
import { storedFileStream } from "../../../../lib/storage.mjs";
import { errorResponse } from "../../../../lib/http.mjs";
export const runtime = "nodejs";
export async function GET(request, { params }) {
  try {
    const user = await requireUser(), { id } = await params;
    const file = (await query("SELECT * FROM flight_files WHERE id=$1", [id]))[0];
    if (!file || !(await getFlight(user, file.flight_id))) fail("Arquivo não encontrado.", 404);
    const filename = file.filename.replace(/[\r\n"]/g, "_"), encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => "%" + character.charCodeAt(0).toString(16));
    const preview = new URL(request.url).searchParams.get("view") === "1" && file.content_type === "application/pdf";
    return new Response(await storedFileStream(file.storage_key), { headers: { "Content-Type": file.content_type, "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encoded}`, "Content-Length": String(file.size_bytes), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
