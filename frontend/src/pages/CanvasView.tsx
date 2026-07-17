import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps, type NodeChange, type Connection, type ReactFlowInstance,
} from "@xyflow/react";
import { api } from "../lib/api";
import { type Entry } from "../lib/types";
import { typeMeta, relLabel } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { NewCardModal, type NewCardData } from "./NewCardModal";
import { useSearchParams } from "react-router-dom";
import { useTheme, canvasDot } from "../lib/theme";
import { EntryDrawer } from "./EntryDrawer";
import { MapView } from "./MapView";
import { TimelineView } from "./TimelineView";

export type Lens = "quadro" | "grafo" | "mapa" | "linha";

interface BoardNode { id: string; entryId: string | null; kind: string; x: number; y: number; }
interface BoardEdge { id: string; sourceNodeId: string; targetNodeId: string; label: string | null; }
interface BoardBundle { board: { id: string }; nodes: BoardNode[]; edges: BoardEdge[]; }
interface Membership { containerId: string; memberId: string; }
interface GNode { id: string; title: string; type: string; }
interface GEdge { id: string; sourceId: string; targetId: string; type: string; label: string | null; }

// force-layout compartilhado com a lente Grafo (mesmos nós do quadro, re-arranjados pelas relações)
function forceLayout(ids: string[], edges: GEdge[]): Record<string, { x: number; y: number }> {
  if (ids.length === 0) return {};
  const n = ids.length;
  // área cresce com o nº de nós → não amontoa quando o mundo é grande
  const side = Math.max(560, Math.round(190 * Math.sqrt(n)));
  const W = side, H = side;
  const k = Math.sqrt((W * H) / n) * 0.9;
  const idx: Record<string, number> = Object.fromEntries(ids.map((id, i) => [id, i]));
  const pos: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const a = (i / n) * 2 * Math.PI;
    pos[id] = { x: W / 2 + Math.cos(a) * side * 0.36 + Math.random() * 8, y: H / 2 + Math.sin(a) * side * 0.36 + Math.random() * 8 };
  });
  let temp = W / 10;
  for (let it = 0; it < 300; it++) {
    const disp = ids.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = pos[ids[i]].x - pos[ids[j]].x, dy = pos[ids[i]].y - pos[ids[j]].y;
      const d = Math.hypot(dx, dy) || 0.01, f = (k * k) / d;
      dx = (dx / d) * f; dy = (dy / d) * f;
      disp[i].x += dx; disp[i].y += dy; disp[j].x -= dx; disp[j].y -= dy;
    }
    for (const e of edges) {
      const a = idx[e.sourceId], b = idx[e.targetId];
      if (a == null || b == null) continue;
      let dx = pos[ids[a]].x - pos[ids[b]].x, dy = pos[ids[a]].y - pos[ids[b]].y;
      const d = Math.hypot(dx, dy) || 0.01, f = (d * d) / k;
      dx = (dx / d) * f; dy = (dy / d) * f;
      disp[a].x -= dx; disp[a].y -= dy; disp[b].x += dx; disp[b].y += dy;
    }
    for (let i = 0; i < n; i++) {
      disp[i].x += (W / 2 - pos[ids[i]].x) * 0.12;
      disp[i].y += (H / 2 - pos[ids[i]].y) * 0.12;
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01, lim = Math.min(d, temp);
      pos[ids[i]].x += (disp[i].x / d) * lim; pos[ids[i]].y += (disp[i].y / d) * lim;
    }
    temp *= 0.97;
  }
  // separação final: evita que os cards (~210px) se sobreponham
  const MIN = 220;
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = pos[ids[i]].x - pos[ids[j]].x, dy = pos[ids[i]].y - pos[ids[j]].y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < MIN) {
        const push = (MIN - d) / 2;
        dx = (dx / d) * push; dy = (dy / d) * push;
        pos[ids[i]].x += dx; pos[ids[i]].y += dy; pos[ids[j]].x -= dx; pos[ids[j]].y -= dy;
      }
    }
  }
  return pos;
}

