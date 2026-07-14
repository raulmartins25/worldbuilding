import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Project } from "../lib/types";
import { ErrorBoundary } from "../lib/ErrorBoundary";
import { CanvasView } from "./CanvasView";
import { EntriesView } from "./EntriesView";
import { GraphView } from "./GraphView";
import { AIView } from "./AIView";
import { MapView } from "./MapView";
import { TimelineView } from "./TimelineView";

const NAV = [
  { to: "", label: "Quadro", end: true },
  { to: "entries", label: "Fichas" },
  { to: "map", label: "Mapa" },
  { to: "timeline", label: "Linha do tempo" },
  { to: "graph", label: "Grafo" },
  { to: "ia", label: "IA" },
];

export function WorldShell() {
  const { pid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!pid) return;
    api.get<{ project: Project }>(`/projects/${pid}`).then((r) => setProject(r.project)).catch(() => navigate("/worlds"));
  }, [pid, navigate]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "100%" }}>
      <aside style={{ background: "var(--panel)", borderRight: "1px solid var(--border)", padding: "1rem" }}>
        <div className="row" style={{ marginBottom: "1rem" }}>
          <button onClick={() => navigate("/worlds")}>←</button>
          <strong className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project?.name ?? "…"}
          </strong>
        </div>
        <nav className="stack">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              style={({ isActive }) => ({
                padding: "0.5rem 0.7rem",
                borderRadius: 8,
                background: isActive ? "var(--panel-2)" : "transparent",
                color: isActive ? "var(--text)" : "var(--muted)",
              })}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main style={{ minWidth: 0, position: "relative" }}>
        <ErrorBoundary key={location.pathname}>
        <Routes>
          <Route index element={<CanvasView projectId={pid!} />} />
          <Route path="entries" element={<EntriesView projectId={pid!} />} />
          <Route path="map" element={<MapView projectId={pid!} />} />
          <Route path="timeline" element={<TimelineView projectId={pid!} />} />
          <Route path="graph" element={<GraphView projectId={pid!} />} />
          <Route path="ia" element={<AIView projectId={pid!} />} />
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
