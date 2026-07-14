import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { api } from "../lib/api";

interface FullEntry {
  id: string; title: string; summary: string | null; type: string;
  body: unknown; status: string;
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const btn = (active: boolean, on: () => void, label: string) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); on(); }}
      style={{ padding: "2px 8px", background: active ? "var(--accent)" : "var(--panel-2)", borderColor: "transparent" }}
    >{label}</button>
  );
  return (
    <div className="row" style={{ gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "B")}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "i")}
      {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "H2")}
      {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "• lista")}
      {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "❝")}
    </div>
  );
}

export function EntryDrawer({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [entry, setEntry] = useState<FullEntry | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editor = useEditor({ extensions: [StarterKit], content: "" });

  useEffect(() => {
    api.get<{ entry: FullEntry }>(`/entries/${entryId}`).then((r) => {
      setEntry(r.entry);
      setTitle(r.entry.title);
      setSummary(r.entry.summary ?? "");
      setStatus(r.entry.status);
    });
  }, [entryId]);

  useEffect(() => {
    const body = entry?.body as { type?: string } | undefined;
    if (editor && body && body.type === "doc") editor.commands.setContent(body as object);
  }, [editor, entry]);

  async function save() {
    if (!editor) return;
    setSaving(true);
    try {
      await api.patch(`/entries/${entryId}`, { title, summary, status, body: editor.getJSON() });
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 420, zIndex: 20, background: "var(--panel)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", boxShadow: "-8px 0 24px rgba(0,0,0,.35)" }}>
      <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <span className="muted grow" style={{ fontSize: 12 }}>{entry?.type ?? "…"}</span>
        {savedAt && <span className="muted" style={{ fontSize: 12 }}>salvo {savedAt}</span>}
        <button onClick={onClose}>fechar</button>
      </div>

      <div className="stack" style={{ padding: 12, overflow: "auto", flex: 1 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" style={{ fontSize: 18, fontWeight: 700 }} />
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Resumo curto…" rows={2} />
        <div className="row">
          <span className="muted" style={{ fontSize: 13 }}>status:</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
            <option value="draft">draft</option>
            <option value="canon">canon</option>
            <option value="archived">archived</option>
          </select>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <Toolbar editor={editor} />
          <div className="tiptap-wrap"><EditorContent editor={editor} /></div>
        </div>
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
        <button className="primary" onClick={save} disabled={saving} style={{ width: "100%" }}>
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
