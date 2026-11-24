import { test } from "node:test";
import assert from "node:assert/strict";
import { findCompanyMatches } from "../lib/company-matches.mjs";

const companies = [
  { id: "one", name: "Mineração Horizonte Ltda", cnpj: "12.345.678/0001-90" },
  { id: "two", name: "Pedreira Serra Azul", cnpj: "98.765.432/0001-10" },
];

test("sugere nome equivalente com acentos ou pontuação diferentes", () => {
  const matches = findCompanyMatches("MINERACAO HORIZONTE, LTDA.", "", companies);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].company.id, "one");
  assert.deepEqual(matches[0].reasons, ["Nome igual"]);
});

test("sugere variação do nome ou CNPJ exato e ordena correspondência forte primeiro", () => {
  const matches = findCompanyMatches(
    "Mineração Horizonte",
    "98.765.432/0001-10",
    companies,
  );
  assert.deepEqual(matches.map((match) => match.company.id), ["two", "one"]);
  assert.deepEqual(matches[0].reasons, ["CNPJ igual"]);
  assert.deepEqual(matches[1].reasons, ["Nome parecido"]);
});

test("ignora textos curtos ou CNPJ incompleto para evitar alertas genéricos", () => {
  assert.deepEqual(findCompanyMatches("Serra", "", companies), []);
  assert.deepEqual(findCompanyMatches("Empresa Nova", "12.345", companies), []);
  assert.deepEqual(findCompanyMatches("", "", companies), []);
});

test("reconhece e compara CNPJ alfanumérico com ou sem pontuação", () => {
  const existing = [{ id: "new", name: "Empresa Recente", cnpj: "12.ABC.345/0001-90" }];
  const matches = findCompanyMatches("Outra razão social", "12.abc.345/0001-90", existing);
  assert.equal(matches[0].company.id, "new");
  assert.deepEqual(matches[0].reasons, ["CNPJ igual"]);
  assert.deepEqual(findCompanyMatches("Empresa Recente", "12ABC345000190", existing)[0].reasons, ["CNPJ igual", "Nome igual"]);
});

test("reconhece filiais com a mesma base de CNPJ sem confundir números completos", () => {
  const existing = [{ id: "matrix", name: "Grupo Mineral", cnpj: "12.ABC.345/0001-90" }];
  const matches = findCompanyMatches("Outra unidade", "12.ABC.345/0002-71", existing);
  assert.equal(matches[0].company.id, "matrix");
  assert.deepEqual(matches[0].reasons, ["Base do CNPJ igual"]);
});
