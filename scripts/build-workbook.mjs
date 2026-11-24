import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { Workbook, SpreadsheetFile } = await import(
  pathToFileURL(
    "C:/Users/jessi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs",
  ).href
);
const seed = JSON.parse(
  await fs.readFile(new URL("../data/seed.json", import.meta.url), "utf8"),
);
const output = new URL("../deliverables/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const book = Workbook.create();
const serial = (s) =>
  s ? Date.parse(s + "T00:00:00Z") / 86400000 + 25569 : null;
function make(name, headers, rows) {
  const sheet = book.worksheets.add(name);
  const end = String.fromCharCode(64 + headers.length);
  sheet.getRange(`A1:${end}${Math.max(rows.length + 1, 2)}`).values = [
    headers,
    ...(rows.length ? rows : [headers.map(() => null)]),
  ];
  sheet.getRange(`A1:${end}${Math.max(rows.length + 1, 2)}`).format.font = {
    name: "Arial",
    size: 10,
    color: "#26323B",
  };
  sheet.getRange(`A1:${end}1`).format = {
    fill: "#20303A",
    font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
    rowHeight: 34,
    wrapText: true,
  };
  sheet.getRange(`A2:${end}${Math.max(rows.length + 1, 2)}`).format.rowHeight =
    25;
  sheet.getRange(`A1:${end}100`).format.columnWidth = 19;
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  if (name !== "Listas e regras") sheet.freezePanes.freezeColumns(2);
  const table = sheet.tables.add(
    `A1:${end}${Math.max(rows.length + 1, 2)}`,
    true,
    name.replace(/[^a-zA-Z]/g, "") + "Dados",
  );
  table.style = "TableStyleMedium1";
  return sheet;
}
const cadastro = make(
  "Cadastro",
  [
    "ID unidade",
    "ID empresa",
    "Empresa",
    "Unidade",
    "Segmento",
    "Materiais",
    "Porte",
    "Evidência do porte",
    "Fonte do porte",
    "Prioridade",
    "Justificativa",
    "Responsável",
    "Prospecção",
    "Próxima ação",
    "Retorno",
    "Alerta",
    "Município",
    "Latitude",
    "Longitude",
    "Maps",
    "Distância rodoviária (km)",
    "Tempo (min)",
    "Origem do deslocamento",
    "Distância original",
    "Fonte",
    "Data da fonte",
  ],
  seed.units.map((u) => [
    u.id,
    u.company_id,
    u.company_name,
    u.name,
    u.segment,
    u.materials,
    u.size,
    u.size_evidence,
    null,
    u.priority,
    null,
    null,
    u.status,
    null,
    null,
    null,
    null,
    u.latitude ?? null,
    u.longitude ?? null,
    u.maps_url,
    u.distance_km,
    u.travel_minutes,
    null,
    u.distance_original,
    u.source,
    serial(u.source_date),
  ]),
);
cadastro.getRange("C1:D100").format.columnWidth = 65;
cadastro.getRange("C2:D28").format.wrapText = true;
cadastro.getRange("C2:D28").format.autofitRows();
cadastro.getRange("F1:F100").format.columnWidth = 30;
cadastro.getRange("N1:N100").format.columnWidth = 30;
cadastro.getRange("P1:P100").format.columnWidth = 24;
cadastro.getRange("T1:T100").format.columnWidth = 45;
cadastro.getRange("Y1:Y100").format.columnWidth = 65;
cadastro.getRange("O2:O100").setNumberFormat("dd/mm/yyyy");
cadastro.getRange("Z2:Z100").setNumberFormat("dd/mm/yyyy");
cadastro.getRange("U2:U100").setNumberFormat("0.0");
cadastro.getRange("V2:V100").setNumberFormat("0");
for (let r = 2; r <= 28; r++)
  cadastro.getRange("P" + r).formulas = [
    [
      `=IF(D${r}="","",IF(O${r}="","Definir retorno",IF(O${r}<TODAY(),"Retorno vencido","Agendado")))`,
    ],
  ];
cadastro
  .getRange("A2:Z100")
  .conditionalFormats.addCustom('AND($D2<>"",$O2<>"",$O2<TODAY())', {
    fill: "#FFF0ED",
    font: { color: "#AC3B2A" },
  });
for (const [col, options] of [
  ["G", ["Pequeno", "Médio", "Grande", "Desconhecido"]],
  ["H", ["Confirmado", "Declarado", "Desconhecido"]],
  ["J", ["Alta", "Média", "Baixa", "Não definida"]],
  ["L", ["Tiago", "Fábio", "Josi", "Pedro", "Douglas"]],
  [
    "M",
    [
      "Pesquisa",
      "Cadastro conferido",
      "Abordagem",
      "Qualificação",
      "Pausado",
      "Desqualificado",
    ],
  ],
])
  cadastro.getRange(`${col}2:${col}100`).dataValidation = {
    rule: { type: "list", values: options },
  };
const contacts = make(
  "Contatos",
  [
    "ID contato",
    "ID unidade",
    "Unidade",
    "Pessoa / canal",
    "Função",
    "E-mail",
    "Telefone",
    "Telefone original",
    "Fonte",
    "Conferido em",
  ],
  seed.contacts.map((c) => [
    c.id,
    c.unit_id,
    seed.units.find((u) => u.id === c.unit_id).name,
    c.name,
    c.role || null,
    c.email || null,
    c.phone || null,
    c.phone_original || null,
    c.source,
    null,
  ]),
);
contacts.getRange("C1:D100").format.columnWidth = 39;
contacts.getRange("F1:F100").format.columnWidth = 39;
contacts.getRange("G2:H100").setNumberFormat("@");
contacts.getRange("I1:I100").format.columnWidth = 65;
contacts.getRange("J2:J100").setNumberFormat("dd/mm/yyyy");
const activities = make(
  "Atividades",
  [
    "ID atividade",
    "ID unidade",
    "Unidade",
    "Data do contato",
    "Responsável",
    "Canal",
    "Ação",
    "Resultado",
    "Retorno",
    "Situação",
  ],
  [],
);
activities.getRange("C1:C100").format.columnWidth = 40;
activities.getRange("G1:H100").format.columnWidth = 38;
activities.getRange("D2:D100").setNumberFormat("dd/mm/yyyy");
activities.getRange("I2:I100").setNumberFormat("dd/mm/yyyy");
activities.getRange("E2:E100").dataValidation = {
  rule: {
    type: "list",
    values: ["Tiago", "Fábio", "Josi", "Pedro", "Douglas"],
  },
};
activities.getRange("F2:F100").dataValidation = {
  rule: {
    type: "list",
    values: ["WhatsApp", "E-mail", "Ligação", "Visita", "Interno"],
  },
};
activities.getRange("J2:J100").dataValidation = {
  rule: { type: "list", values: ["Pendente", "Concluída", "Cancelada"] },
};
activities
  .getRange("A2:J100")
  .conditionalFormats.addCustom(
    'AND($G2<>"",$I2<>"",$I2<TODAY(),$J2="Pendente")',
    { fill: "#FFF0ED", font: { color: "#AC3B2A" } },
  );
const lists = make(
  "Listas e regras",
  ["Assunto", "Regra / orientação"],
  [
    [
      "Fonte",
      "Planilha original fornecida pelo usuário, recebida em 13/10/2026.",
    ],
    [
      "Importação",
      "27 unidades, 22 entradas de contato e 40 linhas apenas numeradas excluídas.",
    ],
    [
      "Porte",
      "Não foi confirmado. Registre fonte e evidência antes de classificar.",
    ],
    [
      "Empresas",
      "Lhoist agrupada pelo nome das duas unidades; identidade jurídica não confirmada.",
    ],
    [
      "Telefones",
      "MBL e Itabrita compartilham telefone no original. Conferir sem mesclar.",
    ],
    [
      "Contatos",
      "Uma linha por pessoa ou canal. Os nomes não foram inferidos a partir dos e-mails.",
    ],
    [
      "Geografia",
      "KML original preservado. Distância rodoviária não determina inclusão no contorno.",
    ],
    [
      "Distâncias",
      "Origem dos deslocamentos do arquivo original não confirmada. Tempos sem data de consulta.",
    ],
    [
      "Rotina",
      "Toda abordagem ativa deve ter responsável, próxima ação e retorno.",
    ],
    [
      "Uso posterior",
      "Após migração validada, o CRM será a fonte operacional.",
    ],
    [
      "Evidência",
      "Desconhecido é diferente de zero, não e ausência de demanda.",
    ],
    [
      "Dados originais",
      "Nomes e informações fornecidas preservados no arquivo-fonte e no CRM.",
    ],
  ],
);
lists.getRange("A1:A30").format.columnWidth = 22;
lists.getRange("B1:B30").format.columnWidth = 105;
book.recalculate();
const check = await book.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!",
  options: { useRegex: true, maxResults: 20 },
  summary: "Erros de fórmula",
});
console.log(check.ndjson);
for (const [sheet, range] of [
  ["Cadastro", "A1:F10"],
  ["Contatos", "A1:F10"],
  ["Atividades", "A1:J5"],
  ["Listas e regras", "A1:B13"],
]) {
  const b = await book.render({ sheetName: sheet, range, scale: 1.5 });
  await fs.writeFile(
    new URL(sheet.replaceAll(" ", "_") + ".png", output),
    new Uint8Array(await b.arrayBuffer()),
  );
}
await (
  await SpreadsheetFile.exportXlsx(book)
).save(
  new URL("WorkGeo_CRM_Transicao.xlsx", output).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  ),
);
console.log("Planilha de transição exportada.");
