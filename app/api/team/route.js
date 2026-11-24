import { canonicalRole } from "../../../lib/access.mjs";
import { isManagement } from "../../../lib/agenda.mjs";
import { requireUser, createUser, checkOrigin } from "../../../lib/auth.mjs";
import { query } from "../../../lib/db.mjs";
import { audit, fail } from "../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
import { updateUserAccess } from "../../../lib/team.mjs";
export async function GET() {
  try {
    const u = await requireUser();
    if (!isManagement(u))
      fail("Acesso reservado ao administrador.", 403);
    return Response.json(
      (await query("SELECT id,name,email,role,active FROM users ORDER BY name")).map((person) => ({ ...person, role: canonicalRole(person.role) })),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    if (!isManagement(u))
      fail("Acesso reservado ao administrador.", 403);
    const b = await jsonBody(request);
    const user = await createUser(b);
    await audit(u, "users", user.id, "criação de acesso", null, user);
    return Response.json(user);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    const updated = await updateUserAccess(u, await jsonBody(request));
    return Response.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}
