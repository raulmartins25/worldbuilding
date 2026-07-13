import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps, type NodeChange,
} from "@xyflow/react";
import { api } from "../lib/api";
import { ENTRY_TYPES, type Entry, type EntryType } from "../lib/types";

interface BoardNode {
  id: string; entryId: string | null; kind: string;
  x: number; y: number; width: number | null; height: number | null;
}
interface BoardEdge { id: string; sourceNodeId: string; targetNodeId: string; label: string | null; }
interface BoardBundle {
  board: { id: string };
  nodes: BoardNode[];
  edges: BoardEdge[];
}

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
      style={{
        background: "var(--panel-2)", color: "var(--text)",
        border: "1px solid var(--border)", borderRadius: 10,
        padding: "8px 12px", width: 190, boxShadow: "0 2px 8px rgba(0,0,0,.25)",
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{d.etype}</div>
      {editing ? (
        <input
          autoFocus value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          style={{ padding: "2px 4px" }}
        />
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
  const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
  const [newType, setNewType] = useState<EntryType>("character");
  const [newTitle, setNewTitle] = useState("");
  const entryMap = useRef<Record<string, Entry>>({});

  const nodeTypes = useMemo(() => ({ entryCard: EntryCardNode }), []);

  const renameEntry = useCallback((nodeId: string, entryId: string | null, title: string) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, title } } : n)));
    if (entryId) void api.patch(`/entries/${entryId}`, { title });
  }, [setNodes]);

  const toRfNode = useCallback((bn: BoardNode): Node => {
    const entry = bn.entryId ? entryMap.current[bn.entryId] : undefined;
    return {
      id: bn.id,
      type: "entryCard",
      position: { x: bn.x, y: bn.y },
      data: {
        title: entry?.title ?? "(sem entry)",
        etype: entry?.type ?? bn.kind,
        entryId: bn.entryId,
        onRename: renameEntry,
      } satisfies CardData,
    };
  }, [renameEntry]);

  const load = useCallback(async () => {
    const [entriesRes, bundle] = await Promise.all([
      api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries`),
      api.get<BoardBundle>(`/projects/${projectId}/board`),
    ]);
    entryMap.current = Object.fromEntries(entriesRes.entries.map((e) => [e.id, e]));
    setBoardId(bundle.board.id);
    setNodes(bundle.nodes.map(toRfNode));
  }, [projectId, setNodes, toRfNode]);

  useEffect(() => { void load(); }, [load]);

  // persiste posição ao soltar o card
  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    if (!boardId) return;
    void api.patch(`/boards/${boardId}/nodes`, [{ id: node.id, x: node.position.x, y: node.position.y }]);
  }, [boardId]);

  // remove card (node) ao deletar — mantém a entry
  const onNodesDelete = useCallback((deleted: Node[]) => {
    for (const n of deleted) void api.del(`/board-nodes/${n.id}`);
  }, []);

  async function createCard(e: FormEvent) {
    e.preventDefault();
    if (!boardId || !newTitle.trim()) return;
    const x = 40 + Math.random() * 240;
    const y = 40 + Math.random() * 200;
    await api.post(`/boards/${boardId}/cards`, { type: newType, title: newTitle.trim(), x, y });
    setNewTitle("");
    await load();
  }

  const handleNodesChange = useCallback((changes: NodeChange[]) => onNodesChange(changes), [onNodesChange]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <form
        onSubmit={createCard}
        className="row"
        style={{ position: "absolute", top: 12, left: 12, zIndex: 5, background: "var(--panel)", padding: 8, borderRadius: 10, border: "1px solid var(--border)" }}
      >
        <select value={newType} onChange={(e) => setNewType(e.target.value as EntryType)} style={{ width: 150 }}>
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="novo card…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={{ width: 200 }} />
        <button className="primary">+ Card</button>
      </form>

      {nodes.length === 0 && (
        <div className="muted" style={{ position: "absolute", bottom: 16, left: 16, zIndex: 5 }}>
          Canvas vazio — crie um card acima. Duplo-clique edita o título; arraste pra reposicionar (salva sozinho).
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
