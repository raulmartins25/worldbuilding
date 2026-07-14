import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps, type NodeChange, type Connection,
} from "@xyflow/react";
import { api } from "../lib/api";
import { ENTRY_TYPES, type Entry, type EntryType } from "../lib/types";

interface BoardNode { id: string; entryId: string | null; kind: string; x: number; y: number; }
interface BoardEdge { id: string; sourceNodeId: string; targetNodeId: string; label: string | null; }
interface BoardBundle { board: { id: string }; nodes: BoardNode[]; edges: BoardEdge[]; }
interface Membership { containerId: string; memberId: string; }

const CONTAINS = "⊃ contém";
const REL_TYPES: { t: string; c: string }[] = [
  { t: "aliado_de", c: "#3fb950" },
  { t: "inimigo_de", c: "#f85149" },
  { t: "pai_de", c: "#d29922" },
  { t: "mae_de", c: "#db61a2" },
  { t: "casado_com", c: "#a371f7" },
  { t: "governa", c: "#58a6ff" },
  { t: "pertence_a", c: "#8b949e" },
  { t: "aparece_em", c: "#39c5cf" },
  { t: "(visual)", c: "#6e7681" },
];
const REL_COLORS: Record<string, string> = Object.fromEntries(REL_TYPES.map((r) => [r.t, r.c]));
const edgeColor = (label: string | null | undefined) => REL_COLORS[label ?? ""] ?? "#6e7681";

type CardData = { title: string; etype: string; entryId: string | null; onRename: (nodeId: string, entryId: string | null, title: string) => void };

