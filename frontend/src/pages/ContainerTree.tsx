import { useCallback, useEffect, useState } from "react";
import { IconTrash } from "@tabler/icons-react";
import { api } from "../lib/api";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { DND_ENTRY } from "./CanvasView";

interface Membership { containerId: string; memberId: string; }
interface EMeta { title: string; type: string; }

export function ContainerTree({ projectId, onOpen, onFrame, onNew }: { projectId: string; onOpen: (id: string) => void; onFrame: (id: string) => void; onNew?: () => void }) {
  const [emap, setEmap] = useState<Record<string, EMeta>>({});
  const [childrenOf, setChildrenOf] = useState<Record<string, string[]>>({});
  const [roots, setRoots] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    const [es, tree] = await Promise.all([
      api.get<{ entries: { id: string; title: string; type: string }[] }>(`/projects/${projectId}/entries`),
      api.get<{ memberships: Membership[] }>(`/projects/${projectId}/tree`),
    ]);
    const m: Record<string, EMeta> = Object.fromEntries(es.entries.map((e) => [e.id, { title: e.title, type: e.type }]));
    const ch: Record<string, string[]> = {};
    const memberSet = new Set<string>();
    for (const ms of tree.memberships) { (ch[ms.containerId] ??= []).push(ms.memberId); memberSet.add(ms.memberId); }
    setEmap(m);
    setChildrenOf(ch);
    setRoots(es.entries.map((e) => e.id).filter((id) => !memberSet.has(id)));
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const remove = async (id: string) => {
    const t = emap[id]?.title ?? "esta ficha";
    if (!confirm(`Excluir "${t}"? Remove o card do quadro, as relações e menções dela. Não dá pra desfazer.`)) return;
    await api.del(`/entries/${id}`);
    await load();
    window.dispatchEvent(new Event("loregrid:refresh")); // avisa o canvas
  };

  const renderNode = (id: string, depth: number, seen: Set<string>) => {
    const kids = childrenOf[id] ?? [];
    const isContainer = kids.length > 0;
    const open = expanded.has(id);
    const meta = typeMeta(emap[id]?.type ?? "note");
    return (
      <div key={id}>
        <div
          className="row"
          style={{ gap: 3, paddingLeft: depth * 12, minHeight: 24 }}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData(DND_ENTRY, id); e.dataTransfer.effectAllowed = "copy"; }}
          title="arraste para o quadro para plotar"
        >
          {isContainer ? (
            <button onClick={() => toggle(id)} style={{ width: 16, padding: 0, border: "none", background: "transparent", color: "var(--muted)", fontSize: 10 }}>{open ? "▾" : "▸"}</button>
          ) : <span style={{ width: 16 }} />}
          <EntryIcon type={emap[id]?.type ?? "note"} size={15} color={meta.color} />
          <span className="grow" onClick={() => onOpen(id)} title={emap[id]?.title} style={{ cursor: "grab", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {emap[id]?.title ?? "…"}
          </span>
          {isContainer && (
            <button onClick={() => onFrame(id)} title="criar moldura com os membros dentro" style={{ padding: "0 4px", border: "none", background: "transparent", color: "var(--muted)", fontSize: 12 }}>▦</button>
          )}
          <button onClick={() => void remove(id)} title="excluir ficha" style={{ padding: "0 3px", border: "none", background: "transparent", color: "var(--muted)", display: "inline-flex" }}><IconTrash size={13} /></button>
          <span title="arraste para o quadro" style={{ color: "var(--border-strong)", fontSize: 11, cursor: "grab", lineHeight: 1 }}>⠿</span>
        </div>
        {isContainer && open && kids.filter((k) => !seen.has(k)).map((k) => renderNode(k, depth + 1, new Set([...seen, id])))}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <button onClick={() => setCollapsed((c) => !c)} title="recolher" style={{ padding: 0, border: "none", background: "transparent", color: "var(--muted)", fontSize: 10, width: 14 }}>{collapsed ? "▸" : "▾"}</button>
        <span className="muted grow" style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".05em" }}>Contêineres</span>
        <button onClick={load} title="recarregar" style={{ padding: "0 6px", fontSize: 12, border: "none", background: "transparent", color: "var(--muted)" }}>↻</button>
        {onNew && (
          <button onClick={onNew} title="novo card" style={{ padding: "0 6px", fontSize: 16, lineHeight: 1, border: "none", background: "transparent", color: "var(--muted)" }}>+</button>
        )}
      </div>
      {!collapsed && (
        <>
          <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
            {roots.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Sem fichas ainda.</span>}
            {roots.map((id) => renderNode(id, 0, new Set()))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", lineHeight: 1.4 }}>
            Arraste um contêiner pro canvas e os membros vêm junto.
          </div>
        </>
      )}
    </div>
  );
}
