import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../next.config.mjs";
test("política HTTP permite identificar origem ao carregar o mapa", async () => {
  const resolved = typeof config === "function" ? await config("phase-production-server", {}) : config;
  const rules = await resolved.headers();
  const rule = rules[0].headers.find((h) => h.key === "Referrer-Policy");
  assert.equal(rule.value, "strict-origin-when-cross-origin");
});
