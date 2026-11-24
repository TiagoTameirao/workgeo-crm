import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkEmailConnection,
  connectionErrorMessage,
} from "../lib/email-connection-check.mjs";

test("SMTP verifica disponibilidade sem enviar mensagem e fecha transporte", async () => {
  let config, verified = false, closed = false;
  const result = await checkEmailConnection("smtp", {
    env: { SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "crm@example.invalid" },
    createTransport: (value) => {
      config = value;
      return {
        async verify() { verified = true; return true; },
        close() { closed = true; },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(verified, true);
  assert.equal(closed, true);
  assert.equal(config.port, 587);
  assert.equal(config.requireTLS, true);
});

test("IMAP confirma login sem abrir ou sincronizar mensagens", async () => {
  let config, connected = false;
  const result = await checkEmailConnection("imap", {
    env: {
      IMAP_HOST: "imap.example.invalid",
      IMAP_USER: "crm@example.invalid",
      IMAP_PASSWORD: "test-only",
    },
    createImapClient: (value) => {
      config = value;
      return { async connect() { connected = true; } };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(connected, true);
  assert.equal(config.verifyOnly, true);
  assert.equal(config.auth.pass, "test-only");
  assert.equal(config.socketTimeout, 10000);
});

test("IMAP na porta 143 exige STARTTLS", async () => {
  let config;
  const result = await checkEmailConnection("imap", {
    env: {
      IMAP_HOST: "imap.example.invalid",
      IMAP_USER: "crm@example.invalid",
      IMAP_PASSWORD: "test-only",
      IMAP_PORT: "143",
    },
    createImapClient: (value) => {
      config = value;
      return { async connect() {} };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(config.secure, false);
  assert.equal(config.doSTARTTLS, true);
});

test("configuração ausente ou porta inválida não inicia conexão", async () => {
  let attempted = false;
  const missing = await checkEmailConnection("imap", {
    env: { IMAP_HOST: "imap.example.invalid" },
    createImapClient() { attempted = true; },
  });
  const badPort = await checkEmailConnection("smtp", {
    env: { SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "crm@example.invalid", SMTP_PORT: "not-a-port" },
    createTransport() { attempted = true; },
  });
  const insecurePort = await checkEmailConnection("imap", {
    env: {
      IMAP_HOST: "imap.example.invalid",
      IMAP_USER: "crm@example.invalid",
      IMAP_PASSWORD: "test-only",
      IMAP_PORT: "1433",
    },
    createImapClient() { attempted = true; },
  });

  assert.equal(missing.ok, false);
  assert.equal(badPort.ok, false);
  assert.equal(insecurePort.ok, false);
  assert.equal(attempted, false);
});

test("falhas de provedor viram mensagens seguras sem detalhes ou credenciais", async () => {
  const denied = await checkEmailConnection("smtp", {
    env: { SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "crm@example.invalid" },
    createTransport: () => ({
      async verify() { throw Object.assign(new Error("secret leaked"), { code: "EAUTH" }); },
      close() {},
    }),
  });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /recusou o login/);
  assert.doesNotMatch(JSON.stringify(denied), /secret leaked|smtp\.example|crm@example/);
  assert.match(connectionErrorMessage({ code: "ETIMEDOUT" }), /alcançar o servidor/);
});

test("canal desconhecido é rejeitado", async () => {
  await assert.rejects(checkEmailConnection("whatsapp"), /Canal de e-mail inválido/);
});
