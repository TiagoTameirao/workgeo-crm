import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { query } from "./db.mjs";
import { inbound } from "./messaging.mjs";
import { fail } from "./domain.mjs";
import { putFile } from "./storage.mjs";
import { randomUUID } from "node:crypto";
export async function syncEmail() {
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER)
    fail("Recebimento por e-mail não configurado.", 503);
  const port = Number(process.env.IMAP_PORT || 993);
  if (![993, 143].includes(port))
    fail("Use IMAP seguro na porta 993 (TLS) ou 143 (STARTTLS).");
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port,
    secure: port === 993,
    doSTARTTLS: port === 143,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
    connectionTimeout: 15000,
  });
  let lock,
    imported = 0;
  try {
    await client.connect();
    lock = await client.getMailboxLock("INBOX", { readOnly: true });
    const validity = String(client.mailbox.uidValidity),
      key = "imap-cursor";
    const stored = JSON.parse(
      (await query("SELECT data FROM settings WHERE id=$1", [key]))[0]?.data ||
        "null",
    );
    if (!stored || stored.validity !== validity) {
      await query(
        "INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2",
        [
          key,
          JSON.stringify({
            validity,
            last: Number(client.mailbox.uidNext) - 1,
          }),
        ],
      );
      return { imported: 0, initialized: true };
    }
    const end = Number(client.mailbox.uidNext) - 1;
    if (end <= stored.last) return { imported: 0 };
    const metadata = await client.fetchAll(
      `${stored.last + 1}:${end}`,
      { uid: true, size: true },
      { uid: true },
    );
    let last = stored.last;
    for (const m of metadata.slice(0, 30)) {
      if (m.size > 3000000) {
        await query(
          "INSERT INTO inbox_events(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
          [
            "imap:" + validity + ":" + m.uid,
            JSON.stringify({
              channel: "E-mail",
              sender: "Não processado",
              body: "Mensagem maior que 3 MB; conferir na caixa corporativa.",
              reason: "Tamanho excedido",
            }),
          ],
        );
        last = m.uid;
        continue;
      }
      const raw = await client.fetchOne(
        String(m.uid),
        { source: true },
        { uid: true },
      );
      const mail = await simpleParser(raw.source, {
        skipHtmlToText: true,
        skipTextToHtml: true,
      });
      const sender = mail.from?.value[0]?.address || "";
      const attachments = [];
      for (const a of mail.attachments) {
        const id = randomUUID();
        const filename = String(a.filename || "anexo")
          .replace(/[\\/\r\n\0]/g, "_")
          .slice(0, 200);
        const content = Buffer.from(a.content);
        await putFile("mail-attachment-" + id, content, a.contentType || "application/octet-stream");
        attachments.push({
          filename,
          size: content.length,
          contentType: a.contentType || "application/octet-stream",
          storage_key: "mail-attachment-" + id,
        });
      }
      const ok = await inbound({
        channel: "E-mail",
        providerId: "imap:" + validity + ":" + m.uid,
        sender,
        body: mail.text || mail.subject || "[E-mail sem texto simples]",
        timestamp: mail.date?.toISOString(),
        attachments,
      });
      if (ok) imported++;
      last = m.uid;
    }
    await query("UPDATE settings SET data=$1 WHERE id=$2", [
      JSON.stringify({ validity, last }),
      key,
    ]);
    return { imported };
  } finally {
    lock?.release();
    if (client.usable) await client.logout();
    else client.close();
  }
}
