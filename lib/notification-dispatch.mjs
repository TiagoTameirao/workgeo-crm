import { start } from "workflow/api";
import { agendaNotification } from "../workflows/agenda.js";
import { query } from "./db.mjs";
import { randomUUID } from "node:crypto";

export async function dispatchNotifications() {
  const rows = await query("SELECT id,due_at FROM notifications WHERE email_status='Pendente' AND run_id IS NULL ORDER BY due_at LIMIT 100");
  for (const row of rows) {
    const claim = "dispatch-" + Date.now() + "-" + randomUUID();
    const claimed = await query("UPDATE notifications SET run_id=$1 WHERE id=$2 AND run_id IS NULL AND email_status='Pendente' RETURNING id", [claim, row.id]);
    if (!claimed.length) continue;
    try {
      const run = await start(agendaNotification, [row.id, row.due_at]);
      await query("UPDATE notifications SET run_id=$1,last_error=NULL WHERE id=$2 AND run_id=$3", [run.runId, row.id, claim]);
    } catch {
      await query("UPDATE notifications SET run_id=NULL,last_error=$1 WHERE id=$2 AND run_id=$3", ["Agendamento pendente. Reprocesse na central de notificações.", row.id, claim]);
    }
  }
}
