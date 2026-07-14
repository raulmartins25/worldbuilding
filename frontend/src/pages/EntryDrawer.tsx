import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { api } from "../lib/api";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { AttributesTab } from "./drawer/AttributesTab";
import { TagsTab } from "./drawer/TagsTab";
import { ReferencesTab } from "./drawer/ReferencesTab";
import { RelationsTab } from "./drawer/RelationsTab";
import { InterviewTab } from "./drawer/InterviewTab";

interface FullEntry {
  id: string; title: string; summary: string | null; type: string;
  body: unknown; status: string;
}

type Tab = "conteudo" | "atributos" | "tags" | "refs" | "relacoes" | "entrevista";
const TABS: { k: Tab; label: string }[] = [
  { k: "conteudo", label: "Conteúdo" },
  { k: "atributos", label: "Atributos" },
  { k: "tags", label: "Tags" },
  { k: "refs", label: "Referências" },
  { k: "relacoes", label: "Relações" },
  { k: "entrevista", label: "Entrevista" },
];

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const btn = (active: boolean, on: () => void, label: string) => (
    <button type="button" onMouseDown={(e) => { e.preventDefault(); on(); }}
      style={{ padding: "2px 8px", background: active ? "var(--accent)" : "var(--panel-2)", borderColor: "transparent" }}>{label}</button>
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

export function EntryDrawer({ entryId, projectId, onClose }: { entryId: string; projectId: string; onClose: () => void }) {
  const [entry, setEntry] = useState<FullEntry | null>(null);
  const [tab, setTab] = useState<Tab>("conteudo");
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

  async function saveContent() {
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
    <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 440, zIndex: 20, background: "var(--panel)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", boxShadow: "-8px 0 24px rgba(0,0,0,.35)" }}>
      <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        {entry && <EntryIcon type={entry.type} size={22} color={typeMeta(entry.type).color} />}
        <span className="muted grow" style={{ fontSize: 12 }}>{entry ? typeMeta(entry.type).label : ""} · {title}</span>
        <button onClick={onClose}>fechar</button>
      </div>

      <div className="row" style={{ gap: 2, padding: "6px 8px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ padding: "4px 8px", fontSize: 13, background: tab === t.k ? "var(--panel-2)" : "transparent", color: tab === t.k ? "var(--text)" : "var(--muted)", border: "none" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: 12, overflow: "auto", flex: 1 }}>
        {tab === "conteudo" && (
          <div className="stack">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" style={{ fontSize: 18, fontWeight: 700 }} />
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Resumo curto…" rows={2} />
            <div className="row">
              <span className="muted" style={{ fontSize: 13 }}>status:</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
                <option value="draft">Rascunho</option>
                <option value="canon">Canônico</option>
                <option value="archived">Arquivado</option>
              </select>
              <span className="grow" />
              {savedAt && <span className="muted" style={{ fontSize: 12 }}>salvo {savedAt}</span>}
              <button className="primary" onClick={saveContent} disabled={saving}>{saving ? "…" : "Salvar"}</button>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <Toolbar editor={editor} />
              <div className="tiptap-wrap"><EditorContent editor={editor} /></div>
            </div>
          </div>
        )}
        {tab === "atributos" && <AttributesTab entryId={entryId} />}
        {tab === "tags" && <TagsTab entryId={entryId} projectId={projectId} />}
        {tab === "refs" && <ReferencesTab entryId={entryId} />}
        {tab === "relacoes" && <RelationsTab entryId={entryId} projectId={projectId} />}
        {tab === "entrevista" && <InterviewTab entryId={entryId} title={title || "personagem"} />}
      </div>
    </div>
  );
}
