"use client";
import { useCallback, useEffect, useState } from "react";
import { internalRoles, roleDescriptions } from "../../lib/access.mjs";

async function request(method, body) {
  const response = await fetch("/api/team", { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível atualizar a equipe."); return result;
}
const empty = { name: "", email: "", password: "", role: "" };
export default function TeamDesk({ user, onReload, onSessionEnded }) {
  const [rows, setRows] = useState([]), [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const load = useCallback(async () => setRows(await request("GET")), []);
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await request(draft.id ? "PATCH" : "POST", draft.id ? { user_id: draft.id, ...(draft.id === user.id ? {} : { role: draft.role }), email: draft.email } : draft);
      if (draft.id === user.id && draft.email !== user.email) { onSessionEnded(); return; }
      setDraft(null); await load(); await onReload(); setMessage("Acesso salvo. A pessoa entra com o e-mail e a senha inicial e pode trocar a senha em Meu perfil.");
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  return <section className="panel team-desk"><div className="agenda-tabs"><h2>Equipe e acessos internos</h2><button className="primary" onClick={() => setDraft({ ...empty })}>Cadastrar pessoa</button></div>
    <p>Funções internas baseadas no diagrama. Não há cadastro de clientes como usuários.</p>
    {message && <p role="status" className="source-note">{message}</p>}
    {draft && <form className="team-form" onSubmit={save}><h3>{draft.id ? "Editar acesso" : "Nova pessoa da equipe"}</h3><div className="form-fields">
      <label>Nome<input aria-label="Nome da pessoa" required maxLength={200} disabled={!!draft.id} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>E-mail de acesso<input aria-label="E-mail de acesso" type="email" required maxLength={200} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
      <label>Função interna<select aria-label="Função interna" required disabled={draft.id === user.id} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}><option value="">Escolha a função</option>{internalRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
      {!draft.id && <label>Senha inicial (mínimo 12 caracteres)<input aria-label="Senha inicial" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></label>}
    </div>{draft.role && <p className="source-note">{roleDescriptions[draft.role]}</p>}<p className="form-hint">Não é enviado convite automático. Compartilhe a senha inicial por um canal apropriado.</p><div className="agenda-tabs"><button disabled={busy} className="primary">{busy ? "Salvando…" : "Salvar acesso"}</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button></div></form>}
    <div className="team-list">{rows.map((person) => <article key={person.id}><div><strong>{person.name}</strong><small>{person.email}</small><span className="badge">{person.role}</span><small>{roleDescriptions[person.role]}</small><small>{person.active ? "Acesso ativo" : "Acesso suspenso"}</small></div><div className="agenda-tabs"><button disabled={busy} onClick={() => setDraft({ ...person })}>Editar acesso</button>{person.id !== user.id && <button disabled={busy} onClick={async () => { if (!window.confirm(`${person.active ? "Suspender" : "Reativar"} o acesso de ${person.name}?`)) return; setBusy(true); try { await request("PATCH", { user_id: person.id, active: !person.active }); await load(); await onReload(); setMessage("Situação atualizada."); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }}>{person.active ? "Suspender" : "Reativar"}</button>}</div></article>)}</div>
  </section>;
}
