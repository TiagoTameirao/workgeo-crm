import { isManagement } from "../../../lib/agenda.mjs";
import { requireUser } from "../../../lib/auth.mjs";
import { stateFor, fail } from "../../../lib/domain.mjs";
import { query } from "../../../lib/db.mjs";
import { errorResponse } from "../../../lib/http.mjs";
export async function GET() {
  try {
    const user = await requireUser();
    if (!isManagement(user))
      fail("Exportação completa reservada ao administrador.", 403);
    const state = await stateFor(user);
    const result = {
      schemaVersion: 1,
      exported_at: new Date().toISOString(),
      ...state,
      audit: await query("SELECT * FROM audit ORDER BY created_at"),
      flight_authorizations: await query("SELECT * FROM flight_authorizations"),
      flight_files: await query("SELECT * FROM flight_files"),
      record_files: await query("SELECT * FROM record_files"),
      bulletin_versions: await query("SELECT * FROM bulletin_versions"),
      document_analyses: await query("SELECT * FROM document_analyses"),
      user_profiles: await query("SELECT * FROM user_profiles"),
      notifications: await query("SELECT * FROM notifications"),
      users: await query("SELECT id,name,email,role,active FROM users"),
      prospecting_candidates: await query("SELECT * FROM prospecting_candidates ORDER BY municipality,cnpj"),
    };
    return Response.json(result, {
      headers: {
        "Content-Disposition": 'attachment; filename="workgeo-crm-export.json"',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
