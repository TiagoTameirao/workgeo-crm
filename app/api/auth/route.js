import {
  currentUser,
  createUser,
  login,
  logout,
  establishSession,
  checkOrigin,
} from "../../../lib/auth.mjs";
import { migrate, query, transaction, isPostgres, isTurso } from "../../../lib/db.mjs";
import { seedDatabase } from "../../../lib/seed.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
import { timingSafeEqual } from "node:crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let ready;
async function localReady() {
  if (!isPostgres() && !isTurso() && !process.env.VERCEL) {
    ready ||= migrate()
      .then(seedDatabase)
      .catch((e) => {
        ready = null;
        throw e;
      });
    await ready;
  }
}
export async function GET() {
  try {
    await localReady();
    const hasUsers = !!(await query("SELECT id FROM users LIMIT 1"))[0];
    return Response.json({
      user: await currentUser(),
      setup: !hasUsers,
      hosted: !!process.env.VERCEL,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request) {
  try {
    await localReady();
    checkOrigin(request);
    const body = await jsonBody(request);
    if (body.action === "logout") {
      await logout();
      return Response.json({ ok: true });
    }
    if (body.action === "setup") {
      const host = new URL(request.url).hostname;
      const local =
        !process.env.VERCEL &&
        process.env.NODE_ENV !== "production" &&
        ["127.0.0.1", "localhost"].includes(host);
      if (!local) {
        const expected = process.env.CRM_BOOTSTRAP_TOKEN;
        const actual = body.token;
        if (
          !expected ||
          typeof actual !== "string" ||
          expected.length !== actual.length ||
          !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
        )
          return Response.json(
            { error: "Código de instalação inválido." },
            { status: 403 },
          );
      }
      const user = await transaction(async () => {
        if (isPostgres()) await query("SELECT pg_advisory_xact_lock(731013)");
        if ((await query("SELECT id FROM users LIMIT 1"))[0])
          throw Object.assign(new Error("O administrador já foi criado."), {
            status: 409,
          });
        return createUser({ ...body, role: "Administrador" });
      });
      return Response.json({ user: await establishSession(user) });
    }
    return Response.json({ user: await login(body.email, body.password) });
  } catch (e) {
    return errorResponse(e);
  }
}
