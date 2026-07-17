import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, Route, Routes } from "react-router-dom";
import { IconWorld, IconSearch, IconPalette, IconLayoutSidebar } from "@tabler/icons-react";
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
// seções com página própria (rota)
const SECTIONS: { to: string; label: string }[] = [
  { to: "entries", label: "Fichas" },
  { to: "ia", label: "IA" },
];

export function WorldShell() {
  const { pid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [theme, setTheme] = useState<ThemeName>("default");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);
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
    setTheme(t); setThemeOpen(false);
    const s = { ...settings, theme: t };
    setSettings(s);
    if (pid) await api.patch(`/projects/${pid}`, { settings: s });
  }

  const pill = (active: boolean) => ({
    padding: "5px 14px", borderRadius: 999, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" as const,
    border: `1px solid ${active ? "transparent" : "var(--border)"}`,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "#fff" : "var(--muted)",
  });

  return (
    <ThemeCtx.Provider value={theme}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* barra global: marca › mundo + busca */}
        <header className="row" style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0 }}>
          <button onClick={() => navigate("/worlds")} title="meus mundos" style={{ display: "flex", alignItems: "center", gap: 7, border: "none", background: "transparent", padding: 0 }}>
            <IconWorld size={20} color="var(--accent)" />
            <strong style={{ fontWeight: 500 }}>Loregrid</strong>
          </button>
          <span className="muted">›</span>
          <span className="grow" style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project?.name ?? "…"}
          </span>
          <button onClick={() => setPaletteOpen(true)}
            style={{ display: "flex", alignItems: "center", gap: 8, width: 260, maxWidth: "34vw", justifyContent: "flex-start", borderRadius: 999, color: "var(--muted)", fontSize: 13 }}>
            <IconSearch size={16} />
            <span className="grow" style={{ textAlign: "left" }}>Buscar ou criar…</span>
            <kbd style={{ fontSize: 11, opacity: 0.7 }}>⌘K</kbd>
          </button>
        </header>

        {/* barra de lentes */}
        <div className="row" style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0, gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Lentes:</span>
          {LENSES.map((l) => (
            <button key={l.key} onClick={() => selectLens(l.key)} style={pill(onIndex && lens === l.key)}>{l.label}</button>
          ))}
          <span className="grow" />
          {SECTIONS.map((s) => (
            <button key={s.to} onClick={() => navigate(`/worlds/${pid}/${s.to}`)} style={pill(seg === s.to)}>{s.label}</button>
          ))}
          <button onClick={() => setImmersive((v) => !v)} title={immersive ? "mostrar contêineres" : "modo imersivo (esconde a lateral)"}
            style={{ padding: "5px 8px", background: immersive ? "var(--panel-2)" : "transparent" }}>
            <IconLayoutSidebar size={17} />
          </button>
          <div style={{ position: "relative" }}>
            <button onClick={() => setThemeOpen((v) => !v)} title="tema do mundo" style={{ padding: "5px 8px", background: themeOpen ? "var(--panel-2)" : "transparent" }}>
              <IconPalette size={17} />
            </button>
            {themeOpen && (
              <div className="stack" style={{ position: "absolute", top: "110%", right: 0, zIndex: 20, background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 10, padding: 6, width: 150, gap: 2, boxShadow: "0 8px 24px rgba(20,24,40,.18)" }}>
                {Object.entries(THEMES).map(([k, v]) => (
                  <button key={k} onClick={() => changeTheme(k as ThemeName)}
                    style={{ textAlign: "left", border: "none", fontSize: 13, background: theme === k ? "var(--panel-2)" : "transparent" }}>
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: immersive ? "1fr" : "224px 1fr", flex: 1, minHeight: 0 }}>
          {!immersive && (
            <aside style={{ background: "var(--panel)", borderRight: "1px solid var(--border)", padding: "10px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <ContainerTree
                projectId={pid!}
                onOpen={(id) => { setLens("quadro"); navigate(`/worlds/${pid}?open=${id}`); }}
                onPlot={(id) => { setLens("quadro"); navigate(`/worlds/${pid}?plot=${id}`); }}
                onNew={() => { setLens("quadro"); navigate(`/worlds/${pid}?new=1`); }}
              />
            </aside>
          )}

          <main style={{ minWidth: 0, position: "relative", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <ErrorBoundary key={onIndex ? `index:${lens}` : location.pathname}>
                <Routes>
                  <Route index element={<CanvasView projectId={pid!} projectName={project?.name ?? "Mundo"} lens={lens} onLens={setLens} />} />
                  <Route path="entries" element={<EntriesView projectId={pid!} />} />
                  <Route path="ia" element={<AIView projectId={pid!} />} />
                </Routes>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
      {pid && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} projectId={pid} onLens={selectLens} />}
    </ThemeCtx.Provider>
  );
}
