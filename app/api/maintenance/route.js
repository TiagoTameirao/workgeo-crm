import { timingSafeEqual } from "node:crypto";
import { backup } from "../../../lib/backup.mjs";
import { errorResponse } from "../../../lib/http.mjs";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request) {
  try {
    const expected = "Bearer " + process.env.CRON_SECRET,
      actual = request.headers.get("authorization") || "";
    if (
      !process.env.CRON_SECRET ||
      expected.length !== actual.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      return new Response("Forbidden", { status: 403 });
    return Response.json(await backup());
  } catch (e) {
    return errorResponse(e);
  }
}
