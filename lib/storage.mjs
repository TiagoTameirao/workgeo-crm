import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { fail } from "./domain.mjs";
import { put, get as getBlob } from "@vercel/blob";
function client() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
}
export async function putFile(key, bytes, contentType) {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    await put("files/" + key, bytes, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: key.startsWith("whatsapp-attachment-"),
    });
    return;
  }
  if (process.env.S3_BUCKET) {
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    return;
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production")
    fail("Configure o armazenamento privado antes de anexar arquivos.", 503);
  const root = path.join(process.cwd(), "runtime", "files");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, key), bytes);
}
export async function readStoredFile(key) {
  if (!/^[\w-]+$/.test(key)) fail("Identificador de arquivo inválido.");
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    const r = await getBlob("files/" + key, { access: "private" });
    if (!r || r.statusCode !== 200) fail("Arquivo não encontrado.", 404);
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
  if (process.env.S3_BUCKET) {
    const result = await client().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    return Buffer.from(await result.Body.transformToByteArray());
  }
  if (process.env.VERCEL) fail("Armazenamento privado não configurado.", 503);
  return readFile(path.join(process.cwd(), "runtime", "files", key));
}
export async function storedFileStream(key) {
  if (!/^[\w-]+$/.test(key)) fail("Identificador de arquivo inválido.");
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    const r = await getBlob("files/" + key, { access: "private" });
    if (!r || r.statusCode !== 200) fail("Arquivo não encontrado.", 404);
    return r.stream;
  }
  return new Blob([await readStoredFile(key)]).stream();
}
