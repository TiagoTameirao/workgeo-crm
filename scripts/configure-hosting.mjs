import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const cli =
  "C:/Users/jessi/AppData/Local/npm-cache/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js";
let env = await readFile(".env.local", "utf8");
const existing = Object.fromEntries(
  env
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
const secrets = {
  CRM_BOOTSTRAP_TOKEN:
    existing.CRM_BOOTSTRAP_TOKEN || randomBytes(24).toString("hex"),
  BACKUP_KEY: existing.BACKUP_KEY || randomBytes(32).toString("hex"),
  CRON_SECRET: existing.CRON_SECRET || randomBytes(24).toString("hex"),
};
const config = {
  ...secrets,
  SMTP_FROM: "tiagotameirao.rodrigues@gmail.com",
  CRM_DB_SCHEMA: "crm_development",
};
for (const [k, v] of Object.entries(config))
  if (!existing[k]) env += "\n" + k + '="' + v + '"';
await writeFile(".env.local", env + "\n");
await mkdir("runtime", { recursive: true });
await writeFile(
  "runtime/ACESSO_INICIAL.txt",
  "WorkGeo CRM — acesso inicial\n\nAo abrir o site, crie seu acesso com seu e-mail e uma senha de 12 caracteres ou mais.\nCódigo de instalação (uso único): " +
    secrets.CRM_BOOTSTRAP_TOKEN +
    "\n\nNão compartilhe este arquivo. O código deixa de funcionar após a criação do primeiro administrador.\n",
);
async function add(name, value, target) {
  return new Promise((resolve, reject) => {
    const c = spawn(
      process.execPath,
      [
        cli,
        "env",
        "add",
        name,
        target,
        "--scope",
        "tiagotameiraos-projects",
        "--yes",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    c.stdout.on("data", (b) => (output += b));
    c.stderr.on("data", (b) => (output += b));
    c.stdin.end(value);
    c.on("close", (code) => {
      if (code)
        reject(
          new Error(
            name +
              " (" +
              target +
              ") não configurado. " +
              output.replaceAll(value, "[oculto]"),
          ),
        );
      else {
        console.log(name + " configurado em " + target);
        resolve();
      }
    });
  });
}
for (const target of ["production", "preview"]) {
  for (const [name, value] of Object.entries({
    ...secrets,
    SMTP_FROM: config.SMTP_FROM,
    CRM_DB_SCHEMA: target === "production" ? "crm_production" : "crm_preview",
  }))
    await add(name, value, target);
}
