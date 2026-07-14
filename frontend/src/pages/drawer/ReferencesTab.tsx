import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Ref { id: string; kind: string; url: string | null; title: string | null; content: string | null; }

export function ReferencesTab({ entryId }: { entryId: string }) {
  const [rows, setRows] = useState<Ref[]>([]);
  const [kind, setKind] = useState("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const load = useCallback(async () => {
    const r = await api.get<{ references: Ref[] }>(`/entries/${entryId}/references`);
    setRows(r.references);
  }, [entryId]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!url.trim() && !content.trim() && !title.trim()) return;
    await api.post(`/entries/${entryId}/references`, {
      kind, url: url || undefined, title: title || undefined, content: content || undefined,
    });
    setUrl(""); setTitle(""); setContent("");
    await load();
  }
  const del = async (id: string) => { await api.del(`/references/${id}`); await load(); };

  return (
    <div className="stack">
      {rows.length === 0 && <p className="muted">Sem referências. Anexe links, imagens ou trechos de pesquisa (moodboard).</p>}
      {rows.map((r) => (
        <div key={r.id} className="card row" style={{ padding: 8 }}>
          <span className="muted" style={{ fontSize: 11, width: 48 }}>{r.kind}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            {r.title && <div><strong>{r.title}</strong></div>}
            {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, wordBreak: "break-all" }}>{r.url}</a>}
            {r.content && <div className="muted" style={{ fontSize: 13 }}>{r.content}</div>}
          </div>
          <button onClick={() => del(r.id)}>×</button>
        </div>
      ))}
      <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 110 }}>
            <option value="link">link</option>
            <option value="image">imagem</option>
            <option value="quote">trecho</option>
            <option value="file">arquivo</option>
          </select>
          <input placeholder="título (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} className="grow" />
        </div>
        {kind === "quote" ? (
          <textarea placeholder="trecho…" value={content} onChange={(e) => setContent(e.target.value)} rows={2} />
        ) : (
          <input placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        )}
        <button className="primary" onClick={add}>+ referência</button>
      </div>
    </div>
  );
}
