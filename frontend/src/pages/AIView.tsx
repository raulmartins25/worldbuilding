import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { typeMeta } from "../lib/entryTypes";
import { ResolvePanel } from "./ResolvePanel";

interface Result { id: string; title: string; type: string; summary: string | null; score: number; }
interface Check {
  id: string; kind: string; severity: string; title: string; detail: string | null;
  status: string; payload: { entries?: string[] };
}

// natureza → título + cor semântica + rótulos de ação (contradição resolve, sugestão explora)
const GROUPS: { kind: string; title: string; color: string; resolve: string; dismiss: string; chat: boolean }[] = [
  { kind: "inconsistency", title: "Contradições", color: "var(--warn-strong)", resolve: "Resolver", dismiss: "Ignorar", chat: true },
  { kind: "gap", title: "Lacunas", color: "var(--warn)", resolve: "Resolver", dismiss: "Ignorar", chat: true },
  { kind: "suggestion", title: "Sugestões de conexão", color: "var(--accent)", resolve: "Explorar", dismiss: "Dispensar", chat: false },
];

export function AIView({ projectId }: { projectId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Check | null>(null);

  const loadChecks = useCallback(async () => {
    const r = await api.get<{ checks: Check[] }>(`/projects/${projectId}/ai/checks?status=open`);
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
    setMsg(`Indexadas ${r.reindexed}/${r.total} fichas.`);
  });
  const check = () => run("check", async () => {
    const r = await api.post<{ count: number }>(`/projects/${projectId}/ai/check`);
    setMsg(`Checagem concluída: ${r.count} apontamento(s).`);
    await loadChecks();
  });
  const suggest = () => run("suggest", async () => {
    const r = await api.post<{ count: number }>(`/projects/${projectId}/ai/suggest-links`);
    setMsg(`${r.count} sugestão(ões) geradas.`);
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
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "1.5rem", height: "100%", overflow: "auto" }}>
      <h2 style={{ marginTop: 0, fontWeight: 500 }}>Central de IA</h2>

      {disabled && (
        <div className="card" style={{ borderColor: "var(--warn)", marginBottom: "1rem" }}>
          IA não configurada. Adicione <code>OPENAI_API_KEY</code> no env do serviço <strong>loregrid-api</strong> e faça o redeploy.
        </div>
      )}
      {msg && <div className="muted" style={{ marginBottom: 8 }}>{msg}</div>}
      {error && <div style={{ color: "var(--danger)", marginBottom: 8 }}>{error}</div>}

      <div className="row" style={{ marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <button onClick={reindex} disabled={!!busy || disabled}>{busy === "reindex" ? "…" : "Reindexar"}</button>
        <button onClick={check} disabled={!!busy || disabled}>{busy === "check" ? "Analisando…" : "Checar consistência"}</button>
        <button onClick={suggest} disabled={!!busy || disabled}>{busy === "suggest" ? "…" : "Sugerir ligações"}</button>
      </div>

      <form onSubmit={search} className="row">
        <input className="grow" placeholder="Busca semântica…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="primary" disabled={!!busy || disabled}>Buscar</button>
      </form>
      <div className="stack" style={{ marginTop: 12 }}>
        {results.map((r) => {
          const m = typeMeta(r.type);
          return (
            <div key={r.id} className="card row" style={{ borderLeft: `4px solid ${m.color}` }}>
              <span className="muted" style={{ width: 96, fontSize: 12, color: m.color }}>{m.label}</span>
              <div className="grow"><strong style={{ fontWeight: 500 }}>{r.title}</strong>{r.summary && <div className="muted" style={{ fontSize: 13 }}>{r.summary}</div>}</div>
              <span className="muted" style={{ fontSize: 12 }}>{(r.score * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>

      {GROUPS.map((g) => {
        const items = checks.filter((c) => c.kind === g.kind);
        if (items.length === 0) return null;
        return (
          <div key={g.kind} style={{ marginTop: "1.5rem" }}>
            <h3 style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: g.color }} /> {g.title}
              <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>({items.length})</span>
            </h3>
            <div className="stack">
              {items.map((c) => (
                <div key={c.id} className="card" style={{ borderLeft: `4px solid ${g.color}` }}>
                  <strong style={{ fontWeight: 500 }}>{c.title}</strong>
                  {c.detail && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{c.detail}</div>}
                  {!!c.payload?.entries?.length && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>envolve: {c.payload.entries.join(", ")}</div>
                  )}
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className={g.chat ? "primary" : ""} onClick={() => (g.chat ? setResolving(c) : setStatus(c.id, "resolved"))}>{g.resolve}</button>
                    <button onClick={() => setStatus(c.id, "ignored")}>{g.dismiss}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {checks.length === 0 && <p className="muted" style={{ marginTop: "1.5rem" }}>Nenhum apontamento aberto. Rode "Checar consistência" ou "Sugerir ligações".</p>}
      {resolving && <ResolvePanel projectId={projectId} check={resolving} onDone={(r) => { setResolving(null); if (r) void loadChecks(); }} />}
    </div>
  );
}
