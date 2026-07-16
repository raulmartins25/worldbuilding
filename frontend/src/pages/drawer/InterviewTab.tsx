import { useState, type FormEvent } from "react";
import { streamPost } from "../../lib/api";

interface Msg { role: "user" | "char"; content: string; }

export function InterviewTab({ entryId, title }: { entryId: string; title: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setQ(""); setBusy(true); setError(null);
    // adiciona a pergunta e uma bolha vazia do personagem, preenchida ao vivo pelo stream
    setMsgs((m) => [...m, { role: "user", content: question }, { role: "char", content: "" }]);
    const appendToLast = (delta: string) =>
      setMsgs((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, content: last.content + delta };
        return copy;
      });
    try {
      await streamPost(`/entries/${entryId}/ai/interview`, { question }, (ev) => {
        if (ev.delta) appendToLast(ev.delta);
        if (ev.error) setError(ev.error);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 13 }}>Converse com <strong>{title}</strong> em 1ª pessoa (baseado no contexto do mundo).</p>
      <div className="stack" style={{ maxHeight: 340, overflow: "auto" }}>
        {msgs.map((m, i) => {
          const streaming = busy && i === msgs.length - 1 && m.role === "char";
          return (
            <div key={i} className="card" style={{ padding: 8, background: m.role === "user" ? "var(--panel-2)" : "var(--panel)", borderLeft: m.role === "char" ? "3px solid var(--accent)" : undefined }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{m.role === "user" ? "você" : title}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>
                {m.content || (streaming ? <span className="muted">{title} está pensando…</span> : null)}
                {streaming && m.content && <span className="stream-caret">▍</span>}
              </div>
            </div>
          );
        })}
      </div>
      {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
      <form className="row" onSubmit={ask}>
        <input className="grow" placeholder={`Pergunte a ${title}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary" disabled={busy}>Perguntar</button>
      </form>
    </div>
  );
}
