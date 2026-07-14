import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";

interface Msg { role: "user" | "char"; content: string; }

export function InterviewTab({ entryId, title }: { entryId: string; title: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setQ(""); setBusy(true); setError(null);
    try {
      const r = await api.post<{ answer: string }>(`/entries/${entryId}/ai/interview`, { question });
      setMsgs((m) => [...m, { role: "char", content: r.answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 13 }}>Converse com <strong>{title}</strong> em 1ª pessoa (baseado no contexto do mundo).</p>
      <div className="stack" style={{ maxHeight: 340, overflow: "auto" }}>
        {msgs.map((m, i) => (
          <div key={i} className="card" style={{ padding: 8, background: m.role === "user" ? "var(--panel-2)" : "var(--panel)", borderLeft: m.role === "char" ? "3px solid var(--accent)" : undefined }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{m.role === "user" ? "você" : title}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="muted">{title} está pensando…</div>}
      </div>
      {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
      <form className="row" onSubmit={ask}>
        <input className="grow" placeholder={`Pergunte a ${title}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary" disabled={busy}>Perguntar</button>
      </form>
    </div>
  );
}
