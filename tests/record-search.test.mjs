import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesRecordSearch } from "../lib/record-search.mjs";

const data = {
  companies: [{ id: "company-1", name: "Mineração Horizonte", cnpj: "12.345.678/0001-90" }],
  units: [{ id: "unit-1", company_id: "company-1", name: "Unidade Serra", city: "Belo Horizonte", address: "Rodovia MG-030" }],
  contacts: [{ id: "contact-1", unit_id: "unit-1", name: "Ana Souza", role: "Compras", email: "ana@horizonte.com.br", phone: "+55 (31) 99999-1234" }],
};

test("busca da unidade encontra empresa, localização e contato relacionado", () => {
  const unit = data.units[0];
  for (const query of ["mineracao horizonte", "12.345.678/0001-90", "belo horizonte", "Ana Souza", "31999991234", "ana@horizonte.com.br"]) {
    assert.equal(matchesRecordSearch("units", unit, data, query), true, query);
  }
});

test("busca de oportunidade usa contato e unidade vinculados", () => {
  const opportunity = { id: "opp-1", unit_id: "unit-1", contact_id: "contact-1", name: "Inventário de pilhas" };
  assert.equal(matchesRecordSearch("opportunities", opportunity, data, "Ana Souza"), true);
  assert.equal(matchesRecordSearch("opportunities", opportunity, data, "Unidade Serra"), true);
});

test("busca mantém o nome de vínculos indiretos, como a oportunidade do pedido", () => {
  const request = { id: "request-1", unit_id: "unit-1", name: "Portfólio" };
  assert.equal(
    matchesRecordSearch("requests", request, data, "inventário", "Inventário de pilhas"),
    true,
  );
});

test("busca não diferencia acentos nem pontuação e vazia não filtra", () => {
  const unit = data.units[0];
  assert.equal(matchesRecordSearch("units", unit, data, "belo-horizonte"), true);
  assert.equal(matchesRecordSearch("units", unit, data, "   "), true);
  assert.equal(matchesRecordSearch("units", unit, data, "cliente sem relação"), false);
});
