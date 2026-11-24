import { requireUser } from "../../../lib/auth.mjs";
import { list } from "../../../lib/db.mjs";
import { fail } from "../../../lib/domain.mjs";
import { activityIntervals, safeActivity, validDay } from "../../../lib/agenda.mjs";
import { errorResponse } from "../../../lib/http.mjs";
export async function GET(request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams, from = params.get("from"), to = params.get("to");
    if (!validDay(from) || !validDay(to) || to <= from || Date.parse(to) - Date.parse(from) > 370 * 86400000) fail("Informe um intervalo de até um ano.");
    let rows = (await list("activities")).map((record) => safeActivity(record, user)).filter(Boolean);
    for (const key of ["owner_id", "category", "area", "status"]) if (params.get(key)) rows = rows.filter((record) => record[key] === params.get(key));
    if (params.get("scope") === "mine") rows = rows.filter((record) => record.owner_id === user.id);
    if (params.get("scope") === "participation") rows = rows.filter((record) => record.participant_ids?.includes(user.id));
    return Response.json(rows.filter((record) => activityIntervals(record, from, to).length));
  } catch (error) { return errorResponse(error); }
}
