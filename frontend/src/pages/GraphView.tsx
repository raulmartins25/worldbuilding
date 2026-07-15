import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, MarkerType, Handle, Position,
  type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import { api } from "../lib/api";
import { typeMeta, relLabel } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";

interface GNode { id: string; title: string; type: string; }
interface GEdge { id: string; sourceId: string; targetId: string; type: string; label: string | null; }

const REL_COLORS: Record<string, string> = {
  aliado_de: "#3fb950", inimigo_de: "#f85149", pai_de: "#d29922", mae_de: "#db61a2",
  casado_com: "#a371f7", governa: "#58a6ff", pertence_a: "#8b949e", aparece_em: "#39c5cf",
};
const edgeColor = (t: string) => REL_COLORS[t] ?? "#8b949e";
const GEN = new Set(["pai_de", "mae_de", "filho_de", "casado_com"]);

type GData = { title: string; etype: string };
function GraphCardNode({ data }: NodeProps) {
  const d = data as GData;
  const m = typeMeta(d.etype);
  return (
    <div style={{ background: m.tint, color: m.ink, border: `1px solid ${m.color}`, borderRadius: 10, padding: "6px 10px", width: 168, display: "flex", gap: 8, alignItems: "center", boxShadow: "0 1px 3px rgba(20,24,40,.10)" }}>
      <Handle type="target" position={Position.Top} style={{ background: m.color, width: 7, height: 7 }} />
      <EntryIcon type={d.etype} size={20} color={m.color} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: m.color, fontWeight: 500 }}>{m.label}</div>
        <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: m.color, width: 7, height: 7 }} />
    </div>
  );
}

function forceLayout(ids: string[], edges: GEdge[]): Record<string, { x: number; y: number }> {
  if (ids.length === 0) return {};
  const n = ids.length;
  const W = 520, H = 380;
  const k = Math.sqrt((W * H) / n);
  const idx: Record<string, number> = Object.fromEntries(ids.map((id, i) => [id, i]));
  const pos: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const a = (i / n) * 2 * Math.PI;
    pos[id] = { x: W / 2 + Math.cos(a) * 220 + Math.random() * 8, y: H / 2 + Math.sin(a) * 220 + Math.random() * 8 };
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
      // gravidade central: mantém nós isolados agrupados
      disp[i].x += (W / 2 - pos[ids[i]].x) * 0.16;
      disp[i].y += (H / 2 - pos[ids[i]].y) * 0.16;
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01, lim = Math.min(d, temp);
      pos[ids[i]].x += (disp[i].x / d) * lim; pos[ids[i]].y += (disp[i].y / d) * lim;
    }
    temp *= 0.97;
  }
  return pos;
}

function genealogyLayout(edges: GEdge[]) {
  const genEdges = edges.filter((e) => GEN.has(e.type));
  const nodeIds = new Set<string>();
  const parentChild: [string, string][] = [];
  for (const e of genEdges) {
    nodeIds.add(e.sourceId); nodeIds.add(e.targetId);
    if (e.type === "pai_de" || e.type === "mae_de") parentChild.push([e.sourceId, e.targetId]);
    else if (e.type === "filho_de") parentChild.push([e.targetId, e.sourceId]);
  }
  const level: Record<string, number> = {};
  nodeIds.forEach((id) => (level[id] = 0));
  for (let it = 0; it < nodeIds.size; it++) {
    let changed = false;
    for (const [p, c] of parentChild) if (level[c] < level[p] + 1) { level[c] = level[p] + 1; changed = true; }
    if (!changed) break;
  }
  const byLevel: Record<number, string[]> = {};
  nodeIds.forEach((id) => (byLevel[level[id]] ??= []).push(id));
  const pos: Record<string, { x: number; y: number }> = {};
  Object.entries(byLevel).forEach(([lv, ids]) => ids.forEach((id, i) => { pos[id] = { x: i * 210, y: Number(lv) * 150 }; }));
  return { pos, nodeIds, genEdges };
}

export function GraphView({ projectId }: { projectId: string }) {
  const [graph, setGraph] = useState<{ nodes: GNode[]; edges: GEdge[] }>({ nodes: [], edges: [] });
  const [mode, setMode] = useState<"all" | "genealogy">("all");
  const nodeTypes = useMemo(() => ({ gcard: GraphCardNode }), []);

  const load = useCallback(async () => {
    const g = await api.get<{ nodes: GNode[]; edges: GEdge[] }>(`/projects/${projectId}/graph`);
    setGraph(g);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const nodeFor = (id: string, type: string, title: string, pos: { x: number; y: number }): Node => ({
    id, position: pos, type: "gcard", data: { title, etype: type } satisfies GData,
  });
  const edgeFor = (id: string, source: string, target: string, type: string): Edge => ({
    id, source, target, label: relLabel(type),
    style: { stroke: edgeColor(type), strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(type) },
    labelStyle: { fill: "var(--text)", fontSize: 11 }, labelBgStyle: { fill: "var(--panel)" },
  });

  const { rfNodes, rfEdges } = useMemo(() => {
    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
    if (mode === "genealogy") {
      const { pos, nodeIds, genEdges } = genealogyLayout(graph.edges);
      const rfN = [...nodeIds].map((id) => nodeFor(id, byId[id]?.type ?? "note", byId[id]?.title ?? id.slice(0, 6), pos[id] ?? { x: 0, y: 0 }));
      const rfE = genEdges.map((e) => edgeFor(e.id, e.sourceId, e.targetId, e.type));
      return { rfNodes: rfN, rfEdges: rfE };
    }
    const pos = forceLayout(graph.nodes.map((n) => n.id), graph.edges);
    const rfN = graph.nodes.map((n) => nodeFor(n.id, n.type, n.title, pos[n.id] ?? { x: 0, y: 0 }));
    const rfE = graph.edges.map((e) => edgeFor(e.id, e.sourceId, e.targetId, e.type));
    return { rfNodes: rfN, rfEdges: rfE };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, mode]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div className="row" style={{ position: "absolute", top: 12, left: 12, zIndex: 5, background: "var(--panel)", padding: 6, borderRadius: 10, border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
        <button className={mode === "all" ? "primary" : ""} onClick={() => setMode("all")}>Grafo</button>
        <button className={mode === "genealogy" ? "primary" : ""} onClick={() => setMode("genealogy")}>Genealogia</button>
        <button onClick={load} title="recarregar">↻</button>
      </div>
      {rfNodes.length === 0 && (
        <div className="muted" style={{ position: "absolute", bottom: 16, left: 16, zIndex: 5 }}>
          {mode === "genealogy" ? "Sem relações genealógicas (Pai de / Mãe de / Casado com)." : "Sem fichas/relações ainda."}
        </div>
      )}
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView minZoom={0.1}>
        <Background color="#d7dbe2" gap={22} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={(n) => typeMeta((n.data as GData).etype).color} style={{ background: "var(--panel)", border: "1px solid var(--border)" }} />
      </ReactFlow>
    </div>
  );
}
