import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { IconX, IconVolume, IconVolumeOff, IconSparkles, IconArrowUpRight, IconAlertTriangle } from "@tabler/icons-react";
import { api } from "../lib/api";
import { mentionExtension, type MItem } from "../lib/mention";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";

interface FullEntry { id: string; title: string; body: unknown; type: string; }
interface SceneEntry { title: string; type: string; summary: string | null; importance: number; status: string; }
interface Continuity { issue: string }

// ids das fichas mencionadas (@) no doc
function mentionIds(editor: Editor | null): string[] {
  if (!editor) return [];
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "mention" && node.attrs.id) ids.push(node.attrs.id as string);
  });
  return [...new Set(ids)];
}

const wordCount = (t: string) => { const s = t.trim(); return s ? s.split(/\s+/).length : 0; };

function roleOf(e: SceneEntry): string {
  let role = typeMeta(e.type).label.toLowerCase();
  if (["character", "creature", "deity"].includes(e.type)) {
    if (e.importance >= 4) role = "protagonista";
    else if (e.importance >= 2) role = "coadjuvante";
  }
  if (e.status === "archived") role += " · arquivado";
  else if (e.status === "draft") role += " · rascunho";
  return role;
}

// gerador de som ambiente (ruído marrom filtrado, bem baixo) — sem assets
function useAmbient() {
  const ref = useRef<AudioContext | null>(null);
  const [on, setOn] = useState(false);
  const toggle = async () => {
    if (on) { await ref.current?.close().catch(() => {}); ref.current = null; setOn(false); return; }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; data[i] = last * 3.5; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
      const gain = ctx.createGain(); gain.gain.value = 0.06;
      src.connect(lp); lp.connect(gain); gain.connect(ctx.destination); src.start();
      ref.current = ctx; setOn(true);
    } catch { /* áudio indisponível */ }
  };
  useEffect(() => () => { ref.current?.close().catch(() => {}); }, []);
  return { on, toggle };
}

export function FocusMode({ entryId, projectId, onClose }: { entryId: string; projectId: string; onClose: () => void }) {
  const [entry, setEntry] = useState<FullEntry | null>(null);
  const [projectName, setProjectName] = useState("Mundo");
  const [entryMap, setEntryMap] = useState<Record<string, SceneEntry>>({});
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const [words, setWords] = useState(0);
  const [whisper, setWhisper] = useState<string | null>(null);
  const [continuity, setContinuity] = useState<Continuity[]>([]);
  const [assisting, setAssisting] = useState(false);
  const entriesRef = useRef<MItem[]>([]);
  const didAssist = useRef(false);

  const linkMention = (mid: string) => {
    if (mid && mid !== entryId) void api.post(`/projects/${projectId}/relationships`, { sourceId: entryId, targetId: mid, type: "aparece_em" }).catch(() => {});
  };
  const editor = useEditor({
    extensions: [StarterKit, mentionExtension(() => entriesRef.current, linkMention)],
    content: "",
    onUpdate: ({ editor }) => { setSceneIds(mentionIds(editor)); setWords(wordCount(editor.getText())); },
  });
  const ambient = useAmbient();

  const runAssist = useCallback(async () => {
    if (!editor) return;
    setAssisting(true);
    try {
      const r = await api.post<{ whisper: string | null; continuity: Continuity[] }>(`/projects/${projectId}/scenes/assist`, { text: editor.getText() });
      setWhisper(r.whisper);
      setContinuity(r.continuity ?? []);
    } catch { /* silencioso */ } finally { setAssisting(false); }
  }, [editor, projectId]);

  useEffect(() => { api.get<{ entry: FullEntry }>(`/entries/${entryId}`).then((r) => setEntry(r.entry)); }, [entryId]);
  useEffect(() => { api.get<{ project: { name: string } }>(`/projects/${projectId}`).then((r) => setProjectName(r.project.name)).catch(() => {}); }, [projectId]);
  useEffect(() => {
    api.get<{ entries: (MItem & { summary: string | null; importance: number; status: string })[] }>(`/projects/${projectId}/entries`).then((r) => {
      entriesRef.current = r.entries.filter((e) => e.id !== entryId);
      setEntryMap(Object.fromEntries(r.entries.map((e) => [e.id, { title: e.title, type: e.type, summary: e.summary, importance: e.importance ?? 0, status: e.status }])));
    }).catch(() => {});
  }, [projectId, entryId]);
  useEffect(() => {
    const b = entry?.body as { type?: string } | undefined;
    if (editor && b && b.type === "doc") {
      editor.commands.setContent(b as object);
      setSceneIds(mentionIds(editor));
      setWords(wordCount(editor.getText()));
    }
  }, [editor, entry]);

  // sussurro + continuidade uma vez ao abrir (se houver texto)
  useEffect(() => {
    if (editor && entry && !didAssist.current) {
      didAssist.current = true;
      setTimeout(() => { if (editor.getText().trim()) void runAssist(); }, 350);
    }
  }, [editor, entry, runAssist]);

  async function close() {
    if (editor) await api.patch(`/entries/${entryId}`, { body: editor.getJSON() });
    onClose();
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") void close(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div className="focus-overlay">
      <div className="focus-bar">
        <div className="focus-crumb">
          <span className="focus-crumb-world">{projectName}</span>
          <span className="focus-crumb-sep">›</span>
          <span className="focus-crumb-scene">{entry?.title ?? ""}</span>
        </div>
        <div className="focus-bar-right">
          <span className="focus-words">{words.toLocaleString("pt-BR")} palavras</span>
          <button onClick={ambient.toggle} title="som ambiente">
            {ambient.on ? <IconVolume size={18} /> : <IconVolumeOff size={18} />}
          </button>
          <button onClick={close} title="sair (Esc)"><IconX size={18} /> sair</button>
        </div>
      </div>

      <div className="focus-page">
        <h1 className="focus-title">{entry?.title ?? ""}</h1>
        <div className="focus-editor"><EditorContent editor={editor} /></div>
        {continuity.map((c, i) => (
          <div key={i} className="focus-continuity">
            <IconAlertTriangle size={16} />
            <span><strong>Continuidade:</strong> {c.issue}</span>
          </div>
        ))}
      </div>

      <aside className="focus-scene">
        <div className="focus-scene-title">Nesta cena</div>
        {sceneIds.length === 0 && <div className="focus-scene-empty">Mencione fichas com @ para vê-las aqui.</div>}
        {sceneIds.map((id) => {
          const e = entryMap[id];
          if (!e) return null;
          const m = typeMeta(e.type);
          return (
            <div key={id} className="focus-scene-item">
              <span className="focus-scene-avatar" style={{ background: m.tint, border: `1px solid ${m.color}` }}>
                <EntryIcon type={e.type} size={15} color={m.color} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="focus-scene-name">{e.title}</div>
                <div className="focus-scene-role" style={{ color: m.color }}>{roleOf(e)}</div>
              </div>
            </div>
          );
        })}

        {whisper && (
          <div className="focus-whisper">
            <div className="focus-whisper-head"><IconSparkles size={14} /> IA de cena</div>
            <div className="focus-whisper-body">{whisper}</div>
          </div>
        )}

        <button className="focus-check" onClick={runAssist} disabled={assisting}>
          {assisting ? "Analisando…" : <>Checar continuidade <IconArrowUpRight size={14} /></>}
        </button>
        <div className="focus-hint">Digite <strong>@</strong> pra ligar um card</div>
      </aside>
    </div>
  );
}
