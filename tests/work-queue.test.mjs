import { test } from "node:test";
import assert from "node:assert/strict";
import { actionDateStatus, buildActionQueue, filterActionQueueByOwner } from "../lib/work-queue.mjs";

test("prazo da ação distingue vencida, hoje, agendada e sem data", () => {
  const currentDate = "2026-10-13";
  assert.equal(actionDateStatus({ due_date: "2026-10-12" }, currentDate), "Vencida");
  assert.equal(actionDateStatus({ next_date: currentDate }, currentDate), "Hoje");
  assert.equal(actionDateStatus({ due_date: "2026-10-14" }, currentDate), "Agendada");
  assert.equal(actionDateStatus({}, currentDate), "Sem data");
});

test("fila diária inclui oportunidades e conversas pendentes e exclui itens encerrados", () => {
  const queue = buildActionQueue({
    activities: [{ id: "activity", name: "Ligação", status: "Pendente", due_date: "2026-10-20" }],
    requests: [{ id: "request", name: "Portfólio", status: "Em preparação", due_date: "2026-10-19" }],
    units: [{ id: "unit", name: "Unidade", next_action: "Conferir porte", next_date: "2026-10-18" }],
    lead_followups: [{ id: "lead-return", cnpj: "12345678000199", candidate_name: "Depósito Central", name: "Enviar portfólio", due_date: "2026-10-15", owner: "Tiago" }],
    opportunities: [
      { id: "open", name: "Inventário", status: "Diagnóstico", next_action: "Validar escopo", next_date: "2026-10-16" },
      { id: "closed", name: "Demanda antiga", status: "Perdida", next_action: "Encerrada", next_date: "2026-10-15" },
    ],
    conversations: [
      { id: "reply", name: "Dúvida de prazo", status: "Aguardando equipe", next_action: "Responder hoje", next_date: "2026-10-14" },
      { id: "waiting", name: "Aguardando cliente", status: "Aguardando cliente" },
    ],
    renewals: [
      { id: "renewal", name: "Revisar próxima campanha", status: "Pendente", due_date: "2026-10-17" },
      { id: "renewal-closed", name: "Concluído", status: "Concluído", due_date: "2026-10-13" },
    ],
  });

  assert.deepEqual(queue.map((item) => item.id), [
    "reply",
    "lead-return",
    "open",
    "renewal",
    "unit",
    "request",
    "activity",
  ]);
  assert.equal(queue[0].name, "Responder hoje");
  assert.equal(queue[0].kind, "Responder cliente");
  assert.equal(queue[2].entity, "opportunities");
  assert.equal(queue[1].kind, "Retorno de lead");
  assert.equal(queue[1].candidate_name, "Depósito Central");
});

test("fila não cria ações para registros sem próximo passo e aceita coleções ausentes", () => {
  assert.deepEqual(
    buildActionQueue({ units: [{ id: "unit", name: "Sem ação" }] }),
    [],
  );
  assert.deepEqual(buildActionQueue(), []);
});

test("filtro de responsável aceita nomes reais e localiza itens sem responsável", () => {
  const queue = [
    { id: "mine", owner: "Tiago Rodrigues" },
    { id: "other", owner: "Fábio" },
    { id: "unassigned" },
  ];
  assert.deepEqual(filterActionQueueByOwner(queue, "Tiago Rodrigues").map((item) => item.id), ["mine"]);
  assert.deepEqual(filterActionQueueByOwner(queue, "__unassigned").map((item) => item.id), ["unassigned"]);
  assert.equal(filterActionQueueByOwner(queue, "").length, 3);
});
