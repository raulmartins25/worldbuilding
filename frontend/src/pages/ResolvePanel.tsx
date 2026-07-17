import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Check { id: string; title: string; detail: string | null; payload: { entries?: string[] }; }
interface Suggestion { entryTitle: string; field: "summary" | "status"; value: string; }
interface Msg { role: "user" | "assistant"; content: string; }

export function ResolvePanel({ projectId, check, onDone }: { projectId: string; check: Check; onDone: (resolved: boolean) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function turn(history: Msg[]) {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ reply: string; suggestion: Suggestion | null }>(`/projects/${projectId}/ai/resolve`, { checkId: check.id, messages: history });
      setMsgs([...history, { role: "assistant", content: r.reply }]);
      setSuggestion(r.suggestion);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally { setBusy(false); }
  }

  useEffect(() => { void turn([]); /* abertura da IA */ /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function send() {
    const t = input.trim();
    if (!t) return;
    setInput("");
    void turn([...msgs, { role: "user", content: t }]);
  }

  async function apply() {
    if (!suggestion) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/ai-checks/${check.id}/apply`, suggestion);
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
      setBusy(false);
    }
  }

  return (
    <div onClick={() => onDone(false)} className="modal-backdrop" style={{ position: "fixed", inset: 0, zIndex: 55, background: "rgba(15,18,30,.4)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "8vh" }}>
      <div onClick={(e) => e.stopPropagation()} className="modal-sheet" style={{ width: 600, maxWidth: "94vw", maxHeight: "82vh", background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 40px rgba(20,24,40,.25)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div className="row">
            <strong className="grow" style={{ fontWeight: 500 }}>{check.title}</strong>
            <button onClick={() => onDone(false)}>fechar</button>
          </div>
          {check.detail && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{check.detail}</div>}
        </div>

        <div className="stack" style={{ padding: 14, overflow: "auto", flex: 1 }}>
          {msgs.map((m, i) => (
            <div key={i} className="card" style={{ padding: 10, background: m.role === "user" ? "var(--panel-2)" : "var(--panel)", borderLeft: m.role === "assistant" ? "3px solid var(--accent)" : undefined }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{m.role === "user" ? "você" : "IA"}</div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{m.content}</div>
            </div>
          ))}
          {busy && <div className="muted">IA pensando…</div>}
          {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
          {suggestion && (
            <div className="card" style={{ borderColor: "var(--success)", background: "color-mix(in srgb, var(--success) 8%, var(--panel))" }}>
              <div className="muted" style={{ fontSize: 12 }}>Correção proposta</div>
              <div style={{ fontSize: 14, margin: "4px 0" }}>
                Em <strong>{suggestion.entryTitle}</strong>, ajustar <strong>{suggestion.field === "status" ? "status" : "resumo"}</strong> para:
                <div style={{ marginTop: 4, fontStyle: "italic" }}>“{suggestion.value}”</div>
              </div>
              <button className="primary" onClick={apply} disabled={busy}>Aplicar correção e resolver</button>
            </div>
          )}
        </div>

        <div className="row" style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
          <input className="grow" placeholder="Responder / pedir outra opção…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
          <button onClick={send} disabled={busy}>Enviar</button>
        </div>
      </div>
    </div>
  );
}
