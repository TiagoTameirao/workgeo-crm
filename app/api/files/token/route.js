import { handleUpload } from "@vercel/blob/client";
import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { query, get } from "../../../../lib/db.mjs";
import { canWrite } from "../../../../lib/model.mjs";
import { fail, materialAllowed } from "../../../../lib/domain.mjs";
import { completeUpload } from "../../../../lib/uploads.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
export async function POST(request) {
  try {
    const body = await jsonBody(request);
    return Response.json(
      await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          checkOrigin(request);
          const user = await requireUser();
          const b = JSON.parse(clientPayload || "{}");
          const key = pathname.replace(/^files\//, "");
          if (!/^files\/[a-f0-9-]{36}$/.test(pathname))
            fail("Caminho não autorizado.");
          if (!canWrite(user.role, "materials"))
            fail("Sem permissão para anexar.", 403);
          const m = await get("materials", b.material_id);
          if (!m || !materialAllowed(user, m) || m.status !== "Rascunho")
            fail("Anexe em um material de rascunho.");
          if (
            !Number.isInteger(b.size) ||
            b.size <= 0 ||
            b.size > 30000000 ||
            typeof b.filename !== "string" ||
            b.filename.length > 200 ||
            !/\.(pdf|docx|xlsx|png|jpe?g|csv|kml|zip)$/i.test(b.filename)
          )
            fail("Arquivo inválido. Limite: 30 MB.");
          await query("INSERT INTO settings(id,data) VALUES($1,$2)", [
            "upload:" + key,
            JSON.stringify({
              user_id: user.id,
              material_id: m.id,
              filename: b.filename.replace(/[\r\n]/g, ""),
              size: b.size,
              expires: Date.now() + 30 * 60 * 1000,
            }),
          ]);
          return {
            allowedContentTypes: [
              "application/pdf",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "image/png",
              "image/jpeg",
              "text/csv",
              "application/vnd.google-earth.kml+xml",
              "application/zip",
              "application/octet-stream",
            ],
            maximumSizeInBytes: 30000000,
            addRandomSuffix: false,
            allowOverwrite: false,
            tokenPayload: JSON.stringify({ key, user_id: user.id }),
          };
        },
        onUploadCompleted: async ({ tokenPayload }) => {
          const { key, user_id } = JSON.parse(tokenPayload);
          const u = (
            await query(
              "SELECT id,name,role FROM users WHERE id=$1 AND active=1",
              [user_id],
            )
          )[0];
          if (u) await completeUpload(u, key);
        },
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
