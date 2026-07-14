import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Project } from "../lib/types";
import { CanvasView } from "./CanvasView";
import { EntriesView } from "./EntriesView";
import { GraphView } from "./GraphView";
import { AIView } from "./AIView";

const NAV = [
  { to: "", label: "Quadro", end: true },
  { to: "entries", label: "Fichas" },
  { to: "map", label: "Mapa" },
  { to: "timeline", label: "Linha do tempo" },
  { to: "graph", label: "Grafo" },
  { to: "ia", label: "IA" },
];

function Placeholder({ title }: { title: string }) {
  return (
    <div className="center-screen muted">
      <div className="card" style={{ textAlign: "center" }}>
        <strong>{title}</strong>
        <div>Em breve — próxima fase do roadmap.</div>
      </div>
    </div>
  );
}

export function WorldShell() {
  const { pid } = useParams();
  const navigate = useNavigate();
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
        <Routes>
          <Route index element={<CanvasView projectId={pid!} />} />
          <Route path="entries" element={<EntriesView projectId={pid!} />} />
          <Route path="map" element={<Placeholder title="Mapa cartográfico" />} />
          <Route path="timeline" element={<Placeholder title="Linha do tempo" />} />
          <Route path="graph" element={<GraphView projectId={pid!} />} />
          <Route path="ia" element={<AIView projectId={pid!} />} />
        </Routes>
      </main>
    </div>
  );
}
