import { cookies } from "next/headers";
import { checkOrigin, requireUser } from "../../../../lib/auth.mjs";
import { changePassword } from "../../../../lib/password.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
import { fail } from "../../../../lib/domain.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    const body = await jsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      fail("Dados inválidos.");
    const token = (await cookies()).get("wg_session")?.value;
    return Response.json(
      await changePassword(
        user.id,
        token,
        body.current_password,
        body.new_password,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
