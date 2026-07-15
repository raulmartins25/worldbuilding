import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { IconX, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { api } from "../lib/api";
import { mentionExtension, type MItem } from "../lib/mention";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";

interface FullEntry { id: string; title: string; body: unknown; type: string; }
interface SceneEntry { title: string; type: string; summary: string | null; }

// ids das fichas mencionadas (@) no doc
function mentionIds(editor: Editor | null): string[] {
  if (!editor) return [];
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "mention" && node.attrs.id) ids.push(node.attrs.id as string);
  });
  return [...new Set(ids)];
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
  const [entryMap, setEntryMap] = useState<Record<string, SceneEntry>>({});
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const entriesRef = useRef<MItem[]>([]);
  const linkMention = (mid: string) => {
    if (mid && mid !== entryId) void api.post(`/projects/${projectId}/relationships`, { sourceId: entryId, targetId: mid, type: "aparece_em" }).catch(() => {});
  };
  const editor = useEditor({
    extensions: [StarterKit, mentionExtension(() => entriesRef.current, linkMention)],
    content: "",
    onUpdate: ({ editor }) => setSceneIds(mentionIds(editor)),
  });
  const ambient = useAmbient();

  useEffect(() => { api.get<{ entry: FullEntry }>(`/entries/${entryId}`).then((r) => setEntry(r.entry)); }, [entryId]);
  useEffect(() => {
    api.get<{ entries: (MItem & { summary: string | null })[] }>(`/projects/${projectId}/entries`).then((r) => {
      entriesRef.current = r.entries.filter((e) => e.id !== entryId);
      setEntryMap(Object.fromEntries(r.entries.map((e) => [e.id, { title: e.title, type: e.type, summary: e.summary }])));
    }).catch(() => {});
  }, [projectId, entryId]);
  useEffect(() => {
    const b = entry?.body as { type?: string } | undefined;
    if (editor && b && b.type === "doc") { editor.commands.setContent(b as object); setSceneIds(mentionIds(editor)); }
  }, [editor, entry]);

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
        <button onClick={ambient.toggle} title="som ambiente">
          {ambient.on ? <IconVolume size={18} /> : <IconVolumeOff size={18} />}
        </button>
        <button onClick={close} title="sair (Esc)"><IconX size={18} /> sair</button>
      </div>
      <div className="focus-page">
        <h1 className="focus-title">{entry?.title ?? ""}</h1>
        <div className="focus-editor"><EditorContent editor={editor} /></div>
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
              <EntryIcon type={e.type} size={16} color={m.color} />
              <div style={{ minWidth: 0 }}>
                <div className="focus-scene-name">{e.title}</div>
                {e.summary && <div className="focus-scene-sum">{e.summary}</div>}
              </div>
            </div>
          );
        })}
      </aside>
    </div>
  );
}
