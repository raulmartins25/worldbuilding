import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Project } from "../lib/types";

export function Worlds() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api.get<{ projects: Project[] }>("/projects");
    setProjects(r.projects);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createWorld(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ project: Project }>("/projects", { name });
      setName("");
      navigate(`/worlds/${r.project.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "2rem 1rem" }}>
      <div className="row">
        <h1 className="grow" style={{ margin: 0 }}>Seus mundos</h1>
        <span className="muted">{user?.displayName ?? user?.email}</span>
        <button onClick={logout}>Sair</button>
      </div>

      <form className="row" style={{ marginTop: "1.5rem" }} onSubmit={createWorld}>
        <input className="grow" placeholder="Nome do novo mundo…" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={busy}>Criar</button>
      </form>

      <div className="stack" style={{ marginTop: "1.5rem" }}>
        {projects.length === 0 && <p className="muted">Nenhum mundo ainda. Crie o primeiro acima.</p>}
        {projects.map((p) => (
          <div key={p.id} className="card row" style={{ cursor: "pointer" }} onClick={() => navigate(`/worlds/${p.id}`)}>
            <div className="grow">
              <strong>{p.name}</strong>
              {p.description && <div className="muted">{p.description}</div>}
            </div>
            <span className="muted">→</span>
          </div>
        ))}
      </div>
    </div>
  );
}
