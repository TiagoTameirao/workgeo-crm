import { test } from "node:test";
import assert from "node:assert/strict";
import { integrationStatus } from "../lib/integration-status.mjs";

test("status de canais exige as variáveis mínimas de cada direção", () => {
  const sendOnly = integrationStatus({
    WHATSAPP_TOKEN: "token",
    WHATSAPP_PHONE_ID: "phone-id",
    WHATSAPP_API_VERSION: "v1",
    SMTP_HOST: "smtp.example.invalid",
    SMTP_FROM: "crm@example.invalid",
    IMAP_HOST: "imap.example.invalid",
    IMAP_USER: "crm@example.invalid",
    BLOB_STORE_ID: "store",
  });

  assert.equal(sendOnly.whatsapp, true);
  assert.equal(sendOnly.whatsappInbound, false);
  assert.equal(sendOnly.email, true);
  assert.equal(sendOnly.inboundEmail, false);
  assert.equal(sendOnly.storage, true);

  const full = integrationStatus({
    WHATSAPP_TOKEN: "token",
    WHATSAPP_PHONE_ID: "phone-id",
    WHATSAPP_API_VERSION: "v1",
    WHATSAPP_VERIFY_TOKEN: "verify",
    WHATSAPP_APP_SECRET: "secret",
    SMTP_HOST: "smtp.example.invalid",
    SMTP_FROM: "crm@example.invalid",
    IMAP_HOST: "imap.example.invalid",
    IMAP_USER: "crm@example.invalid",
    IMAP_PASSWORD: "password",
  });

  assert.deepEqual(full, {
    whatsapp: true,
    whatsappInbound: true,
    email: true,
    inboundEmail: true,
    storage: false,
  });
});
