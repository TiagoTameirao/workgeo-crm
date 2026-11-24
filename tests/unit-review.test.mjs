import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesUnitReview } from "../lib/unit-review.mjs";

test("pendências de qualidade encontram a unidade correspondente", () => {
  const unit = {
    size: "Desconhecido",
    latitude: null,
    owner: "",
    next_action: "Confirmar contato",
  };

  assert.equal(matchesUnitReview(unit, "porte"), true);
  assert.equal(matchesUnitReview(unit, "localizacao"), true);
  assert.equal(matchesUnitReview(unit, "responsavel"), true);
  assert.equal(matchesUnitReview(unit, "proxima-acao"), false);
  assert.equal(matchesUnitReview(unit, ""), true);
});
