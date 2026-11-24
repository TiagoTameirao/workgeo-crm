import { spawn } from "node:child_process";
import path from "node:path";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3001",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "",
      BLOB_READ_WRITE_TOKEN: "",
      BLOB_STORE_ID: "",
      S3_BUCKET: "",
      CRM_SQLITE_PATH: path.join(
        process.cwd(),
        "runtime",
        "browser-test.sqlite",
      ),
    },
  },
);
process.on("SIGINT", () => child.kill("SIGINT"));