function EntryCardNode({ id, data }: NodeProps) {
  const d = data as CardData;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(d.title);
  useEffect(() => setVal(d.title), [d.title]);
  const commit = () => {
    setEditing(false);
    if (val.trim() && val !== d.title) d.onRename(id, d.entryId, val.trim());
  };
  return (
    <div
      onDoubleClick={() => setEditing(true)}
      style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", width: 190, boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{d.etype}</div>
      {editing ? (
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} style={{ padding: "2px 4px" }} />
      ) : (
        <strong style={{ display: "block", lineHeight: 1.2 }}>{d.title}</strong>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function CanvasView({ projectId }: { projectId: string }) {
  const [boardId, setBoardId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [newType, setNewType] = useState<EntryType>("character");
  const [newTitle, setNewTitle] = useState("");
  const [pending, setPending] = useState<{ source: string; target: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const entryMap = useRef<Record<string, Entry>>({});
  const membersRef = useRef<Record<string, string[]>>({}); // containerEntryId -> memberEntryIds
  const nodesRef = useRef<Node[]>([]);
  const dragRef = useRef<{ last: { x: number; y: number }; moved: Set<string> } | null>(null);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const nodeTypes = useMemo(() => ({ entryCard: EntryCardNode }), []);

  const renameEntry = useCallback((nodeId: string, entryId: string | null, title: string) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, title } } : n)));
    if (entryId) void api.patch(`/entries/${entryId}`, { title });
  }, [setNodes]);

  const toRfNode = useCallback((bn: BoardNode): Node => {
    const entry = bn.entryId ? entryMap.current[bn.entryId] : undefined;
    return {
      id: bn.id, type: "entryCard", position: { x: bn.x, y: bn.y },
      data: { title: entry?.title ?? "(sem entry)", etype: entry?.type ?? bn.kind, entryId: bn.entryId, onRename: renameEntry } satisfies CardData,
    };
  }, [renameEntry]);

  const toRfEdge = (be: BoardEdge): Edge => ({
    id: be.id, source: be.sourceNodeId, target: be.targetNodeId, label: be.label ?? undefined,
    style: { stroke: edgeColor(be.label), strokeWidth: 2 },
    labelStyle: { fill: "var(--text)", fontSize: 11 }, labelBgStyle: { fill: "var(--panel)" },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(be.label) },
  });

  const load = useCallback(async () => {
    const [entriesRes, bundle, tree] = await Promise.all([
      api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries`),
      api.get<BoardBundle>(`/projects/${projectId}/board`),
      api.get<{ memberships: Membership[] }>(`/projects/${projectId}/tree`),
    ]);
    entryMap.current = Object.fromEntries(entriesRes.entries.map((e) => [e.id, e]));
    const m: Record<string, string[]> = {};
    for (const ms of tree.memberships) (m[ms.containerId] ??= []).push(ms.memberId);
    membersRef.current = m;
    setBoardId(bundle.board.id);
    setNodes(bundle.nodes.map(toRfNode));
    setEdges(bundle.edges.map(toRfEdge));
  }, [projectId, setNodes, setEdges, toRfNode]);

  useEffect(() => { void load(); }, [load]);

  // node ids (no board) de todos os membros (transitivo) de um entry contêiner
  const descendantNodeIds = (containerEntryId: string): string[] => {
    const entryToNode: Record<string, string> = {};
    for (const n of nodesRef.current) {
      const e = (n.data as CardData).entryId;
      if (e) entryToNode[e] = n.id;
    }
    const out: string[] = [];
    const seen = new Set<string>([containerEntryId]);
    const queue = [...(membersRef.current[containerEntryId] ?? [])];
    while (queue.length) {
      const eid = queue.shift()!;
      if (seen.has(eid)) continue;
      seen.add(eid);
      if (entryToNode[eid]) out.push(entryToNode[eid]);
      for (const child of membersRef.current[eid] ?? []) queue.push(child);
    }
    return out;
  };

  const onNodeDragStart = useCallback((_e: unknown, node: Node) => {
    dragRef.current = { last: { ...node.position }, moved: new Set() };
  }, []);

  const onNodeDrag = useCallback((_e: unknown, node: Node) => {
    const drag = dragRef.current;
    if (!drag) return;
    const entryId = (node.data as CardData).entryId;
    if (!entryId) return;
    const memberNodeIds = descendantNodeIds(entryId);
    if (memberNodeIds.length === 0) return;
    const dx = node.position.x - drag.last.x;
    const dy = node.position.y - drag.last.y;
    drag.last = { ...node.position };
    if (dx === 0 && dy === 0) return;
    const idSet = new Set(memberNodeIds);
    memberNodeIds.forEach((id) => drag.moved.add(id));
    setNodes((ns) => ns.map((n) => (idSet.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)));
  }, [setNodes]);

  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!boardId) return;
    setNodes((ns) => {
      const batch: { id: string; x: number; y: number }[] = [{ id: node.id, x: node.position.x, y: node.position.y }];
      if (drag) {
        drag.moved.forEach((id) => {
          const m = ns.find((n) => n.id === id);
          if (m) batch.push({ id, x: m.position.x, y: m.position.y });
        });
      }
      void api.patch(`/boards/${boardId}/nodes`, batch);
      return ns;
    });
  }, [boardId, setNodes]);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    for (const n of deleted) void api.del(`/board-nodes/${n.id}`);
  }, []);
  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const e of deleted) void api.del(`/board-edges/${e.id}`);
  }, []);
  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target && c.source !== c.target) setPending({ source: c.source, target: c.target });
  }, []);

  const nodeEntryId = (nodeId: string) => (nodesRef.current.find((n) => n.id === nodeId)?.data as CardData | undefined)?.entryId ?? null;

  const confirmConn = async (type: string) => {
    const p = pending;
    setPending(null);
    if (!p || !boardId) return;
    if (type === CONTAINS) {
      const src = nodeEntryId(p.source);
      const tgt = nodeEntryId(p.target);
      if (src && tgt) await api.post(`/projects/${projectId}/memberships`, { containerId: src, memberId: tgt });
    } else {
      const isVisual = type === "(visual)";
      await api.post(`/boards/${boardId}/edges`, {
        sourceNodeId: p.source, targetNodeId: p.target,
        relationshipType: isVisual ? undefined : type,
        label: isVisual ? undefined : type, style: { stroke: edgeColor(type) },
      });
    }
    await load();
  };

  async function createCard(e: FormEvent) {
    e.preventDefault();
    if (!boardId || !newTitle.trim()) return;
    await api.post(`/boards/${boardId}/cards`, { type: newType, title: newTitle.trim(), x: 40 + Math.random() * 240, y: 40 + Math.random() * 200 });
    setNewTitle("");
    await load();
  }

  async function expandSelected() {
    if (!boardId || !selected) return;
    await api.post(`/boards/${boardId}/expand-container`, { containerNodeId: selected });
    await load();
  }

  const handleNodesChange = useCallback((changes: NodeChange[]) => onNodesChange(changes), [onNodesChange]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div className="row" style={{ position: "absolute", top: 12, left: 12, zIndex: 5, background: "var(--panel)", padding: 8, borderRadius: 10, border: "1px solid var(--border)" }}>
        <form className="row" onSubmit={createCard}>
          <select value={newType} onChange={(e) => setNewType(e.target.value as EntryType)} style={{ width: 140 }}>
            {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="novo card…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={{ width: 180 }} />
          <button className="primary">+ Card</button>
        </form>
        <button onClick={expandSelected} disabled={!selected} title="plota os membros do card selecionado">Expandir membros</button>
      </div>

      {pending && (
        <div style={{ position: "absolute", top: 12, right: 12, zIndex: 6, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, width: 230 }}>
          <div className="muted" style={{ marginBottom: 6, fontSize: 13 }}>Conexão:</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {REL_TYPES.map((r) => (
              <button key={r.t} onClick={() => confirmConn(r.t)} style={{ borderLeft: `4px solid ${r.c}` }}>{r.t}</button>
            ))}
          </div>
          <button onClick={() => confirmConn(CONTAINS)} style={{ marginTop: 8, width: "100%", borderLeft: "4px solid var(--accent)" }}>{CONTAINS} (membership)</button>
          <button onClick={() => setPending(null)} style={{ marginTop: 6, width: "100%" }}>cancelar</button>
        </div>
      )}

      {nodes.length === 0 && (
        <div className="muted" style={{ position: "absolute", bottom: 16, left: 16, zIndex: 5 }}>
          Canvas vazio — crie um card. Conecte arrastando de um card a outro; "{CONTAINS}" cria contenção (arrastar o contêiner move os membros).
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onNodeClick={(_e, n) => setSelected(n.id)}
        onPaneClick={() => setSelected(null)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