const CONTAINS = "__contem__";
export const DND_ENTRY = "application/loregrid-entry"; // MIME do arrastar ficha (árvore → quadro)
const REL_TYPES = ["aliado_de", "inimigo_de", "pai_de", "mae_de", "casado_com", "governa", "pertence_a", "aparece_em"];
const REL_COLORS: Record<string, string> = {
  aliado_de: "#3fb950", inimigo_de: "#f85149", pai_de: "#d29922", mae_de: "#db61a2",
  casado_com: "#a371f7", governa: "#58a6ff", pertence_a: "#8b949e", aparece_em: "#39c5cf",
};
const edgeColor = (label: string | null | undefined) => REL_COLORS[label ?? ""] ?? "#6e7681";

type CardData = {
  title: string; etype: string; entryId: string | null;
  importance: number; status: string; aiFlag: boolean;
  onRename: (nodeId: string, entryId: string | null, title: string) => void;
  onOpen: (entryId: string) => void;
};

function EntryCardNode({ id, data }: NodeProps) {
  const d = data as CardData;
  const meta = typeMeta(d.etype);
  const proto = d.importance >= 4;                        // protagonista
  const support = d.importance >= 2 && d.importance < 4;  // coadjuvante
  const width = proto ? 244 : support ? 204 : 172;
  const borderW = proto ? 2 : 1;
  const dashed = d.status === "draft";                    // rascunho = tracejado
  const faded = d.status === "archived";                  // esmaecido
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
        background: meta.tint, color: meta.ink,
        border: `${borderW}px ${dashed ? "dashed" : "solid"} ${meta.color}`,
        borderRadius: 12, width, padding: proto ? "12px 14px" : "9px 11px",
        opacity: faded ? 0.55 : 1,
        boxShadow: proto ? `0 8px 20px ${meta.color}2b` : "0 1px 3px rgba(20,24,40,.10)",
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: meta.color, width: 8, height: 8 }} />
      {d.aiFlag && (
        <span
          title="Inconsistência detectada — veja a central de IA"
          style={{ position: "absolute", top: 5, left: 6, width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: "10px solid var(--warn)" }}
        />
      )}
      {d.entryId && (
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); d.onOpen(d.entryId!); }}
          title="abrir editor"
          style={{ position: "absolute", top: 4, right: 4, padding: "0 5px", fontSize: 13, lineHeight: "18px", background: "transparent", border: "none", color: meta.ink }}
        >⤢</button>
      )}
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <EntryIcon type={d.etype} size={proto ? 30 : 24} color={meta.color} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, color: meta.color, fontWeight: 500 }}>{meta.label}</div>
          {editing ? (
            <input
              autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
              style={{ padding: "2px 4px" }}
            />
          ) : (
            <strong style={{ display: "block", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", fontWeight: proto ? 500 : 400, fontSize: proto ? 15 : 14, color: meta.ink }}>{d.title}</strong>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: meta.color, width: 8, height: 8 }} />
    </div>
  );
}

export function CanvasView({ projectId, projectName, lens, onLens }: { projectId: string; projectName: string; lens: Lens; onLens: (l: Lens) => void }) {
  const [boardId, setBoardId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [gNodes, setGNodes, onGNodesChange] = useNodesState<Node>([]);
  const [gEdges, setGEdges, onGEdgesChange] = useEdgesState<Edge>([]);
  const [pending, setPending] = useState<{ source: string; target: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: GNode[]; edges: GEdge[] }>({ nodes: [], edges: [] });
  const [rfi, setRfi] = useState<ReactFlowInstance | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();

  // abre o drawer quando a command palette navega com ?open=<id>
  useEffect(() => {
    const o = searchParams.get("open");
    if (o) {
      setOpenId(o);
      searchParams.delete("open");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // plota um contêiner + membros no quadro (?plot=<entryId> vindo da sidebar)
  const boardIdRef = useRef<string | null>(null);
  useEffect(() => { boardIdRef.current = boardId; }, [boardId]);
  useEffect(() => {
    const plotId = searchParams.get("plot");
    const bid = boardIdRef.current;
    if (!plotId || !bid) return;
    void (async () => {
      let nodeId = nodesRef.current.find((n) => (n.data as CardData).entryId === plotId)?.id;
      if (!nodeId) {
        const r = await api.post<{ node: { id: string } }>(`/boards/${bid}/nodes`, { entryId: plotId, x: 60, y: 60 });
        nodeId = r.node.id;
      }
      await api.post(`/boards/${bid}/expand-container`, { containerNodeId: nodeId }).catch(() => {});
      searchParams.delete("plot");
      setSearchParams(searchParams, { replace: true });
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, boardId]);

  const entryMap = useRef<Record<string, Entry>>({});
  const membersRef = useRef<Record<string, string[]>>({});
  const aiFlagsRef = useRef<Set<string>>(new Set());
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
      data: {
        title: entry?.title ?? "(sem ficha)", etype: entry?.type ?? bn.kind, entryId: bn.entryId,
        importance: entry?.importance ?? 0, status: entry?.status ?? "draft",
        aiFlag: bn.entryId ? aiFlagsRef.current.has(bn.entryId) : false,
        onRename: renameEntry, onOpen: setOpenId,
      } satisfies CardData,
    };
  }, [renameEntry]);

  const toRfEdge = (be: BoardEdge): Edge => ({
    id: be.id, source: be.sourceNodeId, target: be.targetNodeId, label: relLabel(be.label) || undefined,
    style: { stroke: edgeColor(be.label), strokeWidth: 2 },
    labelStyle: { fill: "var(--text)", fontSize: 11 }, labelBgStyle: { fill: "var(--panel)" },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(be.label) },
  });

  // lente Grafo: mesmos cards do quadro, re-arranjados pelas relações (camada sobre o mesmo canvas)
  const renameInGraph = useCallback((nodeId: string, entryId: string | null, title: string) => {
    setGNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, title } } : n)));
    if (entryId) void api.patch(`/entries/${entryId}`, { title });
  }, [setGNodes]);

  const buildGraph = useCallback(() => {
    const g = graphData;
    const pos = forceLayout(g.nodes.map((n) => n.id), g.edges);
    setGNodes(g.nodes.map((n) => {
      const e = entryMap.current[n.id];
      return {
        id: n.id, type: "entryCard", position: pos[n.id] ?? { x: 0, y: 0 },
        data: {
          title: n.title, etype: n.type, entryId: n.id,
          importance: e?.importance ?? 0, status: e?.status ?? "draft",
          aiFlag: aiFlagsRef.current.has(n.id),
          onRename: renameInGraph, onOpen: setOpenId,
        } satisfies CardData,
      };
    }));
    setGEdges(g.edges.map((e) => ({
      id: e.id, source: e.sourceId, target: e.targetId, label: relLabel(e.type) || undefined,
      style: { stroke: edgeColor(e.type), strokeWidth: 2 },
      labelStyle: { fill: "var(--text)", fontSize: 11 }, labelBgStyle: { fill: "var(--panel)" },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(e.type) },
    })));
  }, [graphData, setGNodes, setGEdges, renameInGraph]);

  // reconstrói ao entrar na lente Grafo (ou quando os dados do grafo mudam estando nela)
  useEffect(() => { if (lens === "grafo") buildGraph(); }, [lens, buildGraph]);

  const load = useCallback(async () => {
    const [entriesRes, bundle, tree, graph] = await Promise.all([
      api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries`),
      api.get<BoardBundle>(`/projects/${projectId}/board`),
      api.get<{ memberships: Membership[] }>(`/projects/${projectId}/tree`),
      api.get<{ nodes: GNode[]; edges: GEdge[] }>(`/projects/${projectId}/graph`).catch(() => ({ nodes: [], edges: [] })),
    ]);
    entryMap.current = Object.fromEntries(entriesRes.entries.map((e) => [e.id, e]));
    const m: Record<string, string[]> = {};
    for (const ms of tree.memberships) (m[ms.containerId] ??= []).push(ms.memberId);
    membersRef.current = m;
    // marcador da IA: fichas com apontamentos abertos (contradição/lacuna)
    try {
      const ck = await api.get<{ checks: { entryId: string | null; kind: string }[] }>(`/projects/${projectId}/ai/checks?status=open`);
      aiFlagsRef.current = new Set(ck.checks.filter((c) => c.entryId && (c.kind === "inconsistency" || c.kind === "gap")).map((c) => c.entryId!));
    } catch { aiFlagsRef.current = new Set(); }
    setBoardId(bundle.board.id);
    setNodes(bundle.nodes.map(toRfNode));
    setEdges(bundle.edges.map(toRfEdge));
    setGraphData(graph);
  }, [projectId, setNodes, setEdges, toRfNode]);

  useEffect(() => { void load(); }, [load]);

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
      if (drag) drag.moved.forEach((id) => {
        const m = ns.find((n) => n.id === id);
        if (m) batch.push({ id, x: m.position.x, y: m.position.y });
      });
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
      const isVisual = type === "visual";
      await api.post(`/boards/${boardId}/edges`, {
        sourceNodeId: p.source, targetNodeId: p.target,
        relationshipType: isVisual ? undefined : type,
        label: isVisual ? undefined : type, style: { stroke: edgeColor(type) },
      });
    }
    await load();
  };

  const submitNewCard = async (d: NewCardData) => {
    if (!boardId) return;
    await api.post(`/boards/${boardId}/cards`, { ...d, x: 40 + Math.random() * 240, y: 40 + Math.random() * 200 });
    setNewOpen(false);
    await load();
  };

  async function expandSelected() {
    if (!boardId || !selected) return;
    await api.post(`/boards/${boardId}/expand-container`, { containerNodeId: selected });
    await load();
  }

  const handleNodesChange = useCallback((changes: NodeChange[]) => onNodesChange(changes), [onNodesChange]);

  // arrastar ficha da árvore (sidebar) e soltar no quadro → plota o card (+ membros se contêiner) na posição do drop
  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(DND_ENTRY)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  }, []);
  const onDrop = useCallback((e: DragEvent) => {
    if (lens !== "quadro") return;
    const entryId = e.dataTransfer.getData(DND_ENTRY);
    const bid = boardIdRef.current;
    if (!entryId || !bid) return;
    e.preventDefault();
    const pos = rfi ? rfi.screenToFlowPosition({ x: e.clientX, y: e.clientY }) : { x: 80, y: 80 };
    void (async () => {
      let nodeId = nodesRef.current.find((n) => (n.data as CardData).entryId === entryId)?.id;
      if (!nodeId) {
        const r = await api.post<{ node: { id: string } }>(`/boards/${bid}/nodes`, { entryId, x: pos.x, y: pos.y });
        nodeId = r.node.id;
      }
      await api.post(`/boards/${bid}/expand-container`, { containerNodeId: nodeId }).catch(() => {});
      await load();
    })();
  }, [lens, rfi, load]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }} onDrop={onDrop} onDragOver={onDragOver}>
      {/* seletor de lente do canvas — Quadro↔Grafo compartilham o React Flow (mesmos nós, outra lente) */}
      {(lens === "quadro" || lens === "grafo") && (
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 7, display: "flex", gap: 2, background: "var(--panel)", padding: 4, borderRadius: 999, border: "1px solid var(--border)", boxShadow: "0 2px 8px rgba(20,24,40,.10)" }}>
          {([["quadro", "Quadro"], ["grafo", "Grafo"]] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => onLens(k)}
              className={lens === k ? "primary" : ""}
              style={{ borderRadius: 999, padding: "4px 16px", fontSize: 13, border: "none", background: lens === k ? undefined : "transparent" }}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}

      {lens === "quadro" && (
        <div className="row" style={{ position: "absolute", top: 12, left: 12, zIndex: 5, background: "var(--panel)", padding: 8, borderRadius: 10, border: "1px solid var(--border)" }}>
          <button className="primary" onClick={() => setNewOpen(true)}>+ Novo card</button>
          <button onClick={expandSelected} disabled={!selected} title="plota os membros do card selecionado">Expandir membros</button>
        </div>
      )}

      {pending && (
        <div style={{ position: "absolute", top: 12, right: 12, zIndex: 6, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, width: 240 }}>
          <div className="muted" style={{ marginBottom: 6, fontSize: 13 }}>Tipo da conexão:</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {REL_TYPES.map((t) => (
              <button key={t} onClick={() => confirmConn(t)} style={{ borderLeft: `4px solid ${REL_COLORS[t]}`, fontSize: 12 }}>{relLabel(t)}</button>
            ))}
            <button onClick={() => confirmConn("visual")} style={{ borderLeft: "4px solid #6e7681", fontSize: 12 }}>Visual</button>
          </div>
          <button onClick={() => confirmConn(CONTAINS)} style={{ marginTop: 8, width: "100%", borderLeft: "4px solid var(--accent)" }}>⊃ Contém (membro)</button>
          <button onClick={() => setPending(null)} style={{ marginTop: 6, width: "100%" }}>cancelar</button>
        </div>
      )}

      {lens === "quadro" && nodes.length === 0 && (
        <div className="muted" style={{ position: "absolute", bottom: 16, left: 16, zIndex: 5 }}>
          Quadro vazio — crie um card. Conecte arrastando de um card a outro; "Contém" cria contenção (arrastar o contêiner move os membros).
        </div>
      )}

      {/* camada da lente ativa — remonta ao trocar (key) → transição suave (.lens-fade, respeita reduce-motion) */}
      <div key={lens} className="lens-fade" style={{ position: "absolute", inset: 0, zIndex: 1 }}>
        {lens === "quadro" && (
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
            onNodesDelete={onNodesDelete} onEdgesDelete={onEdgesDelete} onConnect={onConnect}
            onNodeClick={(_e, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)}
            onInit={setRfi}
            fitView
          >
            <Background color={canvasDot(theme)} gap={22} />
            <Controls />
            <MiniMap
              pannable zoomable
              nodeColor={(n) => typeMeta((n.data as CardData).etype).color}
              nodeStrokeWidth={2}
              style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
            />
          </ReactFlow>
        )}

        {lens === "grafo" && (
          <>
            <ReactFlow
              nodes={gNodes} edges={gEdges} nodeTypes={nodeTypes}
              onNodesChange={onGNodesChange} onEdgesChange={onGEdgesChange}
              fitView minZoom={0.1}
            >
              <Background color={canvasDot(theme)} gap={22} />
              <Controls />
              <MiniMap
                pannable zoomable
                nodeColor={(n) => typeMeta((n.data as CardData).etype).color}
                nodeStrokeWidth={2}
                style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
              />
            </ReactFlow>
            {gNodes.length === 0 && (
              <div className="muted" style={{ position: "absolute", bottom: 16, left: 16, zIndex: 5 }}>
                Sem relações ainda — conecte cards no Quadro (arraste de um a outro) para vê-los ligados aqui.
              </div>
            )}
          </>
        )}

        {lens === "mapa" && <MapView projectId={projectId} />}
        {lens === "linha" && <TimelineView projectId={projectId} />}
      </div>

      {openId && (
        <EntryDrawer key={openId} entryId={openId} projectId={projectId} onClose={() => { setOpenId(null); void load(); }} />
      )}
      {newOpen && (
        <NewCardModal projectId={projectId} projectName={projectName} onClose={() => setNewOpen(false)} onSubmit={submitNewCard} />
      )}
    </div>
  );
}
