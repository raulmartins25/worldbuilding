import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Project } from "../lib/types";
import { ErrorBoundary } from "../lib/ErrorBoundary";
import { THEMES, ThemeCtx, type ThemeName } from "../lib/theme";
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
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [theme, setTheme] = useState<ThemeName>("default");

  useEffect(() => {
    if (!pid) return;
    api.get<{ project: Project & { settings?: Record<string, unknown> } }>(`/projects/${pid}`)
      .then((r) => {
        setProject(r.project);
        setSettings(r.project.settings ?? {});
        const t = r.project.settings?.theme as ThemeName | undefined;
        if (t && THEMES[t]) setTheme(t);
      })
      .catch(() => navigate("/worlds"));
  }, [pid, navigate]);

  // aplica a paleta do mundo no <html>; limpa ao sair
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "default") el.removeAttribute("data-world-theme");
    else el.setAttribute("data-world-theme", theme);
    return () => el.removeAttribute("data-world-theme");
  }, [theme]);

  async function changeTheme(t: ThemeName) {
    setTheme(t);
    const s = { ...settings, theme: t };
    setSettings(s);
    if (pid) await api.patch(`/projects/${pid}`, { settings: s });
  }

  return (
    <ThemeCtx.Provider value={theme}>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "100%" }}>
        <aside style={{ background: "var(--panel)", borderRight: "1px solid var(--border)", padding: "1rem", display: "flex", flexDirection: "column" }}>
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
          <div className="stack" style={{ marginTop: "auto", gap: 4 }}>
            <label className="muted" style={{ fontSize: 12 }}>Tema do mundo</label>
            <select value={theme} onChange={(e) => changeTheme(e.target.value as ThemeName)}>
              {Object.entries(THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
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
    </ThemeCtx.Provider>
  );
}
