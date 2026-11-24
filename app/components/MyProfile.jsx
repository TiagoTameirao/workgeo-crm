"use client";
import { useEffect, useState } from "react";
export default function MyProfile({ onReload }) {
  const [profile, setProfile] = useState(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  useEffect(() => { fetch("/api/profile").then(async (res) => { const value = await res.json(); if (!res.ok) throw new Error(value.error); setProfile(value); }).catch((error) => setMessage(error.message)); }, []);
  return <section className="panel"><h2>Meu perfil</h2>{message && <p role="status">{message}</p>}{profile && <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(["name", "phone", "job", "department"].map((key) => [key, profile[key] || ""]))) }); const result = await res.json(); if (!res.ok) throw new Error(result.error); await onReload(); setMessage("Perfil atualizado."); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }}><div className="form-fields">{[["name", "Nome"], ["phone", "Telefone"], ["job", "Cargo"], ["department", "Setor"]].map(([key, label]) => <label key={key}>{label}<input required={key === "name"} maxLength={200} value={profile[key] || ""} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} /></label>)}<label>E-mail de acesso<input value={profile.email} readOnly /></label><label>Perfil de acesso<input value={profile.role} readOnly /></label></div><p className="form-hint">A gestão de contas controla e-mail e permissões.</p><button disabled={busy} className="primary">{busy ? "Salvando…" : "Salvar perfil"}</button></form>}
    <details className="profile-password"><summary>Alterar minha senha</summary><form onSubmit={async (event) => {
      event.preventDefault();
      if (password.next !== password.confirm) { setMessage("A confirmação não corresponde à nova senha."); return; }
      setBusy(true);
      try {
        const res = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password: password.current, new_password: password.next }) });
        const result = await res.json(); if (!res.ok) throw new Error(result.error);
        setPassword({ current: "", next: "", confirm: "" }); setMessage("Senha alterada. As outras sessões foram encerradas.");
      } catch (error) { setMessage(error.message); } finally { setBusy(false); }
    }}><div className="form-fields">{[["current", "Senha atual"], ["next", "Nova senha (mínimo 12 caracteres)"], ["confirm", "Confirmar nova senha"]].map(([key, label]) => <label key={key}>{label}<input type="password" required minLength={key === "current" ? undefined : 12} autoComplete={key === "current" ? "current-password" : "new-password"} value={password[key]} onChange={(event) => setPassword({ ...password, [key]: event.target.value })} /></label>)}</div><button disabled={busy}>Alterar senha</button></form></details>
  </section>;
}
