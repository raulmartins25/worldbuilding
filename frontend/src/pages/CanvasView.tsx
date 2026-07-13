import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import { api } from "../lib/api";
import type { Entry } from "../lib/types";

interface GraphResponse {
  nodes: { id: string; title: string; type: string }[];
  edges: { id: string; sourceId: string; targetId: string; type: string }[];
}

// Layout inicial em grade. A persistência de posições (board_nodes) entra
// na fase do canvas — aqui é a base visual com React Flow.
export function CanvasView({ projectId }: { projectId: string }) {
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [] });

  useEffect(() => {
    Promise.all([
      api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries`),
      api.get<GraphResponse>(`/projects/${projectId}/graph`),
    ]).then(([, g]) => setGraph(g));
  }, [projectId]);

  const nodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n, i) => ({
        id: n.id,
        position: { x: (i % 5) * 220, y: Math.floor(i / 5) * 140 },
        data: { label: `${n.title}\n(${n.type})` },
        style: {
          background: "var(--panel-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          whiteSpace: "pre-line",
          width: 180,
        },
      })),
    [graph.nodes],
  );

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        label: e.type,
      })),
    [graph.edges],
  );

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {graph.nodes.length === 0 && (
        <div className="muted" style={{ position: "absolute", top: 16, left: 16, zIndex: 5 }}>
          Nenhum card ainda — crie entries na aba <strong>Entries</strong>.
        </div>
      )}
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
