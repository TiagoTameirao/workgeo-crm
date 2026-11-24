import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWhatsappConnection } from "../lib/whatsapp-connection-check.mjs";

const env = {
  WHATSAPP_TOKEN: "token-secret",
  WHATSAPP_PHONE_ID: "123456789012345",
  WHATSAPP_API_VERSION: "v25.0",
};

test("consulta o número na API da Meta sem enviar mensagem ou expor o token na URL", async () => {
  let url, options;
  const result = await checkWhatsappConnection({
    env,
    fetchImpl: async (input, init) => {
      url = String(input);
      options = init;
      return Response.json({ id: env.WHATSAPP_PHONE_ID, display_phone_number: "+55 31 99999-0000" });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(options.method, "GET");
  assert.equal(options.headers.Authorization, "Bearer token-secret");
  assert.match(url, /graph\.facebook\.com\/v25\.0\/123456789012345/);
  assert.match(url, /fields=id%2Cdisplay_phone_number%2Cverified_name/);
  assert.doesNotMatch(url, /token-secret/);
  assert.doesNotMatch(JSON.stringify(result), /token-secret|99999/);
});

test("token ausente, identificador inválido ou versão inválida não inicia chamada", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  const missing = await checkWhatsappConnection({ env: {}, fetchImpl });
  const badId = await checkWhatsappConnection({ env: { ...env, WHATSAPP_PHONE_ID: "id-invalido" }, fetchImpl });
  const badVersion = await checkWhatsappConnection({ env: { ...env, WHATSAPP_API_VERSION: "latest" }, fetchImpl });

  assert.equal(missing.ok, false);
  assert.equal(badId.ok, false);
  assert.equal(badVersion.ok, false);
  assert.equal(called, false);
});

test("respostas de token inválido ou sem permissão são explicadas sem ecoar dados do provedor", async () => {
  const invalid = await checkWhatsappConnection({
    env,
    fetchImpl: async () => Response.json({ error: { code: 190, message: "token-secret" } }, { status: 400 }),
  });
  const denied = await checkWhatsappConnection({
    env,
    fetchImpl: async () => Response.json({ error: { code: 10, message: "private provider detail" } }, { status: 403 }),
  });

  assert.match(invalid.message, /recusou o token/);
  assert.match(denied.message, /permissão/);
  assert.doesNotMatch(JSON.stringify([invalid, denied]), /token-secret|private provider detail/);
});

test("timeout, erro de rede e número divergente não são reportados como conexão válida", async () => {
  const timeout = await checkWhatsappConnection({
    env,
    fetchImpl: async () => { throw new DOMException("timeout", "TimeoutError"); },
  });
  const network = await checkWhatsappConnection({
    env,
    fetchImpl: async () => { throw new Error("private network detail"); },
  });
  const mismatch = await checkWhatsappConnection({
    env,
    fetchImpl: async () => Response.json({ id: "987654321098765" }),
  });

  assert.match(timeout.message, /10 segundos/);
  assert.match(network.message, /API da Meta/);
  assert.match(mismatch.message, /não corresponde/);
  assert.equal(timeout.ok || network.ok || mismatch.ok, false);
  assert.doesNotMatch(JSON.stringify(network), /private network detail/);
});
