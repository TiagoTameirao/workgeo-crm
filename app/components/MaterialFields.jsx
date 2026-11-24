"use client";
import { models } from "../../lib/model.mjs";
import {FileDrop} from './DocumentFiles';
export default function MaterialFields({
  values,
  setValues,
  file,
  setFile,
  editing,
  files,
  directory = [],
  units = [],
}) {
  const set = (key, value) => setValues({ ...values, [key]: value });
  const input = (key, label, required = false) => (
    <label>
      {label}
      {required ? " *" : ""}
      <input
        required={required}
        value={values[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const select = (key, label) => {
    const f = models.materials.fields.find((f) => f.key === key);
    return (
      <label>
        {label}
        <select
          value={values[key] ?? ""}
          onChange={(e) => set(key, e.target.value)}
        >
          <option value="">Selecione</option>
          {f.options.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <div className="wide">
      <div className="form-fields advanced-fields">
        {input("name", "Nome do material", true)}
        {select("category", "Tipo de material")}
        {input("service", "Serviço (ex.: volumetria)")}
        {select("segment", "Segmento indicado")}
        <label className="wide">
          Descrição / quando usar
          <textarea
            value={values.notes || ""}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
          />
        </label>
        <div className="wide upload-area">
          <FileDrop disabled={editing && values.status !== 'Rascunho'} onFile={setFile} />
          {file && (
            <p>
              {file.name} — {(file.size / 1000000).toFixed(1)} MB. Será anexado
              ao salvar.
            </p>
          )}
          {files.map((f) => (
            <a key={f.id} href={"/api/files/" + f.id} download>
              {f.filename}
            </a>
          ))}
          <p>
            PDF, documentos ou imagens. Até 30 MB na nuvem. Para atualizar um
            material enviado, crie uma nova versão.
          </p>
        </div>
        {input("url", "Ou link do material (http/https)")}
        <details className="wide">
          <summary>Versão e permissões</summary>
          <div className="form-fields advanced-fields">
            {input("revision", "Versão", true)}
            <label>Responsável pelo material<select aria-label="Responsável pelo material" value={values.owner_id || ""} onChange={(event) => set("owner_id", event.target.value)}><option value="">Selecione</option>{directory.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label>Cliente específico (opcional)<select aria-label="Cliente específico" value={values.unit_id || ""} onChange={(event) => set("unit_id", event.target.value)}><option value="">Biblioteca geral</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            {select("access", "Quem pode acessar")}
            {select("status", "Situação")}
            {input("approval", "Autorização de uso")}
          </div>
        </details>
      </div>
    </div>
  );
}
