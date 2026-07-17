import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, NodeResizer,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps, type NodeChange, type Connection, type ReactFlowInstance,
} from "@xyflow/react";
import { api } from "../lib/api";
import { type Entry } from "../lib/types";
import { typeMeta, relLabel } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { IconSparkles, IconArrowUpRight } from "@tabler/icons-react";
import { NewCardModal, type NewCardData } from "./NewCardModal";
import { useSearchParams } from "react-router-dom";
import { useTheme, canvasDot } from "../lib/theme";
import { EntryDrawer } from "./EntryDrawer";
import { MapView } from "./MapView";
import { TimelineView } from "./TimelineView";

export type Lens = "quadro" | "grafo" | "mapa" | "linha";

interface BoardNode { id: string; entryId: string | null; kind: string; x: number; y: number; width: number | null; height: number | null; style: Record<string, unknown>; }
interface BoardEdge { id: string; sourceNodeId: string; targetNodeId: string; label: string | null; }
interface BoardBundle { board: { id: string }; nodes: BoardNode[]; edges: BoardEdge[]; }
interface Membership { containerId: string; memberId: string; }
interface Check { id: string; kind: string; title: string; detail: string | null; entryId: string | null; }
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

const PEOPLE = ["character", "creature", "deity"];
const STATUS_LABEL: Record<string, string> = { draft: "rascunho", canon: "canônico", archived: "arquivado" };

// "Protagonista · canônico" — papel pelo peso na história + estado da ficha
function roleLine(d: { etype: string; importance: number; status: string }): string {
  let role = typeMeta(d.etype).label.toLowerCase();
  if (PEOPLE.includes(d.etype)) {
    if (d.importance >= 4) role = "protagonista";
    else if (d.importance >= 2) role = "coadjuvante";
    else role = "figurante";
  }
  const st = STATUS_LABEL[d.status];
  return st ? `${role} · ${st}` : role;
}

// iniciais para gente (RS, KE); os demais tipos usam o ícone
const initials = (t: string) => t.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const FRAME_COLOR = "#8891a7";

type FrameData = {
  label: string; color: string;
  onRename: (id: string, label: string) => void;
  onResize: (id: string, p: { x: number; y: number; width: number; height: number }) => void;
};

// moldura: região titulada que agrupa cards. Arrastar a moldura leva os cards sobre ela.
function FrameNode({ id, data, selected }: NodeProps) {
  const d = data as FrameData;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(d.label);
  useEffect(() => setVal(d.label), [d.label]);
  const commit = () => { setEditing(false); if (val.trim() && val !== d.label) d.onRename(id, val.trim()); };
  return (
    <>
      <NodeResizer color={d.color} isVisible={!!selected} minWidth={200} minHeight={140}
        onResizeEnd={(_e, p) => d.onResize(id, { x: p.x, y: p.y, width: p.width, height: p.height })} />
      <div style={{ width: "100%", height: "100%", borderRadius: 14, border: `1.5px solid ${d.color}`, background: `color-mix(in srgb, ${d.color} 7%, transparent)`, boxSizing: "border-box" }}>
        <div className="nodrag" onDoubleClick={() => setEditing(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 8, padding: "3px 10px", borderRadius: 8, background: `color-mix(in srgb, ${d.color} 18%, var(--panel))`, color: d.color, fontSize: 13, fontWeight: 500, cursor: "text" }}>
          {editing ? (
            <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
              style={{ padding: "0 2px", fontSize: 13, width: 150 }} />
          ) : (<>▦ {d.label}</>)}
        </div>
      </div>
    </>
  );
}

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
        <span
          style={{
            flexShrink: 0, width: proto ? 34 : 28, height: proto ? 34 : 28, borderRadius: 999,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: `color-mix(in srgb, ${meta.color} 22%, transparent)`, border: `1px solid ${meta.color}`,
            color: meta.color, fontSize: proto ? 12 : 11, fontWeight: 600, letterSpacing: ".02em",
          }}
        >
          {PEOPLE.includes(d.etype) ? initials(d.title) : <EntryIcon type={d.etype} size={proto ? 18 : 15} color={meta.color} />}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {editing ? (
            <input
              autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
              style={{ padding: "2px 4px" }}
            />
          ) : (
            <strong style={{ display: "block", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", fontWeight: proto ? 500 : 400, fontSize: proto ? 15 : 14, color: meta.ink }}>{d.title}</strong>
          )}
          <div style={{ fontSize: 11, color: meta.color, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {roleLine(d)}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: meta.color, width: 8, height: 8 }} />
    </div>
  );
}

