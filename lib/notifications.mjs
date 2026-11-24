import { randomUUID } from "node:crypto";
import { get, query, transaction, isPostgres } from "./db.mjs";
import { absenceCategories, activityReadable, isManagement, zonedInstant } from "./agenda.mjs";
import nodemailer from "nodemailer";

export const smtpTransport = () => nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === "465", requireTLS: true, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined, connectionTimeout: 15000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true });
export async function notificationConfig() {
  return JSON.parse((await query("SELECT data FROM settings WHERE id=$1", ["notification-email"]))[0]?.data || '{"enabled":false}');
}
export async function queueActivityNotifications(record, old, actor) {
  const now = new Date().toISOString();
  await query("UPDATE notifications SET email_status='Invalidado' WHERE activity_id=$1 AND kind='Lembrete' AND email_status IN ('Pendente','Falha','Aguardando configuração')", [record.id]);
  const users = await query("SELECT id,name,email,role FROM users WHERE active=1");
  const recipients = new Set([record.owner_id, ...(record.participant_ids || []), ...(record.mentioned_ids || [])].filter(Boolean));
  if (absenceCategories.includes(record.category)) for (const person of users.filter(isManagement)) recipients.add(person.id);
  const previous = new Set([old?.owner_id, ...(old?.participant_ids || []), ...(old?.mentioned_ids || [])].filter(Boolean));
  const changed = old && ["start_date", "end_date", "start_time", "end_time", "all_day", "schedule_mode", "due_date"].some((key) => record[key] !== old[key]);
  const cancelled = record.status === "Cancelada" && old?.status !== "Cancelada";
  const reassigned = old && ["owner_id", "participant_ids", "mentioned_ids"].some((key) => JSON.stringify(record[key] || []) !== JSON.stringify(old[key] || []));
  if (cancelled || changed || reassigned) await query("UPDATE notifications SET email_status='Invalidado' WHERE activity_id=$1 AND email_status IN ('Pendente','Falha','Aguardando configuração')", [record.id]);
  if (cancelled || changed) for (const id of previous) recipients.add(id);
  for (const person of users.filter((person) => recipients.has(person.id))) {
    const kind = cancelled ? "Cancelamento" : !old || !previous.has(person.id) ? "Inclusão" : changed ? "Alteração de horário" : null;
    if (kind) await addNotification(person, record, kind, now);
    if (!["Concluída", "Cancelada"].includes(record.status) && record.start_date && (record.owner_id === person.id || record.participant_ids?.includes(person.id))) {
      for (const minutes of record.reminder_minutes || []) {
        const due = new Date(Date.parse(zonedInstant(record.start_date, record.all_day === "Sim" ? "09:00" : record.start_time)) - minutes * 60000).toISOString();
        if (due > now) await addNotification(person, record, "Lembrete", due);
      }
    }
  }
}
function notificationTitle(record, person, kind) {
  const title = !activityReadable(record, person) ? "Atualização de disponibilidade" : absenceCategories.includes(record.category) && record.owner_id !== person.id && !isManagement(person) ? record.category : record.name;
  return `${kind}: ${title}`;
}
async function addNotification(person, record, kind, due) {
  await query("INSERT INTO notifications(id,user_id,activity_id,activity_version,kind,due_at,title,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), person.id, record.id, record.version, kind, due, notificationTitle(record, person, kind), new Date().toISOString()]);
}
export async function notificationsFor(user) {
  const notices = await query("SELECT id,activity_id,kind,title,due_at,read_at,email_status,attempts FROM notifications WHERE user_id=$1 AND due_at<=$2 AND email_status<>'Invalidado' ORDER BY due_at DESC LIMIT 100", [user.id, new Date().toISOString()]);
  for (const notice of notices) {
    const record = await get("activities", notice.activity_id);
    notice.title = record ? notificationTitle(record, user, notice.kind) : "Atividade indisponível";
    notice.can_open = Boolean(record && activityReadable(record, user));
  }
  return notices;
}
export async function deliverNotification(id, transport = smtpTransport) {
  const prepared = await transaction(async () => {
    const notice = (await query("SELECT * FROM notifications WHERE id=$1" + (isPostgres() ? " FOR UPDATE" : ""), [id]))[0];
    if (!notice || !["Pendente", "Falha", "Aguardando configuração"].includes(notice.email_status)) return { result: "encerrado" };
    if (notice.due_at > new Date().toISOString()) return { result: "futuro" };
    const record = await get("activities", notice.activity_id);
    const person = (await query("SELECT id,name,email,role FROM users WHERE id=$1 AND active=1", [notice.user_id]))[0];
    if (!record || !person || notice.kind === "Lembrete" && (record.version !== notice.activity_version || ["Cancelada", "Concluída"].includes(record.status) || !record.start_date || zonedInstant(record.start_date, record.all_day === "Sim" ? "09:00" : record.start_time) <= new Date().toISOString())) {
      await query("UPDATE notifications SET email_status='Invalidado' WHERE id=$1", [id]); return { result: "invalidado" };
    }
    if (!(await notificationConfig()).enabled || !process.env.SMTP_HOST || !process.env.SMTP_FROM || !process.env.APP_URL) {
      await query("UPDATE notifications SET email_status='Aguardando configuração',run_id=NULL WHERE id=$1", [id]); return { result: "configuração" };
    }
    const title = notificationTitle(record, person, notice.kind);
    const url = new URL("/?activity=" + encodeURIComponent(record.id), process.env.APP_URL);
    const text = `${title}\n${activityReadable(record, person) ? `Data: ${record.start_date || record.due_date || "Sem data"}${record.start_time ? " às " + record.start_time : ""} (São Paulo)\n` : ""}Abrir agenda: ${url}\nWorkGeo CRM`;
    await query("UPDATE notifications SET attempts=attempts+1,email_status='Enviando' WHERE id=$1", [id]);
    return { notice, person, title, text };
  });
  if (prepared.result) return prepared.result;
  const { notice, person, title, text } = prepared;
  try {
    await transport().sendMail({ from: process.env.SMTP_FROM, to: person.email, subject: title, text, messageId: `<${id}@workgeo-crm.notifications>`, disableFileAccess: true, disableUrlAccess: true });
    await query("UPDATE notifications SET email_status='Aceito pelo servidor',last_error=NULL WHERE id=$1", [id]);
    return "enviado";
  } catch (error) {
    const rejected = Number(error.responseCode) >= 400 || ["EAUTH", "EDNS", "ECONNECTION"].includes(error.code);
    await query("UPDATE notifications SET email_status=$1,last_error=$2 WHERE id=$3", [rejected ? "Falha" : "Revisar envio", "Não foi possível confirmar o envio. Confira o provedor antes de reenviar.", id]);
    return rejected && notice.attempts < 2 ? "tentar novamente" : "revisão";
  }
}
