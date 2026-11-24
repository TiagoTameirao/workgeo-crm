export async function readJsonResponse(response) {
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); }
  catch {
    throw new Error(response.status === 504 || response.status === 502
      ? "O serviço demorou a responder. Tente novamente em instantes."
      : "O serviço retornou uma resposta inválida. Tente novamente em instantes.");
  }
  if (!response.ok) throw new Error(body?.error || "Não foi possível concluir a solicitação.");
  return body;
}

export async function requestJson(url, options) {
  return readJsonResponse(await fetch(url, options));
}
