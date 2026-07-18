import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, Route, Routes } from "react-router-dom";
import { IconWorld, IconSearch, IconPalette, IconLayoutSidebar, IconMenu2, IconX } from "@tabler/icons-react";
import { api } from "../lib/api";
import type { Project } from "../lib/types";
import { ErrorBoundary } from "../lib/ErrorBoundary";
import { useIsMobile } from "../lib/useIsMobile";
import { THEMES, ThemeCtx, type ThemeName } from "../lib/theme";
import { CanvasView, type Lens } from "./CanvasView";
import { EntriesView } from "./EntriesView";
import { AIView } from "./AIView";
import { CommandPalette } from "./CommandPalette";
import { ContainerTree } from "./ContainerTree";
import { BatchImportModal } from "./BatchImportModal";

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [lens, setLens] = useState<Lens>("quadro");
  const mobile = useIsMobile();

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

  const sidebarInner = (
    <ContainerTree
      projectId={pid!}
      onOpen={(id) => { setLens("quadro"); setDrawerOpen(false); navigate(`/worlds/${pid}?open=${id}`); }}
      onFrame={(id) => { setLens("quadro"); setDrawerOpen(false); navigate(`/worlds/${pid}?frame=${id}`); }}
      onNew={() => { setLens("quadro"); setDrawerOpen(false); navigate(`/worlds/${pid}?new=1`); }}
      onImport={() => { setDrawerOpen(false); setBatchOpen(true); }}
    />
  );
  const showDock = !mobile && !immersive;

  return (
    <ThemeCtx.Provider value={theme}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* barra global: (menu) marca › mundo + busca */}
        <header className="row" style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0, gap: 8 }}>
          {mobile && (
            <button onClick={() => setDrawerOpen(true)} title="contêineres" style={{ padding: "5px 7px", border: "none", background: "transparent" }}>
              <IconMenu2 size={20} />
            </button>
          )}
          <button onClick={() => navigate("/worlds")} title="meus mundos" style={{ display: "flex", alignItems: "center", gap: 7, border: "none", background: "transparent", padding: 0 }}>
            <IconWorld size={20} color="var(--accent)" />
            {!mobile && <strong style={{ fontWeight: 500 }}>Loregrid</strong>}
          </button>
          <span className="muted">›</span>
          <span className="grow" style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project?.name ?? "…"}
          </span>
          <button onClick={() => setPaletteOpen(true)} title="Buscar / comandos"
            style={{ display: "flex", alignItems: "center", gap: 8, width: mobile ? "auto" : 260, maxWidth: "34vw", justifyContent: "flex-start", borderRadius: 999, color: "var(--muted)", fontSize: 13 }}>
            <IconSearch size={16} />
            {!mobile && <><span className="grow" style={{ textAlign: "left" }}>Buscar ou criar…</span><kbd style={{ fontSize: 11, opacity: 0.7 }}>⌘K</kbd></>}
          </button>
        </header>

        {/* barra de lentes (rolagem horizontal no mobile) */}
        <div className="row no-scrollbar" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0, gap: 6, flexWrap: mobile ? "nowrap" : "wrap" }}>
          {!mobile && <span className="muted" style={{ fontSize: 12 }}>Lentes:</span>}
          {LENSES.map((l) => (
            <button key={l.key} onClick={() => selectLens(l.key)} style={pill(onIndex && lens === l.key)}>{l.label}</button>
          ))}
          {!mobile && <span className="grow" />}
          {SECTIONS.map((s) => (
            <button key={s.to} onClick={() => navigate(`/worlds/${pid}/${s.to}`)} style={pill(seg === s.to)}>{s.label}</button>
          ))}
          {!mobile && (
            <button onClick={() => setImmersive((v) => !v)} title={immersive ? "mostrar contêineres" : "modo imersivo (esconde a lateral)"}
              style={{ padding: "5px 8px", background: immersive ? "var(--panel-2)" : "transparent" }}>
              <IconLayoutSidebar size={17} />
            </button>
          )}
          {mobile ? (
            <select value={theme} onChange={(e) => changeTheme(e.target.value as ThemeName)} title="tema do mundo"
              style={{ width: "auto", flexShrink: 0, borderRadius: 999, padding: "5px 10px", fontSize: 13 }}>
              {Object.entries(THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          ) : (
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
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: showDock ? "224px 1fr" : "1fr", flex: 1, minHeight: 0 }}>
          {showDock && (
            <aside style={{ background: "var(--panel)", borderRight: "1px solid var(--border)", padding: "10px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
              {sidebarInner}
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

      {/* gaveta de contêineres (mobile) */}
      {mobile && drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 45, background: "rgba(15,18,30,.4)" }}>
          <aside onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: 0, bottom: 0, left: 0, width: "min(300px, 86vw)", background: "var(--panel)", borderRight: "1px solid var(--border)", padding: "10px 12px", display: "flex", flexDirection: "column", boxShadow: "8px 0 28px rgba(20,24,40,.22)" }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <strong className="grow" style={{ fontWeight: 500, fontSize: 14 }}>{project?.name ?? "Mundo"}</strong>
              <button onClick={() => setDrawerOpen(false)} style={{ padding: "4px 6px", border: "none", background: "transparent" }}><IconX size={18} /></button>
            </div>
            {sidebarInner}
          </aside>
        </div>
      )}
      {pid && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} projectId={pid} onLens={selectLens} />}
      {batchOpen && pid && (
        <BatchImportModal
          projectId={pid}
          projectName={project?.name ?? "Mundo"}
          onClose={() => setBatchOpen(false)}
          onDone={() => { setBatchOpen(false); setLens("quadro"); if (!onIndex) navigate(`/worlds/${pid}`); window.dispatchEvent(new Event("loregrid:refresh")); }}
        />
      )}
    </ThemeCtx.Provider>
  );
}
