import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Project } from "../lib/types";
import { ErrorBoundary } from "../lib/ErrorBoundary";
import { THEMES, ThemeCtx, type ThemeName } from "../lib/theme";
import { CanvasView, type Lens } from "./CanvasView";
import { EntriesView } from "./EntriesView";
import { AIView } from "./AIView";
import { CommandPalette } from "./CommandPalette";
import { ContainerTree } from "./ContainerTree";

// lentes espaciais: camadas sobre o MESMO canvas-home (rota índice), alternadas sem trocar de tela
const LENSES: { key: Lens; label: string }[] = [
  { key: "quadro", label: "Quadro" },
  { key: "grafo", label: "Grafo" },
  { key: "mapa", label: "Mapa" },
  { key: "linha", label: "Linha do tempo" },
];
const LENS_TITLE: Record<Lens, string> = { quadro: "Quadro", grafo: "Grafo", mapa: "Mapa", linha: "Linha do tempo" };
// seções com página própria (rota)
const SECTIONS: { to: string; label: string; title: string }[] = [
  { to: "entries", label: "Fichas", title: "Fichas" },
  { to: "ia", label: "IA", title: "Central de IA" },
];

export function WorldShell() {
  const { pid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [theme, setTheme] = useState<ThemeName>("default");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [lens, setLens] = useState<Lens>("quadro");

  // Cmd/Ctrl+K abre a command palette (espinha por teclado)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const seg = (location.pathname.split(`/worlds/${pid}`)[1] ?? "").replace(/^\//, "");
  const onIndex = seg === "";
  const section = SECTIONS.find((s) => s.to === seg);
  const crumb = onIndex ? LENS_TITLE[lens] : (section?.title ?? "Mundo");

  // seleciona uma lente espacial: garante o canvas-home (rota índice) e troca a camada
  const selectLens = (l: Lens) => { setLens(l); if (!onIndex) navigate(`/worlds/${pid}`); };

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

  const navItemStyle = (active: boolean) => ({
    padding: "0.5rem 0.7rem", borderRadius: 8, border: "none", textAlign: "left" as const, cursor: "pointer",
    background: active ? "var(--panel-2)" : "transparent",
    color: active ? "var(--text)" : "var(--muted)",
  });

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
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", padding: "0 0.7rem 2px" }}>Lentes</div>
            {LENSES.map((l) => (
              <button key={l.key} onClick={() => selectLens(l.key)} style={navItemStyle(onIndex && lens === l.key)}>
                {l.label}
              </button>
            ))}
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", padding: "10px 0.7rem 2px" }}>Seções</div>
            {SECTIONS.map((s) => (
              <NavLink key={s.to} to={s.to} style={({ isActive }) => navItemStyle(isActive)}>
                {s.label}
              </NavLink>
            ))}
          </nav>
          <ContainerTree
            projectId={pid!}
            onOpen={(id) => { setLens("quadro"); navigate(`/worlds/${pid}?open=${id}`); }}
            onPlot={(id) => { setLens("quadro"); navigate(`/worlds/${pid}?plot=${id}`); }}
          />
          <div className="stack" style={{ marginTop: "auto", gap: 4 }}>
            <label className="muted" style={{ fontSize: 12 }}>Tema do mundo</label>
            <select value={theme} onChange={(e) => changeTheme(e.target.value as ThemeName)}>
              {Object.entries(THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </aside>

        <main style={{ minWidth: 0, position: "relative", display: "flex", flexDirection: "column" }}>
          <div className="row" style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--panel)", fontSize: 13, flexShrink: 0 }}>
            <span className="muted">{project?.name ?? "Mundo"}</span>
            <span className="muted">›</span>
            <span style={{ fontWeight: 500 }}>{crumb}</span>
            <span className="grow" />
            <button onClick={() => setPaletteOpen(true)} title="Buscar / comandos (Ctrl/Cmd+K)" style={{ fontSize: 12, padding: "2px 8px" }}>⌘K</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <ErrorBoundary key={onIndex ? `index:${lens}` : location.pathname}>
              <Routes>
                <Route index element={<CanvasView projectId={pid!} lens={lens} onLens={setLens} />} />
                <Route path="entries" element={<EntriesView projectId={pid!} />} />
                <Route path="ia" element={<AIView projectId={pid!} />} />
              </Routes>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {pid && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} projectId={pid} onLens={selectLens} />}
    </ThemeCtx.Provider>
  );
}
