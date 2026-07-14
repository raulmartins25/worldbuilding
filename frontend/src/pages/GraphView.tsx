import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MarkerType, type Node, type Edge } from "@xyflow/react";
import { api } from "../lib/api";

interface GNode { id: string; title: string; type: string; }
interface GEdge { id: string; sourceId: string; targetId: string; type: string; label: string | null; }

const REL_COLORS: Record<string, string> = {
  aliado_de: "#3fb950", inimigo_de: "#f85149", pai_de: "#d29922", mae_de: "#db61a2",
  casado_com: "#a371f7", governa: "#58a6ff", pertence_a: "#8b949e", aparece_em: "#39c5cf",
};
const edgeColor = (t: string) => REL_COLORS[t] ?? "#6e7681";
const GEN = new Set(["pai_de", "mae_de", "filho_de", "casado_com"]);

// layout força-dirigida (Fruchterman–Reingold simplificado)
function forceLayout(ids: string[], edges: GEdge[]): Record<string, { x: number; y: number }> {
  const n = ids.length || 1;
  const W = 1000, H = 680;
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
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01, lim = Math.min(d, temp);
      pos[ids[i]].x += (disp[i].x / d) * lim; pos[ids[i]].y += (disp[i].y / d) * lim;
    }
    temp *= 0.97;
  }
  return pos;
}

// layout em camadas para genealogia (pais em cima, filhos embaixo)
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

  const load = useCallback(async () => {
    const g = await api.get<{ nodes: GNode[]; edges: GEdge[] }>(`/projects/${projectId}/graph`);
    setGraph(g);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const nodeStyle = { background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, width: 170, whiteSpace: "pre-line" as const, fontSize: 12 };

  const { rfNodes, rfEdges } = useMemo(() => {
    const titleMap = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
    if (mode === "genealogy") {
      const { pos, nodeIds, genEdges } = genealogyLayout(graph.edges);
      const rfN: Node[] = [...nodeIds].map((id) => ({
        id, position: pos[id] ?? { x: 0, y: 0 },
        data: { label: `${titleMap[id]?.title ?? id.slice(0, 6)}\n(${titleMap[id]?.type ?? "?"})` },
        style: nodeStyle,
      }));
      const rfE: Edge[] = genEdges.map((e) => ({
        id: e.id, source: e.sourceId, target: e.targetId, label: e.type,
        style: { stroke: edgeColor(e.type), strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(e.type) },
        labelStyle: { fill: "var(--text)", fontSize: 11 }, labelBgStyle: { fill: "var(--panel)" },
      }));
      return { rfNodes: rfN, rfEdges: rfE };
    }
    const ids = graph.nodes.map((n) => n.id);
    const pos = forceLayout(ids, graph.edges);
    const rfN: Node[] = graph.nodes.map((n) => ({
      id: n.id, position: pos[n.id] ?? { x: 0, y: 0 },
      data: { label: `${n.title}\n(${n.type})` }, style: nodeStyle,
    }));
    const rfE: Edge[] = graph.edges.map((e) => ({
      id: e.id, source: e.sourceId, target: e.targetId, label: e.label ?? e.type,
      style: { stroke: edgeColor(e.type), strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(e.type) },
      labelStyle: { fill: "var(--text)", fontSize: 11 }, labelBgStyle: { fill: "var(--panel)" },
    }));
    return { rfNodes: rfN, rfEdges: rfE };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, mode]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div className="row" style={{ position: "absolute", top: 12, left: 12, zIndex: 5, background: "var(--panel)", padding: 6, borderRadius: 10, border: "1px solid var(--border)" }}>
        <button className={mode === "all" ? "primary" : ""} onClick={() => setMode("all")}>Grafo</button>
        <button className={mode === "genealogy" ? "primary" : ""} onClick={() => setMode("genealogy")}>Genealogia</button>
        <button onClick={load} title="recarregar">↻</button>
      </div>
      {rfNodes.length === 0 && (
        <div className="muted" style={{ position: "absolute", bottom: 16, left: 16, zIndex: 5 }}>
          {mode === "genealogy" ? "Sem relações genealógicas (pai_de / mae_de / casado_com)." : "Sem entries/relações ainda."}
        </div>
      )}
      <ReactFlow nodes={rfNodes} edges={rfEdges} fitView minZoom={0.1}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
