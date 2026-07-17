import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

interface Msg { role: "user" | "assistant"; content: string; }
interface WMap { id: string; name: string; imageUrl: string; }

export function MapGenPanel({ projectId, onDone }: { projectId: string; onDone: (createdId: string | null) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [name, setName] = useState("Mapa gerado");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<WMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function turn(history: Msg[]) {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ ask: string | null; prompt: string | null }>(`/projects/${projectId}/maps/interview`, { messages: history });
      if (r.prompt) setPrompt(r.prompt);
      else if (r.ask) setMsgs([...history, { role: "assistant", content: r.ask }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally { setBusy(false); }
  }

  useEffect(() => { void turn([]); /* abertura da entrevista */ /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [msgs, prompt, busy]);

  function send() {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    void turn([...msgs, { role: "user", content: t }]);
  }

  async function generate() {
    if (!prompt) return;
    setGenerating(true); setError(null);
    try {
      const r = await api.post<{ map: WMap }>(`/projects/${projectId}/maps/generate`, { prompt, name: name.trim() || "Mapa gerado" });
      setPreview(r.map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally { setGenerating(false); }
  }

  return (
    <div onClick={() => onDone(preview ? preview.id : null)} style={{ position: "fixed", inset: 0, zIndex: 55, background: "rgba(15,18,30,.4)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "7vh" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: "94vw", maxHeight: "85vh", background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 40px rgba(20,24,40,.25)", display: "flex", flexDirection: "column" }}>
        <div className="row" style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <strong className="grow" style={{ fontWeight: 500 }}>Gerar mapa por entrevista</strong>
          <button onClick={() => onDone(preview ? preview.id : null)}>fechar</button>
        </div>

        <div ref={scrollRef} className="stack" style={{ padding: 14, overflow: "auto", flex: 1 }}>
          {preview ? (
            <div className="stack">
              <div className="muted" style={{ fontSize: 13 }}>Mapa gerado e salvo como <strong>{preview.name}</strong>.</div>
              <img src={preview.imageUrl} alt={preview.name} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)" }} />
              <button className="primary" onClick={() => onDone(preview.id)}>Abrir no mapa</button>
            </div>
          ) : (
            <>
              {msgs.map((m, i) => (
                <div key={i} className="card" style={{ padding: 10, background: m.role === "user" ? "var(--panel-2)" : "var(--panel)", borderLeft: m.role === "assistant" ? "3px solid var(--accent)" : undefined }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{m.role === "user" ? "você" : "cartógrafo"}</div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{m.content}</div>
                </div>
              ))}
              {busy && <div className="muted">pensando…</div>}
              {prompt && (
                <div className="card" style={{ borderColor: "var(--success)", background: "color-mix(in srgb, var(--success) 8%, var(--panel))" }}>
                  <div className="muted" style={{ fontSize: 12 }}>Briefing do mapa pronto</div>
                  <div style={{ fontSize: 13, margin: "6px 0", maxHeight: 96, overflow: "auto", fontStyle: "italic" }}>{prompt}</div>
                  <div className="row" style={{ marginTop: 4 }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do mapa" style={{ width: 180 }} />
                    <button className="primary" onClick={generate} disabled={generating}>{generating ? "Desenhando o mapa… (~30s)" : "Gerar mapa"}</button>
                  </div>
                </div>
              )}
              {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
            </>
          )}
        </div>

        {!preview && !prompt && (
          <div className="row" style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
            <input className="grow" placeholder="Responder ao cartógrafo…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
            <button onClick={send} disabled={busy}>Enviar</button>
          </div>
        )}
      </div>
    </div>
  );
}
