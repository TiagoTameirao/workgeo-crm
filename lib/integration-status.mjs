export function integrationStatus(env = process.env) {
  return {
    whatsapp: Boolean(
      env.WHATSAPP_TOKEN &&
        env.WHATSAPP_PHONE_ID &&
        env.WHATSAPP_API_VERSION,
    ),
    whatsappInbound: Boolean(
      env.WHATSAPP_PHONE_ID &&
        env.WHATSAPP_VERIFY_TOKEN &&
        env.WHATSAPP_APP_SECRET,
    ),
    email: Boolean(env.SMTP_HOST && env.SMTP_FROM),
    inboundEmail: Boolean(
      env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASSWORD,
    ),
    storage: Boolean(
      env.S3_BUCKET || env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID,
    ),
  };
}
