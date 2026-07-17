import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { IconSearch } from "@tabler/icons-react";
import { api } from "../lib/api";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import type { Entry } from "../lib/types";
import type { Lens } from "./CanvasView";

interface Cmd { id: string; label: string; hint?: string; icon?: ReactNode; run: () => void | Promise<void>; }

export function CommandPalette({ open, onClose, projectId, onLens }: { open: boolean; onClose: () => void; projectId: string; onLens: (l: Lens) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSel(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries`).then((r) => setEntries(r.entries)).catch(() => {});
  }, [open, projectId]);

  const go = (seg: string) => { navigate(`/worlds/${projectId}${seg ? "/" + seg : ""}`); onClose(); };
  const goLens = (l: Lens) => { onLens(l); onClose(); };

  const commands: Cmd[] = useMemo(() => {
    const lenses: Cmd[] = [
      { id: "l-quadro", label: "Ir para o Quadro", hint: "lente", run: () => goLens("quadro") },
      { id: "l-grafo", label: "Ir para o Grafo", hint: "lente", run: () => goLens("grafo") },
      { id: "l-mapa", label: "Ir para o Mapa", hint: "lente", run: () => goLens("mapa") },
      { id: "l-timeline", label: "Ir para a Linha do tempo", hint: "lente", run: () => goLens("linha") },
      { id: "l-fichas", label: "Ir para Fichas", run: () => go("entries") },
      { id: "l-ia", label: "Ir para a Central de IA", run: () => go("ia") },
    ];
    const actions: Cmd[] = [
      { id: "a-new", label: "Nova ficha no Quadro", hint: "criar", run: () => goLens("quadro") },
      {
        id: "a-check", label: "Checar consistência (IA)", hint: "IA",
        run: async () => { onClose(); await api.post(`/projects/${projectId}/ai/check`).catch(() => {}); navigate(`/worlds/${projectId}/ia`); },
      },
    ];
    const ents: Cmd[] = entries.map((e) => ({
      id: "e-" + e.id, label: e.title, hint: typeMeta(e.type).label,
      icon: <EntryIcon type={e.type} size={16} color={typeMeta(e.type).color} />,
      run: () => { navigate(`/worlds/${projectId}?open=${e.id}`); onClose(); },
    }));
    return [...actions, ...lenses, ...ents];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, projectId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands.slice(0, 40);
    return commands.filter((c) => c.label.toLowerCase().includes(s) || c.hint?.toLowerCase().includes(s)).slice(0, 40);
  }, [q, commands]);

  useEffect(() => { setSel(0); }, [q]);
  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); void filtered[sel]?.run(); }
  };

  return (
    <div onClick={onClose} className="modal-backdrop" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(15,18,30,.35)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh" }}>
      <div onClick={(e) => e.stopPropagation()} onKeyDown={onKey} className="modal-sheet" style={{ width: 560, maxWidth: "92vw", background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 40px rgba(20,24,40,.25)", overflow: "hidden" }}>
        <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 8 }}>
          <IconSearch size={18} color="var(--muted)" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Buscar fichas, lentes, ações…" style={{ border: "none", padding: 0 }} />
          <span className="muted" style={{ fontSize: 11 }}>Esc</span>
        </div>
        <div style={{ maxHeight: "50vh", overflow: "auto", padding: 6 }}>
          {filtered.length === 0 && <div className="muted" style={{ padding: 12, fontSize: 13 }}>Nada encontrado.</div>}
          {filtered.map((c, i) => (
            <div key={c.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => void c.run()}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: i === sel ? "var(--panel-2)" : "transparent" }}>
              {c.icon ?? <span style={{ width: 16 }} />}
              <span className="grow" style={{ fontSize: 14 }}>{c.label}</span>
              {c.hint && <span className="muted" style={{ fontSize: 12 }}>{c.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
