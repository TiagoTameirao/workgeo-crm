import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBrazilianPhone,
  phoneLink,
  whatsappLink,
} from "../lib/contact-links.mjs";

test("atalhos aceitam números brasileiros locais e internacionais", () => {
  assert.equal(normalizeBrazilianPhone("(31) 3562-5002"), "553135625002");
  assert.equal(normalizeBrazilianPhone("(031) 3712-9550"), "553137129550");
  assert.equal(normalizeBrazilianPhone("+55 31 99636-1019"), "5531996361019");
  assert.equal(phoneLink("(31) 3562-5002"), "tel:+553135625002");
  assert.equal(
    whatsappLink("(31) 3562-5002"),
    "https://wa.me/553135625002",
  );
});

test("atalhos não são oferecidos para telefone incompleto ou fora do padrão", () => {
  assert.equal(normalizeBrazilianPhone(""), null);
  assert.equal(normalizeBrazilianPhone("1234"), null);
  assert.equal(whatsappLink("31 1234"), null);
  assert.equal(phoneLink("31 1234"), null);
});
