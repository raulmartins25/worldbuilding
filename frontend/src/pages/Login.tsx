import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
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
        <h1 style={{ margin: 0 }}>Loregrid</h1>
        <p className="muted" style={{ marginTop: -4 }}>Entrar na sua conta</p>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        <div className="muted">Não tem conta? <Link to="/register">Criar conta</Link></div>
      </form>
    </div>
  );
}
