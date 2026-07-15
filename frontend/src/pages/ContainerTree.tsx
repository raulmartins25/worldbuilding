import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";

interface Membership { containerId: string; memberId: string; }
interface EMeta { title: string; type: string; }

export function ContainerTree({ projectId, onOpen, onPlot }: { projectId: string; onOpen: (id: string) => void; onPlot: (id: string) => void }) {
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

  const renderNode = (id: string, depth: number, seen: Set<string>) => {
    const kids = childrenOf[id] ?? [];
    const isContainer = kids.length > 0;
    const open = expanded.has(id);
    const meta = typeMeta(emap[id]?.type ?? "note");
    return (
      <div key={id}>
        <div className="row" style={{ gap: 3, paddingLeft: depth * 12, minHeight: 24 }}>
          {isContainer ? (
            <button onClick={() => toggle(id)} style={{ width: 16, padding: 0, border: "none", background: "transparent", color: "var(--muted)", fontSize: 10 }}>{open ? "▾" : "▸"}</button>
          ) : <span style={{ width: 16 }} />}
          <EntryIcon type={emap[id]?.type ?? "note"} size={15} color={meta.color} />
          <span className="grow" onClick={() => onOpen(id)} title={emap[id]?.title} style={{ cursor: "pointer", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {emap[id]?.title ?? "…"}
          </span>
          {isContainer && (
            <button onClick={() => onPlot(id)} title="plotar no quadro" style={{ padding: "0 4px", border: "none", background: "transparent", color: "var(--muted)", fontSize: 12 }}>▦</button>
          )}
        </div>
        {isContainer && open && kids.filter((k) => !seen.has(k)).map((k) => renderNode(k, depth + 1, new Set([...seen, id])))}
      </div>
    );
  };

  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 8 }}>
      <div className="row">
        <button onClick={() => setCollapsed((c) => !c)} title="recolher" style={{ padding: 0, border: "none", background: "transparent", color: "var(--muted)", fontSize: 10, width: 14 }}>{collapsed ? "▸" : "▾"}</button>
        <span className="muted grow" style={{ fontSize: 12, fontWeight: 500 }}>Contêineres</span>
        <button onClick={load} title="recarregar" style={{ padding: "0 6px", fontSize: 12 }}>↻</button>
      </div>
      {!collapsed && (
        <div style={{ maxHeight: "42vh", overflow: "auto", marginTop: 4 }}>
          {roots.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Sem fichas ainda.</span>}
          {roots.map((id) => renderNode(id, 0, new Set()))}
        </div>
      )}
    </div>
  );
}
