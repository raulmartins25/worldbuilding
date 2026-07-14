import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";

interface Result { id: string; title: string; type: string; summary: string | null; score: number; }
interface Check {
  id: string; kind: string; severity: string; title: string; detail: string | null;
  status: string; payload: { entries?: string[] };
}

const SEV_COLOR: Record<string, string> = { info: "#58a6ff", warning: "#d29922", critical: "#f85149" };

export function AIView({ projectId }: { projectId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChecks = useCallback(async () => {
    const r = await api.get<{ checks: Check[] }>(`/projects/${projectId}/ai/checks`);
    setChecks(r.checks);
  }, [projectId]);

  useEffect(() => {
    api.get<{ enabled: boolean }>("/ai/status").then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false));
    void loadChecks();
  }, [loadChecks]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null); setMsg(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "erro"); } finally { setBusy(null); }
  }

  const reindex = () => run("reindex", async () => {
    const r = await api.post<{ reindexed: number; total: number }>(`/projects/${projectId}/ai/reindex`);
    setMsg(`Indexadas ${r.reindexed}/${r.total} entries.`);
  });

  const check = () => run("check", async () => {
    const r = await api.post<{ count: number }>(`/projects/${projectId}/ai/check`);
    setMsg(`Checagem concluída: ${r.count} apontamento(s).`);
    await loadChecks();
  });

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    await run("search", async () => {
      const r = await api.post<{ results: Result[] }>(`/projects/${projectId}/ai/search`, { query });
      setResults(r.results);
    });
  }

  async function setStatus(id: string, status: string) {
    await api.patch(`/ai-checks/${id}`, { status });
    await loadChecks();
  }

  const disabled = enabled === false;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "1.5rem", height: "100%", overflow: "auto" }}>
      <h2 style={{ marginTop: 0 }}>IA</h2>

      {disabled && (
        <div className="card" style={{ borderColor: "#d29922", marginBottom: "1rem" }}>
          IA não configurada. Adicione <code>OPENAI_API_KEY</code> no env do serviço <strong>loregrid-api</strong> e faça o redeploy.
        </div>
      )}
      {msg && <div className="muted" style={{ marginBottom: 8 }}>{msg}</div>}
      {error && <div style={{ color: "#ff6b6b", marginBottom: 8 }}>{error}</div>}

      <div className="row" style={{ marginBottom: "1.25rem" }}>
        <button onClick={reindex} disabled={!!busy || disabled}>{busy === "reindex" ? "…" : "Reindexar embeddings"}</button>
        <button onClick={check} disabled={!!busy || disabled}>{busy === "check" ? "Analisando…" : "Checar consistência"}</button>
      </div>

      <form onSubmit={search} className="row">
        <input className="grow" placeholder="Busca semântica…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="primary" disabled={!!busy || disabled}>Buscar</button>
      </form>
      <div className="stack" style={{ marginTop: 12 }}>
        {results.map((r) => (
          <div key={r.id} className="card row">
            <span className="muted" style={{ width: 90, fontSize: 12 }}>{r.type}</span>
            <div className="grow"><strong>{r.title}</strong>{r.summary && <div className="muted" style={{ fontSize: 13 }}>{r.summary}</div>}</div>
            <span className="muted" style={{ fontSize: 12 }}>{(r.score * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: "1.75rem" }}>Consistência</h3>
      {checks.length === 0 && <p className="muted">Nenhum apontamento. Rode "Checar consistência".</p>}
      <div className="stack">
        {checks.map((c) => (
          <div key={c.id} className="card" style={{ borderLeft: `4px solid ${SEV_COLOR[c.severity] ?? "var(--border)"}`, opacity: c.status === "open" ? 1 : 0.55 }}>
            <div className="row">
              <strong className="grow">{c.title}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{c.severity} · {c.status}</span>
            </div>
            {c.detail && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{c.detail}</div>}
            {!!c.payload?.entries?.length && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>envolve: {c.payload.entries.join(", ")}</div>
            )}
            {c.status === "open" && (
              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={() => setStatus(c.id, "resolved")}>resolver</button>
                <button onClick={() => setStatus(c.id, "ignored")}>ignorar</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
