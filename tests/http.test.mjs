import test from "node:test";
import assert from "node:assert/strict";
import { jsonBody } from "../lib/http.mjs";

test("jsonBody accepts CRM import payloads within the 1 MB request limit", async () => {
  const payload = { rows: ["x".repeat(600_000)] };
  const request = new Request("https://crm.example/api/prospects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  assert.deepEqual(await jsonBody(request), payload);
});

test("jsonBody rejects request bodies above the limit", async () => {
  const body = JSON.stringify({ rows: ["x".repeat(1_000_000)] });
  await assert.rejects(
    jsonBody(new Request("https://crm.example/api/prospects", { method: "POST", body })),
    (error) => error.status === 413,
  );
});
