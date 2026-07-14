import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";

interface Result { id: string; title: string; type: string; summary: string | null; score: number; }

export function AIView({ projectId }: { projectId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ enabled: boolean }>("/ai/status").then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false));
  }, []);

  async function reindex() {
    setBusy(true); setError(null); setReindexMsg(null);
    try {
      const r = await api.post<{ reindexed: number; total: number }>(`/projects/${projectId}/ai/reindex`);
      setReindexMsg(`Indexadas ${r.reindexed}/${r.total} entries.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally { setBusy(false); }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ results: Result[] }>(`/projects/${projectId}/ai/search`, { query });
      setResults(r.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem", height: "100%", overflow: "auto" }}>
      <h2 style={{ marginTop: 0 }}>IA — busca semântica</h2>

      {enabled === false && (
        <div className="card" style={{ borderColor: "#d29922", marginBottom: "1rem" }}>
          IA não configurada. Adicione <code>OPENAI_API_KEY</code> no env do serviço <strong>loregrid-api</strong> e faça o redeploy.
        </div>
      )}

      <div className="row" style={{ marginBottom: "1rem" }}>
        <button onClick={reindex} disabled={busy || enabled === false}>Reindexar embeddings</button>
        {reindexMsg && <span className="muted">{reindexMsg}</span>}
      </div>

      <form onSubmit={search} className="row">
        <input className="grow" placeholder="Busca semântica (ex.: 'quem domina magia de fogo?')" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="primary" disabled={busy || enabled === false}>Buscar</button>
      </form>

      {error && <div style={{ color: "#ff6b6b", marginTop: 12 }}>{error}</div>}

      <div className="stack" style={{ marginTop: "1.25rem" }}>
        {results.map((r) => (
          <div key={r.id} className="card row">
            <span className="muted" style={{ width: 96, fontSize: 12 }}>{r.type}</span>
            <div className="grow">
              <strong>{r.title}</strong>
              {r.summary && <div className="muted" style={{ fontSize: 13 }}>{r.summary}</div>}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{(r.score * 100).toFixed(0)}%</span>
          </div>
        ))}
        {results.length === 0 && !busy && <p className="muted">Sem resultados ainda. Reindexe e depois busque.</p>}
      </div>
    </div>
  );
}
