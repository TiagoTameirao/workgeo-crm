import { verifyMetaSignature, metaEvent } from "../../../../lib/messaging.mjs";
import { errorResponse } from "../../../../lib/http.mjs";
export const maxDuration = 60;
export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (
    process.env.WHATSAPP_VERIFY_TOKEN &&
    q.get("hub.mode") === "subscribe" &&
    q.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN
  )
    return new Response(q.get("hub.challenge"));
  return new Response("Forbidden", { status: 403 });
}
export async function POST(request) {
  try {
    const raw = await request.text();
    if (raw.length > 1000000) return new Response("Too large", { status: 413 });
    if (
      !verifyMetaSignature(
        raw,
        request.headers.get("x-hub-signature-256"),
        process.env.WHATSAPP_APP_SECRET,
      )
    )
      return new Response("Forbidden", { status: 403 });
    await metaEvent(JSON.parse(raw));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
