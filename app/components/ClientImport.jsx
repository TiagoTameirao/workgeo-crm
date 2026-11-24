import { useMemo, useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { findCompanyMatches } from "../../lib/company-matches.mjs";
import { importCompanyKey, normalizeImportKey, parseProspectingCsv } from "../../lib/client-csv.mjs";

const template = "empresa;unidade;cnpj;segmento;porte;evidencia_do_porte;fonte_do_porte;municipio;endereco;latitude;longitude;site;maps;prioridade;justificativa_da_prioridade;fonte;data_da_fonte;aderencia;viabilidade;momento_comercial;materiais;contato;funcao_do_contato;telefone;email;observacoes\r\n";

export default function ClientImport({ companies, units, busy, error: parentError, onClose, onImport }) {
  const [rows, setRows] = useState([]);
  const [choices, setChoices] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const groups = useMemo(() => {
    const result = new Map();
    for (const row of rows) {
      const key = importCompanyKey(row.data);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(row);
    }
    return [...result.entries()];
  }, [rows]);
  const issues = useMemo(() => {
    const reasons = new Map();
    for (const [key, group] of groups) {
      const matches = findCompanyMatches(group[0].data.company_name, group[0].data.cnpj, companies, 5);
      const choice = choices[key];
      if (matches.length && !choice) for (const row of group) reasons.set(row.rowNumber, "Escolha uma empresa existente ou confirme uma nova empresa.");
      if (choice && choice !== "__new") {
        const existingUnitNames = new Set(units.filter((unit) => unit.company_id === choice).map((unit) => normalizeImportKey(unit.name)));
        const seen = new Set();
        for (const row of group) {
          const unitKey = normalizeImportKey(row.data.unit_name || row.data.company_name);
          if (existingUnitNames.has(unitKey)) reasons.set(row.rowNumber, "Esta unidade já consta na empresa selecionada.");
          else if (seen.has(unitKey)) reasons.set(row.rowNumber, "Unidade repetida nesta planilha.");
          seen.add(unitKey);
        }
      } else {
        const seen = new Set();
        for (const row of group) {
          const unitKey = normalizeImportKey(row.data.unit_name || row.data.company_name);
          if (seen.has(unitKey)) reasons.set(row.rowNumber, "Unidade repetida nesta planilha.");
          seen.add(unitKey);
        }
      }
    }
    for (const row of rows) if (row.errors.length) reasons.set(row.rowNumber, row.errors.join("; "));
    return reasons;
  }, [rows, groups, choices, companies, units]);
  const ready = rows.filter((row) => selected.has(row.rowNumber) && !issues.has(row.rowNumber));

  async function readFile(file) {
    setError("");
    setRows([]);
    setChoices({});
    setSelected(new Set());
    setFilename("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) return setError("Use um arquivo CSV. Baixe o modelo para manter os campos corretos.");
    if (file.size > 2_000_000) return setError("O arquivo deve ter no máximo 2 MB.");
    try {
      const parsed = parseProspectingCsv(await file.text());
      const nextChoices = {};
      const eligible = new Set();
      const groupsByCompany = new Map();
      for (const row of parsed) {
        const key = importCompanyKey(row.data);
        if (!groupsByCompany.has(key)) groupsByCompany.set(key, []);
        groupsByCompany.get(key).push(row);
      }
      for (const [key, group] of groupsByCompany) {
        const matches = findCompanyMatches(group[0].data.company_name, group[0].data.cnpj, companies, 5);
        nextChoices[key] = matches.length ? "" : "__new";
        const seenUnits = new Set();
        for (const row of group) {
          const unitName = normalizeImportKey(row.data.unit_name || row.data.company_name);
          if (!row.errors.length && !seenUnits.has(unitName)) eligible.add(row.rowNumber);
          seenUnits.add(unitName);
        }
      }
      setRows(parsed);
      setChoices(nextChoices);
      setSelected(eligible);
      setFilename(file.name);
    } catch (cause) {
      setError(cause.message || "Não foi possível ler este arquivo.");
    }
  }

  async function submit() {
    setError("");
    const result = await onImport(ready.map((row) => row), choices);
    if (!result) setError("A importação não foi concluída. Revise a mensagem apresentada no CRM.");
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <section className="form-modal client-import-modal" role="dialog" aria-modal="true" aria-labelledby="client-import-title" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header"><div><small>Clientes e unidades</small><h2 id="client-import-title">Importar lista de prospecção</h2></div><button aria-label="Fechar" onClick={onClose}><X size={20} /></button></header>
        <div className="import-body">
          <p>Envie um CSV para cadastrar várias unidades de uma vez. Empresas repetidas no arquivo são agrupadas; possíveis cadastros existentes exigem sua escolha.</p>
          <a className="import-template" href={"data:text/csv;charset=utf-8,%EF%BB%BF" + encodeURIComponent(template)} download="Modelo_Importacao_WorkGeo.csv"><Download size={16} />Baixar modelo CSV</a>
          <label className="import-file">Arquivo CSV<input type="file" accept=".csv,text/csv" onChange={(event) => readFile(event.target.files?.[0])} /></label>
          <p className="form-hint">Até 100 linhas por arquivo. CNPJ aceita o formato atual com letras e números. Porte, localização e contato podem ficar vazios quando forem desconhecidos. Coordenadas precisam vir em pares.</p>
          {(error || parentError) && <div className="error" role="alert">{error || parentError}</div>}
          {rows.length > 0 && (
            <>
              <div className="import-summary"><strong>{filename}</strong><span>{rows.length} linha(s) · {groups.length} grupo(s) de empresa · {ready.length} pronta(s) para importar</span></div>
              <div className="import-company-groups">
                {groups.map(([key, group]) => {
                  const matches = findCompanyMatches(group[0].data.company_name, group[0].data.cnpj, companies, 5);
                  return <label key={key} className="import-company-choice"><span>{group[0].data.company_name}<small>{group.length} unidade(s) no arquivo</small></span><select aria-label={`Destino da empresa ${group[0].data.company_name}`} value={choices[key] || ""} onChange={(event) => setChoices({ ...choices, [key]: event.target.value })}><option value="" disabled={matches.length > 0}>Escolha o destino</option>{matches.map(({ company, reasons }) => <option key={company.id} value={company.id}>Usar {company.name} · {reasons.join(" / ")}</option>)}<option value="__new">Criar empresa separada</option></select></label>;
                })}
              </div>
              <div className="import-row-list">
                {rows.map((row) => {
                  const disabled = issues.has(row.rowNumber);
                  return <label className={`import-row ${disabled ? "has-issue" : ""}`} key={row.rowNumber}><input type="checkbox" checked={selected.has(row.rowNumber)} disabled={disabled} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.rowNumber); else next.delete(row.rowNumber); return next; })} /><span><strong>{row.data.company_name || "Empresa sem nome"} · {row.data.unit_name || "Unidade com nome da empresa"}</strong><small>Linha {row.rowNumber}{row.data.city ? ` · ${row.data.city}` : ""}</small>{issues.has(row.rowNumber) && <small className="import-issue">{issues.get(row.rowNumber)}</small>}</span></label>;
                })}
              </div>
            </>
          )}
        </div>
        <footer className="form-footer"><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || ready.length === 0} onClick={submit}><Upload size={15} />{busy ? "Importando…" : `Importar ${ready.length} unidade(s)`}</button></footer>
      </section>
    </div>
  );
}
