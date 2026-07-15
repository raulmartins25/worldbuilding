import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, password, displayName || undefined);
      navigate("/worlds");
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card stack" style={{ width: 360 }} onSubmit={onSubmit}>
        <h1 style={{ margin: 0 }}>Criar conta</h1>
        <input placeholder="Nome" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Senha (mín. 8)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "Criando…" : "Criar conta"}</button>
        <div className="muted">Já tem conta? <Link to="/login">Entrar</Link></div>
      </form>
    </div>
  );
}
