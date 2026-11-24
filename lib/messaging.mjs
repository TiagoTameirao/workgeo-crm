import { randomUUID, createHash, createHmac, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { query, get, insert, update, transaction, list } from "./db.mjs";
import { fail, audit, materialAllowed, messagingRoles } from "./domain.mjs";
import { putFile, readStoredFile } from "./storage.mjs";
export function verifyMetaSignature(raw, signature, secret) {
  if (!secret || !signature) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return (
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}
export async function recordMessage(user, b) {
  if (!messagingRoles.includes(user.role))
    fail("Sem permissão de atendimento.", 403);
  const conversation = await get("conversations", b.conversation_id);
  if (!conversation) fail("Conversa não encontrada.");
  let whatsappTemplate = null;
  let text = typeof b.body === "string" ? b.body.trim() : "";
  if (b.template_id && conversation.channel === "WhatsApp") {
    whatsappTemplate = await get("templates", b.template_id);
    if (
      !whatsappTemplate ||
      whatsappTemplate.channel !== "WhatsApp aprovado" ||
      whatsappTemplate.approval_status !== "Aprovado"
    )
      fail("Selecione um modelo registrado como aprovado no WhatsApp.");
    const values = Array.isArray(b.template_values) ? b.template_values : [];
    if (
      values.length !== Number(whatsappTemplate.variable_count) ||
      values.some((value) => typeof value !== "string" || !value.trim() || value.length > 1000)
    )
      fail("Preencha todas as variáveis do modelo aprovado.");
    const expected = Array.from(text.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1]));
    if (
      expected.length !== values.length ||
      expected.some((number, index) => number !== index + 1)
    )
      fail("O texto do modelo deve conter as variáveis sequenciais {{1}}, {{2}} etc.");
    text = text.replace(/\{\{(\d+)\}\}/g, (_, number) => values[Number(number) - 1].trim());
  }
  if ((!text && !whatsappTemplate) || text.length > 10000)
    fail("Informe uma mensagem de até 10.000 caracteres.");
  if (!["manual", "internal", "send"].includes(b.mode))
    fail("Modo de mensagem inválido.");
  const contact = await get("contacts", conversation.contact_id);
  let material = null,
    attachments = [];
  if (b.material_id) {
    material = await get("materials", b.material_id);
    if (
      !material ||
      !materialAllowed(user, material) ||
      material.status !== "Aprovado" ||
      (material.unit_id && material.unit_id !== conversation.unit_id)
    )
      fail("Selecione um material aprovado e autorizado para este cliente.");
    if (material.file_id) {
      const file = (
        await query("SELECT * FROM files WHERE id=$1 UNION ALL SELECT id,record_id AS material_id,filename,content_type,storage_key,size_bytes,created_at FROM record_files WHERE id=$1 AND entity='materials'", [material.file_id])
      )[0];
      attachments = [
        {
          filename: file.filename,
          content: await readStoredFile(file.storage_key),
          contentType:
            file.content_type && file.content_type !== "application/octet-stream"
              ? file.content_type
              : file.filename.toLowerCase().endsWith(".pdf")
                ? "application/pdf"
                : file.content_type || "application/octet-stream",
        },
      ];
    }
  }
  if (material?.url)
    text +=
      "\n\n" +
      material.name +
      " (versão " +
      material.revision +
      "): " +
      material.url;
  if (b.mode === "send" && !b.confirmed)
    fail("Confirme destinatário e conteúdo antes do envio.");
  if (b.mode === "send" && conversation.channel === "WhatsApp") {
    if (
      !process.env.WHATSAPP_TOKEN ||
      !process.env.WHATSAPP_PHONE_ID ||
      !process.env.WHATSAPP_API_VERSION
    )
      fail("WhatsApp não configurado.", 503);
    if (!contact.phone || !/^\d{10,15}$/.test(contact.phone))
      fail("Confira o telefone e inclua o código do país antes de enviar.");
    if (contact.phone.length < 12)
      fail("Atualize o telefone com o código do país (55).");
    const lastInbound = (await list("messages"))
      .filter(
        (m) =>
          m.conversation_id === conversation.id && m.direction === "inbound",
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const withinWindow = lastInbound && Date.now() - Date.parse(lastInbound.created_at) <= 24 * 60 * 60 * 1000;
    if (!withinWindow && !whatsappTemplate)
      fail(
        "Fora da janela de atendimento. Use um modelo aprovado no WhatsApp corporativo; o envio livre pelo CRM exige mensagem recente do cliente.",
      );
    if (whatsappTemplate && material)
      fail("Envie o modelo aprovado e o material em mensagens separadas.");
    if (attachments.length && !withinWindow)
      fail("Para anexar um PDF, o cliente precisa ter enviado mensagem nas últimas 24 horas.");
    if (attachments.length && attachments[0].contentType !== "application/pdf")
      fail("O envio de material pelo WhatsApp aceita PDF. Envie outros formatos por e-mail ou registre o envio manual.");
  }
  if (
    b.mode === "send" &&
    conversation.channel === "E-mail" &&
    (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
  )
    fail("E-mail não configurado.", 503);
  const message = await insert(
    "messages",
    {
      conversation_id: conversation.id,
      body: text,
      direction: b.mode === "internal" ? "internal" : "outbound",
      status:
        b.mode === "send"
          ? "Processando envio"
          : b.mode === "internal"
            ? "Nota interna"
            : "Registro manual — envio não verificado",
      author: user.name,
      material_id: material?.id || null,
      material_snapshot: material
        ? {
            id: material.id,
            name: material.name,
            revision: material.revision,
            url: material.url,
            file_id: material.file_id,
          }
        : null,
      template_snapshot: whatsappTemplate
        ? {
            id: whatsappTemplate.id,
            name: whatsappTemplate.name,
            provider_name: whatsappTemplate.provider_name,
            language_code: whatsappTemplate.language_code,
          }
        : null,
    },
    randomUUID(),
  );
  await audit(user, "messages", message.id, "registro de mensagem", null, {
    direction: message.direction,
    conversation_id: conversation.id,
    status: message.status,
  });
  if (b.mode !== "send") return message;
  let providerId, status;
  try {
    if (conversation.channel === "WhatsApp") {
      const version = process.env.WHATSAPP_API_VERSION;
      if (!/^v\d+\.\d+$/.test(version))
        fail("Versão da API de WhatsApp inválida.");
      let messagePayload;
      if (whatsappTemplate) {
        messagePayload = {
          messaging_product: "whatsapp",
          to: contact.phone,
          type: "template",
          template: {
            name: whatsappTemplate.provider_name,
            language: { code: whatsappTemplate.language_code },
            ...(Number(whatsappTemplate.variable_count)
              ? { components: [{ type: "body", parameters: b.template_values.map((value) => ({ type: "text", text: value.trim() })) }] }
              : {}),
          },
        };
      } else if (attachments.length) {
        const file = attachments[0];
        const form = new FormData();
        form.set("messaging_product", "whatsapp");
        form.set("type", file.contentType);
        form.set("file", new Blob([file.content], { type: file.contentType }), file.filename);
        const upload = await fetch(
          `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_ID}/media`,
          { method: "POST", headers: { Authorization: "Bearer " + process.env.WHATSAPP_TOKEN }, body: form, signal: AbortSignal.timeout(30000) },
        );
        const media = await upload.json();
        if (!upload.ok || !media.id) throw new Error("Falha ao publicar o PDF no WhatsApp.");
        messagePayload = {
          messaging_product: "whatsapp",
          to: contact.phone,
          type: "document",
          document: { id: media.id, filename: file.filename, ...(text ? { caption: text } : {}) },
        };
      } else {
        messagePayload = {
          messaging_product: "whatsapp",
          to: contact.phone,
          type: "text",
          text: { body: text },
        };
      }
      const res = await fetch(
        `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.WHATSAPP_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messagePayload),
          signal: AbortSignal.timeout(20000),
        },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error("Provedor rejeitou o envio.");
      providerId = payload.messages?.[0]?.id;
      status = "Enviada";
    } else {
      if (!/^\S+@\S+\.\S+$/.test(contact.email || ""))
        fail("Confira o e-mail do destinatário.");
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_PORT === "465",
        requireTLS: true,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
        connectionTimeout: 15000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const result = await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: contact.email,
        subject: conversation.name,
        text,
        attachments,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      providerId = result.messageId;
      status = "Aceita pelo servidor de e-mail";
    }
  } catch {
    status = "Falha no envio — o provedor não confirmou. Verifique o canal antes de tentar novamente.";
  }
  return transaction(async () => {
    const current = await get("messages", message.id);
    const result = await update(
      "messages",
      message.id,
      { ...current, provider_id: providerId || null, status },
      current.version,
    );
    await audit(user, "messages", message.id, "resultado de envio", null, {
      status,
      provider_id: providerId || null,
    });
    return result;
  });
}
export async function inbound({
  channel,
  providerId,
  sender,
  body,
  timestamp,
  attachments = [],
}) {
  return transaction(async () => {
    if (
      (
        await query("SELECT id FROM messages WHERE provider_id=$1", [
          providerId,
        ])
      )[0]
    )
      return false;
    const contacts = (await list("contacts")).filter((c) =>
      channel === "E-mail"
        ? c.email?.toLowerCase() === sender.toLowerCase()
        : c.phone?.replace(/\D/g, "") === sender.replace(/\D/g, ""),
    );
    if (contacts.length !== 1) {
      const eventData = {
        channel,
        sender,
        body,
        timestamp,
        attachments,
        reason: contacts.length ? "Contato ambíguo" : "Contato não identificado",
      };
      const previousEvent = (await query("SELECT data FROM inbox_events WHERE id=$1", [providerId]))[0];
      const previouslyStoredAttachments = previousEvent ? JSON.parse(previousEvent.data).attachments || [] : [];
      if (previouslyStoredAttachments.some((attachment) => attachment.storage_key) && !attachments.some((attachment) => attachment.storage_key))
        eventData.attachments = previouslyStoredAttachments;
      await query(
        "INSERT INTO inbox_events(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
        [
          providerId,
          JSON.stringify(eventData),
        ],
      );
      return false;
    }
    const c = contacts[0];
    let conv = (await list("conversations")).find(
      (v) =>
        v.contact_id === c.id &&
        v.channel === channel &&
        v.status !== "Concluída",
    );
    if (!conv)
      conv = await insert(
        "conversations",
        {
          name: "Atendimento — " + c.name,
          unit_id: c.unit_id,
          contact_id: c.id,
          channel,
          status: "Aguardando equipe",
        },
        randomUUID(),
      );
    await insert(
      "messages",
      {
        conversation_id: conv.id,
        provider_id: providerId,
        body,
        direction: "inbound",
        status: "Recebida",
        attachments,
        provider_timestamp: timestamp,
      },
      randomUUID(),
    );
    await query("DELETE FROM inbox_events WHERE id=$1", [providerId]);
    await update(
      "conversations",
      conv.id,
      { ...conv, status: "Aguardando equipe" },
      conv.version,
    );
    return true;
  });
}
const whatsappMediaTypes = new Set(["audio", "document", "image", "sticker", "video"]);
const maxWhatsappMediaBytes = 20 * 1024 * 1024;
const mediaDownloadFailure = "Não foi possível arquivar esta mídia. Verifique a integração ou solicite o reenvio.";

async function readLimitedResponse(response, maxBytes) {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error("media_too_large");
  if (!response.body) throw new Error("media_empty");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("media_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function downloadWhatsappMedia(media, providerMessageId, { fetchImpl = fetch, storeFile = putFile } = {}) {
  const token = process.env.WHATSAPP_TOKEN;
  const version = process.env.WHATSAPP_API_VERSION;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !version || !phoneId || !/^v\d+\.\d+$/.test(version)) throw new Error("media_not_configured");
  if (!media?.id || !/^[\w.-]{1,200}$/.test(String(media.id))) throw new Error("media_id_invalid");

  const metadataUrl = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(media.id)}`);
  metadataUrl.searchParams.set("phone_number_id", phoneId);
  const metadataResponse = await fetchImpl(metadataUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!metadataResponse.ok) throw new Error("media_metadata_failed");
  const metadata = await metadataResponse.json();
  let downloadUrl;
  try { downloadUrl = new URL(metadata.url); } catch { throw new Error("media_url_invalid"); }
  if (downloadUrl.protocol !== "https:" || downloadUrl.hostname !== "lookaside.fbsbx.com") throw new Error("media_url_invalid");
  if (Number(metadata.file_size) > maxWhatsappMediaBytes) throw new Error("media_too_large");

  const downloadResponse = await fetchImpl(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!downloadResponse.ok) throw new Error("media_download_failed");
  const bytes = await readLimitedResponse(downloadResponse, maxWhatsappMediaBytes);
  if (metadata.sha256 && /^[a-f\d]{64}$/i.test(metadata.sha256)) {
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest.toLowerCase() !== metadata.sha256.toLowerCase()) throw new Error("media_checksum_mismatch");
  }
  const rawType = String(metadata.mime_type || downloadResponse.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(rawType) ? rawType : "application/octet-stream";
  const rawFilename = String(media.filename || `${media.type || "arquivo"}-${providerMessageId}`);
  const filename = rawFilename.replace(/[\\/\r\n\0]/g, "_").slice(0, 200) || "arquivo";
  const storageKey = "whatsapp-attachment-" + createHash("sha256").update(`${providerMessageId}\0${media.id}`).digest("hex");
  await storeFile(storageKey, bytes, contentType);
  return { type: media.type || "document", filename, size: bytes.length, contentType, storage_key: storageKey, provider_media_id: String(media.id), download_status: "Arquivada" };
}

async function updateInboundMedia(providerId, attachment) {
  await transaction(async () => {
    const messageRow = (await query("SELECT id FROM messages WHERE provider_id=$1", [providerId]))[0];
    if (messageRow) {
      const message = await get("messages", messageRow.id);
      if (message?.attachments?.some((item) => item.storage_key) && !attachment.storage_key) return;
      if (message) await update("messages", message.id, { ...message, attachments: [attachment] }, message.version);
      return;
    }
    const eventRow = (await query("SELECT data FROM inbox_events WHERE id=$1", [providerId]))[0];
    if (eventRow) {
      const event = JSON.parse(eventRow.data);
      if (event.attachments?.some((item) => item.storage_key) && !attachment.storage_key) return;
      event.attachments = [attachment];
      await query("UPDATE inbox_events SET data=$1 WHERE id=$2", [JSON.stringify(event), providerId]);
    }
  });
}

export async function retryWhatsappAttachment(user, id, index, { fetchImpl = fetch, storeFile = putFile } = {}) {
  if (!messagingRoles.includes(user?.role)) fail("Sem permissão de atendimento.", 403);
  if (!Number.isInteger(index) || index < 0) fail("Anexo não encontrado.", 404);
  const message = await get("messages", id);
  const eventRow = message ? null : (await query("SELECT data FROM inbox_events WHERE id=$1", [id]))[0];
  const event = eventRow ? JSON.parse(eventRow.data) : null;
  const record = message || event;
  const providerId = message?.provider_id || id;
  const attachment = record?.attachments?.[index];
  const conversation = message ? await get("conversations", message.conversation_id) : null;
  if ((conversation?.channel || event?.channel) !== "WhatsApp" || !attachment?.provider_media_id || !attachment?.type)
    fail("Esta mídia não pode ser recuperada pelo WhatsApp.", 404);
  if (attachment.storage_key) return { download_status: "Arquivada" };
  try {
    const downloaded = await downloadWhatsappMedia({
      id: attachment.provider_media_id,
      filename: attachment.filename,
      mime_type: attachment.contentType,
      type: attachment.type,
    }, providerId, { fetchImpl, storeFile });
    await updateInboundMedia(providerId, downloaded);
    await audit(user, "messages", message?.id || id, "mídia recebida arquivada", attachment, { ...downloaded, storage_key: undefined });
    return { download_status: "Arquivada" };
  } catch {
    const failed = { ...attachment, download_status: "Falha", download_error: mediaDownloadFailure };
    await updateInboundMedia(providerId, failed);
    await audit(user, "messages", message?.id || id, "tentativa de recuperar mídia", attachment, failed);
    return { download_status: "Falha", error: mediaDownloadFailure };
  }
}

export async function metaEvent(payload, { fetchImpl = fetch, storeFile = putFile } = {}) {
  for (const entry of payload.entry || [])
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (value.metadata?.phone_number_id !== process.env.WHATSAPP_PHONE_ID)
        continue;
      for (const m of value.messages || []) {
        if (!m.id) continue;
        const existingMessageRow = (await query("SELECT id FROM messages WHERE provider_id=$1", [m.id]))[0];
        const existingMessage = existingMessageRow ? await get("messages", existingMessageRow.id) : null;
        const previousInbox = (await query("SELECT data FROM inbox_events WHERE id=$1", [m.id]))[0];
        const previousAttachments = previousInbox ? JSON.parse(previousInbox.data).attachments || [] : [];
        const mediaType = whatsappMediaTypes.has(m.type);
        const media = mediaType ? m[m.type] || {} : {};
        const cachedAttachments = existingMessage?.attachments?.length ? existingMessage.attachments : previousAttachments;
        const cached = cachedAttachments.find((attachment) => attachment.storage_key);
        const placeholder = {
          type: m.type,
          filename: String(media.filename || `${m.type}-${m.id}`).replace(/[\\/\r\n\0]/g, "_").slice(0, 200),
          contentType: media.mime_type || "application/octet-stream",
          provider_media_id: media.id ? String(media.id) : null,
          download_status: "Pendente",
        };
        const body = m.text?.body || (mediaType ? media.caption || `[Mídia recebida: ${m.type}]` : `[Mensagem do tipo ${m.type || "desconhecido"}]`);
        if (!existingMessage) {
          await inbound({
            channel: "WhatsApp",
            providerId: m.id,
            sender: m.from,
            timestamp: m.timestamp,
            body,
            attachments: mediaType ? cached ? cachedAttachments : [placeholder] : [],
          });
        }
        if (!mediaType || cached) continue;
        try {
          const attachment = await downloadWhatsappMedia({ ...media, type: m.type }, m.id, { fetchImpl, storeFile });
          await updateInboundMedia(m.id, attachment);
        } catch {
          await updateInboundMedia(m.id, { ...placeholder, download_status: "Falha", download_error: mediaDownloadFailure });
        }
      }
      for (const s of value.statuses || []) {
        await transaction(async () => {
          const row = (
            await query("SELECT * FROM messages WHERE provider_id=$1", [s.id])
          )[0];
          if (!row) return;
          const m = await get("messages", row.id),
            labels = {
              sent: "Enviada",
              delivered: "Entregue",
              read: "Lida",
              failed: "Falha de entrega",
            },
            rank = { Enviada: 1, Entregue: 2, Lida: 3 };
          if (
            s.status !== "failed" &&
            (rank[labels[s.status]] || 0) < (rank[m.status] || 0)
          )
            return;
          await update(
            "messages",
            m.id,
            { ...m, status: labels[s.status] || m.status },
            m.version,
          );
        });
      }
    }
}
