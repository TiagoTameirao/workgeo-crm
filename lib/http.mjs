const MAX_JSON_BODY_LENGTH = 1_000_000;

export function errorResponse(error) {
  const status = error.status || 500;
  if (status >= 500)
    console.error("CRM request failed", error.code || error.name);
  return Response.json(
    {
      error:
        status >= 500
          ? "Não foi possível concluir. Verifique a configuração do serviço e tente novamente."
          : error.message,
    },
    { status },
  );
}
export async function jsonBody(request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_JSON_BODY_LENGTH)
    throw Object.assign(new Error("Solicitação muito grande."), {
      status: 413,
    });
  const raw = await request.text();
  if (raw.length > MAX_JSON_BODY_LENGTH)
    throw Object.assign(new Error("Solicitação muito grande."), {
      status: 413,
    });
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Dados inválidos."), { status: 400 });
  }
}