export function CanvasView({ projectId, projectName, lens, onLens }: { projectId: string; projectName: string; lens: Lens; onLens: (l: Lens) => void }) {
  const [boardId, setBoardId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [checking, setChecking] = useState(false);
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

  // abre o modal de novo card quando a sidebar navega com ?new=1
  useEffect(() => {
    if (searchParams.get("new")) {
      setNewOpen(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // framear um contêiner: cria a moldura com o nome do contêiner + membros dentro (?frame=<entryId> vindo da sidebar)
  const boardIdRef = useRef<string | null>(null);
  useEffect(() => { boardIdRef.current = boardId; }, [boardId]);
  useEffect(() => {
    const frameId = searchParams.get("frame");
    const bid = boardIdRef.current;
    if (!frameId || !bid) return;
    void (async () => {
      await api.post(`/boards/${bid}/frame-container`, { containerEntryId: frameId }).catch(() => {});
      searchParams.delete("frame");
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
  const nodeTypes = useMemo(() => ({ entryCard: EntryCardNode, frame: FrameNode }), []);

  const renameEntry = useCallback((nodeId: string, entryId: string | null, title: string) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, title } } : n)));
    if (entryId) void api.patch(`/entries/${entryId}`, { title });
  }, [setNodes]);

  const renameFrame = useCallback((nodeId: string, label: string) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, label } } : n)));
    const color = (nodesRef.current.find((n) => n.id === nodeId)?.data as FrameData | undefined)?.color ?? FRAME_COLOR;
    void api.patch(`/board-nodes/${nodeId}`, { style: { label, color } });
  }, [setNodes]);

  const resizeFrame = useCallback((nodeId: string, p: { x: number; y: number; width: number; height: number }) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, position: { x: p.x, y: p.y }, style: { ...n.style, width: p.width, height: p.height } } : n)));
    void api.patch(`/board-nodes/${nodeId}`, { x: p.x, y: p.y, width: p.width, height: p.height });
  }, [setNodes]);

  const toRfNode = useCallback((bn: BoardNode): Node => {
    if (bn.kind === "frame") {
      const st = bn.style ?? {};
      const color = (st.color as string) ?? FRAME_COLOR;
      return {
        id: bn.id, type: "frame", position: { x: bn.x, y: bn.y },
        style: { width: bn.width ?? 360, height: bn.height ?? 240 }, zIndex: 0,
        data: { label: (st.label as string) ?? "Moldura", color, onRename: renameFrame, onResize: resizeFrame } satisfies FrameData,
      };
    }
    const entry = bn.entryId ? entryMap.current[bn.entryId] : undefined;
    return {
      id: bn.id, type: "entryCard", position: { x: bn.x, y: bn.y }, zIndex: 1,
      data: {
        title: entry?.title ?? "(sem ficha)", etype: entry?.type ?? bn.kind, entryId: bn.entryId,
        importance: entry?.importance ?? 0, status: entry?.status ?? "draft",
        aiFlag: bn.entryId ? aiFlagsRef.current.has(bn.entryId) : false,
        onRename: renameEntry, onOpen: setOpenId,
      } satisfies CardData,
    };
  }, [renameEntry, renameFrame, resizeFrame]);

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
    // marcador da IA: fichas com apontamentos abertos (contradição/lacuna) + painel "IA guardiã"
    try {
      const ck = await api.get<{ checks: Check[] }>(`/projects/${projectId}/ai/checks?status=open`);
      aiFlagsRef.current = new Set(ck.checks.filter((c) => c.entryId && (c.kind === "inconsistency" || c.kind === "gap")).map((c) => c.entryId!));
      setChecks(ck.checks);
    } catch { aiFlagsRef.current = new Set(); setChecks([]); }
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

  // cards cujo centro está dentro da moldura (para arrastá-los junto)
  const cardNodesInFrame = (frame: Node): string[] => {
    const fx = frame.position.x, fy = frame.position.y;
    const fw = Number((frame.style as { width?: number })?.width) || frame.measured?.width || 360;
    const fh = Number((frame.style as { height?: number })?.height) || frame.measured?.height || 240;
    return nodesRef.current
      .filter((n) => n.type === "entryCard")
      .filter((n) => {
        const cx = n.position.x + (n.measured?.width ?? 190) / 2;
        const cy = n.position.y + (n.measured?.height ?? 64) / 2;
        return cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh;
      })
      .map((n) => n.id);
  };

  const onNodeDragStart = useCallback((_e: unknown, node: Node) => {
    const moved = node.type === "frame" ? cardNodesInFrame(node) : [];
    dragRef.current = { last: { ...node.position }, moved: new Set(moved) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNodeDrag = useCallback((_e: unknown, node: Node) => {
    const drag = dragRef.current;
    if (!drag) return;
    let targets: string[];
    if (node.type === "frame") {
      targets = [...drag.moved]; // pré-computados no início do arraste
    } else {
      const entryId = (node.data as CardData).entryId;
      if (!entryId) return;
      targets = descendantNodeIds(entryId);
      if (targets.length === 0) return;
      targets.forEach((id) => drag.moved.add(id));
    }
    if (targets.length === 0) return;
    const dx = node.position.x - drag.last.x;
    const dy = node.position.y - drag.last.y;
    drag.last = { ...node.position };
    if (dx === 0 && dy === 0) return;
    const idSet = new Set(targets);
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

  async function createFrame() {
    if (!boardId) return;
    await api.post(`/boards/${boardId}/nodes`, { kind: "frame", x: 60, y: 90, width: 380, height: 260, style: { label: "Nova moldura", color: FRAME_COLOR } });
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
          <button onClick={createFrame} title="cria uma moldura para agrupar cards">▦ Moldura</button>
          <button onClick={expandSelected} disabled={!selected} title="plota os membros do card selecionado">Expandir membros</button>
        </div>
      )}

      {/* IA guardiã — a IA sussurra sobre o mundo aqui mesmo, no canvas */}
      {(lens === "quadro" || lens === "grafo") && !pending && (
        <div style={{ position: "absolute", top: 12, right: 12, zIndex: 5, width: 216, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, boxShadow: "0 2px 10px rgba(20,24,40,.10)" }}>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            <IconSparkles size={15} color="var(--accent)" />
            <strong style={{ fontSize: 13, fontWeight: 500 }}>IA guardiã</strong>
          </div>
          {(() => {
            const bad = checks.filter((c) => c.kind === "inconsistency" || c.kind === "gap");
            const sug = checks.find((c) => c.kind === "suggestion");
            if (bad.length === 0 && !sug) {
              return <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Nada a apontar por enquanto.</div>;
            }
            return (
              <>
                {bad.length > 0 && (
                  <div style={{ borderRadius: 8, padding: 8, marginBottom: 6, background: "color-mix(in srgb, var(--warn) 12%, var(--panel))", border: "1px solid color-mix(in srgb, var(--warn) 45%, var(--border))" }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--warn-strong)" }}>
                      {bad.length} {bad.length === 1 ? "inconsistência" : "inconsistências"}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{bad[0].detail ?? bad[0].title}</div>
                  </div>
                )}
                {sug && (
                  <div style={{ borderRadius: 8, padding: 8, marginBottom: 6, background: "color-mix(in srgb, var(--accent) 10%, var(--panel))", border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))" }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--accent)" }}>Sugestão</div>
                    <div style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{sug.detail ?? sug.title}</div>
                  </div>
                )}
              </>
            );
          })()}
          <button
            onClick={async () => {
              setChecking(true);
              try { await api.post(`/projects/${projectId}/ai/check`); await load(); } catch { /* silencioso */ } finally { setChecking(false); }
            }}
            disabled={checking}
            style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 13 }}
          >
            {checking ? "Analisando…" : <>Checar mundo <IconArrowUpRight size={14} /></>}
          </button>
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
            elevateNodesOnSelect={false}
            fitView
          >
            <Background color={canvasDot(theme)} gap={22} />
            <Controls />
            <MiniMap
              pannable zoomable
              nodeColor={(n) => (n.type === "frame" ? FRAME_COLOR : typeMeta((n.data as CardData).etype).color)}
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
