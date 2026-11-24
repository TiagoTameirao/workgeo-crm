const metaErrors = new Map([
  [10, "O token não tem permissão para consultar este número no WhatsApp Business."],
  [100, "A Meta não reconheceu o identificador do número. Confira o WHATSAPP_PHONE_ID."],
  [190, "A Meta recusou o token. Confira se está válido e ainda não expirou."],
]);

export async function checkWhatsappConnection(
  { env = process.env, fetchImpl = fetch } = {},
) {
  if (
    !env.WHATSAPP_TOKEN ||
    !env.WHATSAPP_PHONE_ID ||
    !env.WHATSAPP_API_VERSION
  )
    return { ok: false, message: "Configure token, ID do número e versão da API." };
  if (!/^\d{5,30}$/.test(env.WHATSAPP_PHONE_ID))
    return { ok: false, message: "O identificador do número WhatsApp é inválido." };
  if (!/^v\d+\.\d+$/.test(env.WHATSAPP_API_VERSION))
    return { ok: false, message: "A versão da API WhatsApp configurada é inválida." };

  const url = new URL(
    `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_ID}`,
  );
  url.searchParams.set("fields", "id,display_phone_number,verified_name");
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "A Meta não respondeu dentro de 10 segundos. Tente novamente mais tarde."
          : "Não foi possível alcançar a API da Meta. Confira a conexão e tente novamente.",
    };
  }

  let result;
  try {
    result = await response.json();
  } catch {
    return { ok: false, message: "A Meta retornou uma resposta que não pôde ser validada." };
  }
  if (!response.ok) {
    const code = Number(result?.error?.code);
    return {
      ok: false,
      message:
        metaErrors.get(code) ||
        "A Meta não confirmou o acesso. Confira as permissões e configurações do número.",
    };
  }
  if (String(result?.id || "") !== env.WHATSAPP_PHONE_ID)
    return { ok: false, message: "A resposta da Meta não corresponde ao número configurado." };

  return {
    ok: true,
    message: "A Meta confirmou o acesso aos dados do número configurado.",
  };
}
