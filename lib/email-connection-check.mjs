import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

const networkCodes = new Set([
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "GreetingTimeout",
]);

export function connectionErrorMessage(error) {
  const code = String(error?.code || "");
  if (
    error?.authenticationFailed ||
    ["EAUTH", "ELOGIN", "AUTHENTICATIONFAILED"].includes(code)
  )
    return "O servidor recusou o login. Confira usuário, senha e autorização do provedor.";
  if (code.startsWith("CERT_") || code.startsWith("ERR_TLS"))
    return "A conexão segura foi recusada. Confira a porta e o TLS do provedor.";
  if (networkCodes.has(code))
    return "Não foi possível alcançar o servidor. Confira endereço, porta e disponibilidade.";
  return "A conexão não foi confirmada. Confira as configurações com o provedor.";
}

export async function checkEmailConnection(
  channel,
  {
    env = process.env,
    createTransport = (config) => nodemailer.createTransport(config),
    createImapClient = (config) => new ImapFlow(config),
  } = {},
) {
  if (channel === "smtp") {
    if (!env.SMTP_HOST || !env.SMTP_FROM)
      return { ok: false, message: "Configure o servidor e o remetente SMTP." };
    const port = Number(env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return { ok: false, message: "A porta SMTP configurada é inválida." };
    const transport = createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
    try {
      await transport.verify();
      return { ok: true, message: "Servidor SMTP acessível e autenticação confirmada." };
    } catch (error) {
      return { ok: false, message: connectionErrorMessage(error) };
    } finally {
      transport.close();
    }
  }

  if (channel === "imap") {
    if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASSWORD)
      return { ok: false, message: "Configure servidor, usuário e senha IMAP." };
    const port = Number(env.IMAP_PORT || 993);
    if (![993, 143].includes(port))
      return { ok: false, message: "Use IMAP seguro na porta 993 (TLS) ou 143 (STARTTLS)." };
    const client = createImapClient({
      host: env.IMAP_HOST,
      port,
      secure: port === 993,
      doSTARTTLS: port === 143,
      auth: { user: env.IMAP_USER, pass: env.IMAP_PASSWORD },
      logger: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      verifyOnly: true,
    });
    try {
      await client.connect();
      return { ok: true, message: "Servidor IMAP acessível e autenticação confirmada." };
    } catch (error) {
      client.close();
      return { ok: false, message: connectionErrorMessage(error) };
    }
  }

  throw Object.assign(new Error("Canal de e-mail inválido."), { status: 400 });
}
