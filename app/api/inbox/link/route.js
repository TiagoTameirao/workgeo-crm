import { randomUUID } from "node:crypto";
import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { query, get, insert, transaction } from "../../../../lib/db.mjs";
import { messagingRoles, fail, audit } from "../../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
export async function POST(request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    if (!messagingRoles.includes(u.role))
      fail("Sem permissão de atendimento.", 403);
    const b = await jsonBody(request);
    return Response.json(
      await transaction(async () => {
        const row = (
          await query("SELECT * FROM inbox_events WHERE id=$1", [b.id])
        )[0];
        const contact = await get("contacts", b.contact_id);
        if (!row || !contact)
          fail("Escolha um contato válido para esta mensagem.");
        const event = JSON.parse(row.data);
        const conv = await insert(
          "conversations",
          {
            name: "Atendimento — " + contact.name,
            unit_id: contact.unit_id,
            contact_id: contact.id,
            channel: event.channel,
            status: "Aguardando equipe",
          },
          randomUUID(),
        );
        const message = await insert(
          "messages",
          {
            conversation_id: conv.id,
            provider_id: row.id,
            direction: "inbound",
            body: event.body,
            status: "Recebida",
            attachments: event.attachments || [],
            provider_timestamp: event.timestamp,
          },
          randomUUID(),
        );
        await query("DELETE FROM inbox_events WHERE id=$1", [row.id]);
        await audit(
          u,
          "messages",
          message.id,
          "vínculo manual de remetente",
          null,
          { sender: event.sender, contact_id: contact.id },
        );
        return conv;
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
