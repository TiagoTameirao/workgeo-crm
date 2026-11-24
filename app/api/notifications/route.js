import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { query, transaction } from "../../../lib/db.mjs";
import { isManagement } from "../../../lib/agenda.mjs";
import { audit, fail } from "../../../lib/domain.mjs";
import { notificationsFor, notificationConfig, smtpTransport } from "../../../lib/notifications.mjs";
import { dispatchNotifications } from "../../../lib/notification-dispatch.mjs";
import { jsonBody, errorResponse } from "../../../lib/http.mjs";
export const maxDuration = 60;
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ items: await notificationsFor(user), ...(isManagement(user) ? { config: await notificationConfig(), pending: await query("SELECT id,kind,email_status,attempts,last_error,due_at FROM notifications WHERE email_status IN ('Falha','Revisar envio','Enviando','Aguardando configuração') OR (email_status='Pendente' AND (run_id IS NULL OR run_id LIKE 'dispatch-%')) ORDER BY due_at LIMIT 100") } : {}) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    checkOrigin(request);
    const user = await requireUser(), body = await jsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("Ação inválida.");
    if (body.action === "read") {
      if (typeof body.id !== "string") fail("Selecione um aviso.");
      await query("UPDATE notifications SET read_at=$1 WHERE id=$2 AND user_id=$3", [new Date().toISOString(), body.id, user.id]);
    } else {
      if (!isManagement(user)) fail("A gestão configura os avisos.", 403);
      if (body.action === "email") {
        if (typeof body.enabled !== "boolean") fail("Configuração inválida.");
        if (body.enabled) {
          if (!process.env.SMTP_HOST || !process.env.SMTP_FROM || !process.env.APP_URL) fail("Configure remetente SMTP e endereço do CRM antes de ativar.");
          await smtpTransport().verify();
        }
        await transaction(async () => {
          const before = await notificationConfig(), after = { enabled: body.enabled, verified_at: new Date().toISOString() };
          await query("INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2", ["notification-email", JSON.stringify(after)]);
          await audit(user, "settings", "notification-email", "configuração de notificações", before, after);
        });
      } else if (body.action === "retry-one") {
        if (typeof body.id !== "string" || body.confirmed !== true) fail("Confira o envio anterior antes de solicitar o reenvio.");
        const before = (await query("SELECT id,email_status FROM notifications WHERE id=$1", [body.id]))[0];
        if (before?.email_status !== "Revisar envio") fail("Este aviso não está aguardando conferência.");
        await query("UPDATE notifications SET email_status='Pendente',run_id=NULL WHERE id=$1 AND email_status='Revisar envio'", [body.id]);
        await audit(user, "notifications", body.id, "reenvio após conferência humana", before, { email_status: "Pendente" });
      } else if (body.action === "retry") {
        const claims = await query("SELECT id,run_id FROM notifications WHERE email_status='Pendente' AND run_id LIKE 'dispatch-%'");
        for (const claim of claims) if (Date.now() - Number(claim.run_id.split("-")[1]) > 600000) await query("UPDATE notifications SET run_id=NULL WHERE id=$1 AND run_id=$2", [claim.id, claim.run_id]);
        await query("UPDATE notifications SET email_status='Pendente',run_id=NULL WHERE email_status IN ('Falha','Aguardando configuração') AND due_at>$1", [new Date(Date.now() - 24 * 3600000).toISOString()]);
      } else fail("Ação inválida.");
      await dispatchNotifications();
    }
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
