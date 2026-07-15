import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { IconX, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { api } from "../lib/api";

interface FullEntry { id: string; title: string; body: unknown; type: string; }

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

export function FocusMode({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [entry, setEntry] = useState<FullEntry | null>(null);
  const editor = useEditor({ extensions: [StarterKit], content: "" });
  const ambient = useAmbient();

  useEffect(() => { api.get<{ entry: FullEntry }>(`/entries/${entryId}`).then((r) => setEntry(r.entry)); }, [entryId]);
  useEffect(() => {
    const b = entry?.body as { type?: string } | undefined;
    if (editor && b && b.type === "doc") editor.commands.setContent(b as object);
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
    </div>
  );
}
