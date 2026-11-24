"use client";
import { models } from "../../lib/model.mjs";
import { findCompanyMatches } from "../../lib/company-matches.mjs";
export default function ClientFields({
  values,
  setValues,
  companies,
  editing,
  directory = [],
  operational = false,
}) {
  const existing = !editing && values.company_mode === "existing";
  const possibleCompanies = !editing && !existing
    ? findCompanyMatches(values.company_name, values.cnpj, companies)
    : [];
  const set = (key, value) => setValues({ ...values, [key]: value });
  const input = (key, label, type = "text", required = false) => (
    <label key={key}>
      {label}
      {required ? " *" : ""}
      <input
        type={type}
        required={required}
        value={values[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const fields = (keys) =>
    models.units.fields
      .filter((f) => keys.includes(f.key) && f.key !== "owner" && (!operational || ["name", "city", "address", "latitude", "longitude", "maps_url", "sig_url"].includes(f.key)))
      .map((f) => (
        <label key={f.key}>
          {f.key === "name"
            ? editing
              ? "Nome do local *"
              : "Nome do local (opcional)"
            : f.label}
          {f.type === "select" || f.type === "user" ? (
            <select
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
            >
              <option value="">A definir</option>
              {(f.type === "user" ? directory : f.options.map((name) => ({ id: name, name }))).map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
            />
          ) : (
            <input
              type={
                f.type === "number"
                  ? "number"
                  : f.type === "date"
                    ? "date"
                    : "text"
              }
              required={editing && f.key === "name"}
              step={f.type === "number" ? "any" : undefined}
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
            />
          )}
        </label>
      ));
  return (
    <div className="wide client-fields">
      <p>Cadastre a empresa e, se já souber, o local e a pessoa de contato.</p>
      {!editing && (
        <div className="client-mode" role="group" aria-label="Tipo de cadastro">
          <button
            type="button"
            className={!existing ? "selected" : ""}
            aria-pressed={!existing}
            onClick={() => set("company_mode", "new")}
          >
            Nova empresa
          </button>
          <button
            type="button"
            className={existing ? "selected" : ""}
            aria-pressed={existing}
            disabled={!companies.length}
            onClick={() => set("company_mode", "existing")}
          >
            Empresa já cadastrada
          </button>
        </div>
      )}
      <div className="form-fields advanced-fields">
        {!editing && (existing ? (
          <label>
            Empresa *
            <select
              required
              value={values.company_id || ""}
              onChange={(e) => set("company_id", e.target.value)}
            >
              <option value="">Escolha a empresa</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            {input("company_name", "Nome da empresa", "text", true)}
            {!!possibleCompanies.length && (
              <div className="company-match-notice wide" role="status">
                <strong>Confira antes de criar outra empresa</strong>
                <p>
                  Encontramos cadastros parecidos. Eles não serão unidos
                  automaticamente.
                </p>
                {possibleCompanies.map(({ company, reasons }) => (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() =>
                      setValues({
                        ...values,
                        company_mode: "existing",
                        company_id: company.id,
                      })
                    }
                  >
                    Usar “{company.name}” · {reasons.join(" / ")}
                  </button>
                ))}
              </div>
            )}
          </>
        ))}
        {fields(["name", "segment"])}
        {!editing && (
          <>
            {input("contact_name", "Pessoa de contato (opcional)")}
            {input("phone", "Telefone (opcional)")}
            {input("email", "E-mail (opcional)", "email")}
          </>
        )}
      </div>
      {!editing && (
        <p className="form-hint">
          Sem nome de local, o CRM usa o nome da empresa. Você pode completar o
          cadastro depois.
        </p>
      )}
      <details>
        <summary>Informações comerciais e localização</summary>
        <div className="form-fields advanced-fields">
          {!editing && input("cnpj", "CNPJ (opcional)")}
          {fields(
            models.units.fields
              .map((f) => f.key)
              .filter(
                (k) =>
                  !["name", "segment", "company_id"].includes(k) &&
                  k !== "distance_original",
              ),
          )}
        </div>
      </details>
    </div>
  );
}
