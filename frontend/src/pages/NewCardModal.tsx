import { useMemo, useRef, useState } from "react";
import { IconPlus, IconX, IconDots, IconSparkles, IconArrowUpRight, IconMapPin, IconFileImport } from "@tabler/icons-react";
import { api } from "../lib/api";
import { ENTRY_TYPES, type EntryType } from "../lib/types";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { TYPE_TEMPLATES } from "../lib/templates";

export interface NewCardData {
  type: EntryType; title: string; summary?: string;
  importance: number; metadata: Record<string, unknown>; body?: Record<string, unknown>;
}

interface ImportEntity { title: string; summary: string; metadata: Record<string, unknown>; }

// tipos cujo corpo (manuscrito) recebe o texto importado
const MANUSCRIPT = new Set<EntryType>(["chapter", "scene"]);

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

// texto → doc Tiptap (parágrafos) para o corpo de capítulos/cenas
function textToDoc(text: string): Record<string, unknown> {
  const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  return { type: "doc", content: paras.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) };
}

// tipos em destaque na grade; o resto entra pelo "Mais…"
const PRIMARY: EntryType[] = ["character", "location", "faction", "creature", "magic_system", "item", "event"];
const LEVELS = [
  { v: 1, label: "Figurante" },
  { v: 2, label: "Coadjuvante" },
  { v: 3, label: "Importante" },
  { v: 4, label: "Protagonista" },
];

export function NewCardModal({
  projectId, projectName, onClose, onSubmit,
}: { projectId: string; projectName: string; onClose: () => void; onSubmit: (d: NewCardData | NewCardData[]) => Promise<void> }) {
  const [type, setType] = useState<EntryType>("character");
  const [showAll, setShowAll] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [importance, setImportance] = useState(2);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{ name: string; words: number; text: string } | null>(null);
  const [multi, setMulti] = useState<ImportEntity[] | null>(null); // >1 ficha detectada → modo lista
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const m = typeMeta(type);
  const tpl = TYPE_TEMPLATES[type] ?? [];
  const rest = useMemo(() => ENTRY_TYPES.filter((t) => !PRIMARY.includes(t)), []);
  const tiles: EntryType[] = showAll ? [...PRIMARY, ...rest] : PRIMARY;

  function pick(t: EntryType) {
    setType(t);
    setMeta({}); // template muda com o tipo
    setMulti(null); setImported(null); // a extração era do tipo anterior
  }

  function fillFrom(e: ImportEntity) {
    if (e.title) setTitle(e.title);
    if (e.summary) setSummary(e.summary);
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.metadata ?? {})) filled[k] = v == null ? "" : String(v);
    setMeta((prev) => ({ ...prev, ...filled }));
  }

  async function importFile(file: File) {
    setImporting(true); setError(null); setMulti(null);
    try {
      const dataBase64 = await fileToBase64(file);
      const r = await api.post<{ entities: ImportEntity[]; text: string; words: number }>(
        `/projects/${projectId}/entries/import`,
        { filename: file.name, dataBase64, type, fields: tpl.map((f) => ({ key: f.key, label: f.label, options: f.options })) },
      );
      setImported({ name: file.name, words: r.words, text: r.text });
      const ents = r.entities ?? [];
      if (ents.length > 1) {
        setMulti(ents);
        setPicked(new Set(ents.map((_, i) => i)));
      } else if (ents.length === 1) {
        fillFrom(ents[0]);
      } else {
        setError("Não encontrei fichas desse tipo no documento.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "não consegui ler o arquivo");
    } finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function createMany() {
    if (!multi || saving) return;
    const chosen = multi.filter((_, i) => picked.has(i));
    if (chosen.length === 0) return;
    setSaving(true); setError(null);
    try {
      const cards: NewCardData[] = chosen.map((e) => {
        const metadata: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(e.metadata ?? {})) if (v != null && String(v).trim()) metadata[k] = String(v);
        return { type, title: e.title, summary: e.summary || undefined, importance, metadata };
      });
      await onSubmit(cards);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
      setSaving(false);
    }
  }

  async function draft() {
    setDrafting(true); setError(null);
    try {
      const r = await api.post<{ title: string; summary: string; metadata: Record<string, unknown> }>(
        `/projects/${projectId}/entries/draft`,
        { type, title: title.trim() || undefined, importance, fields: tpl.map((f) => ({ key: f.key, label: f.label, options: f.options })) },
      );
      if (r.title) setTitle(r.title);
      if (r.summary) setSummary(r.summary);
      const filled: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.metadata ?? {})) filled[k] = v == null ? "" : String(v);
      setMeta((prev) => ({ ...prev, ...filled }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally { setDrafting(false); }
  }

  async function create() {
    if (!title.trim() || saving) return;
    setSaving(true); setError(null);
    try {
      const metadata: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(meta)) if (v.trim()) metadata[k] = v;
      const body = imported && MANUSCRIPT.has(type) ? textToDoc(imported.text) : undefined;
      await onSubmit({ type, title: title.trim(), summary: summary.trim() || undefined, importance, metadata, body });
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
      setSaving(false);
    }
  }

  const label = m.label.toLowerCase();

  return (
    <div onClick={onClose} className="modal-backdrop" style={{ position: "fixed", inset: 0, zIndex: 58, background: "rgba(15,18,30,.45)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "5vh" }}>
      <div onClick={(e) => e.stopPropagation()} className="modal-sheet" style={{ width: 720, maxWidth: "95vw", maxHeight: "88vh", background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 40px rgba(20,24,40,.25)", display: "flex", flexDirection: "column" }}>
        <div className="row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <IconPlus size={18} color="var(--accent)" />
          <strong style={{ fontWeight: 500 }}>Novo card</strong>
          <span className="muted grow" style={{ fontSize: 13 }}>em {projectName}</span>
          <button onClick={onClose} title="fechar" style={{ border: "none", background: "transparent" }}><IconX size={18} /></button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>1. Escolha o tipo</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
            {tiles.map((t) => {
              const tm = typeMeta(t);
              const on = t === type;
              return (
                <button key={t} onClick={() => pick(t)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 6px",
                    borderRadius: 10, border: `1px solid ${on ? tm.color : "var(--border)"}`,
                    background: on ? tm.tint : "transparent", color: on ? tm.color : "var(--text)", fontSize: 13,
                  }}>
                  <EntryIcon type={t} size={22} color={on ? tm.color : "var(--muted)"} />
                  {tm.label}
                </button>
              );
            })}
            {!showAll && (
              <button onClick={() => setShowAll(true)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 6px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", fontSize: 13 }}>
                <IconDots size={22} color="var(--muted)" />
                Mais…
              </button>
            )}
          </div>

          {multi ? (
            <>
              <div className="row" style={{ margin: "18px 0 8px" }}>
                <span className="grow" style={{ fontSize: 13, fontWeight: 500 }}>{multi.length} {label.toLowerCase()}{multi.length > 1 ? "s" : ""} encontrados no documento</span>
                <button style={{ fontSize: 12, padding: "3px 8px" }} onClick={() => setPicked(picked.size === multi.length ? new Set() : new Set(multi.map((_, i) => i)))}>
                  {picked.size === multi.length ? "desmarcar" : "marcar todos"}
                </button>
              </div>
              <div className="stack" style={{ gap: 6, maxHeight: 280, overflow: "auto" }}>
                {multi.map((e, i) => (
                  <label key={i} className="row" style={{ gap: 8, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: picked.has(i) ? m.tint : "transparent" }}>
                    <input type="checkbox" checked={picked.has(i)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; })} style={{ width: "auto" }} />
                    <EntryIcon type={type} size={18} color={m.color} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{e.title}</div>
                      {e.summary && <div className="muted" style={{ fontSize: 12 }}>{e.summary}</div>}
                    </div>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="row" style={{ margin: "18px 0 8px" }}>
                <span className="muted grow" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>2. Template de {label}</span>
                <span className="muted" style={{ fontSize: 12 }}>campos aparecem conforme o tipo</span>
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <input placeholder={`Nome ${["character", "creature", "deity"].includes(type) ? "do" : "da"} ${label}`} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                <input placeholder="Uma frase que o resume" value={summary} onChange={(e) => setSummary(e.target.value)} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {tpl.map((f) => {
                    const val = meta[f.key] ?? "";
                    const set = (v: string) => setMeta((p) => ({ ...p, [f.key]: v }));
                    const full = f.kind === "textarea";
                    return (
                      <div key={f.key} style={{ gridColumn: full ? "1 / -1" : undefined }}>
                        {f.kind === "textarea" ? (
                          <textarea placeholder={f.label} value={val} onChange={(e) => set(e.target.value)} rows={2} style={{ width: "100%", resize: "vertical" }} />
                        ) : f.kind === "select" ? (
                          <select value={val} onChange={(e) => set(e.target.value)} style={{ width: "100%" }}>
                            <option value="">{f.label}…</option>
                            {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type={f.kind === "number" ? "number" : "text"} placeholder={f.label} value={val} onChange={(e) => set(e.target.value)} style={{ width: "100%" }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <div className="row" style={{ marginTop: 16, gap: 10 }}>
            <span className="muted" style={{ fontSize: 13 }}>Importância</span>
            <div className="row" style={{ gap: 6 }}>
              {LEVELS.map((l) => (
                <button key={l.v} onClick={() => setImportance(l.v)} title={l.label}
                  style={{ width: 62, height: 7, padding: 0, borderRadius: 999, border: "none", background: importance >= l.v ? m.color : "var(--border)" }} />
              ))}
            </div>
            <span style={{ fontSize: 13, color: m.color }}>{LEVELS.find((l) => l.v === importance)?.label}</span>
          </div>

          {!multi && (
            <div className="card" style={{ marginTop: 16, borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, var(--panel))" }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <IconSparkles size={16} color="var(--accent)" style={{ marginTop: 2 }} />
                <div className="grow">
                  <div style={{ fontWeight: 500, color: "var(--accent)" }}>Deixar a IA rascunhar</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Preenche o template respeitando a magia, o clima e o tom de {projectName}. Você edita depois.
                  </div>
                </div>
                <button className="primary" onClick={draft} disabled={drafting || importing}>
                  {drafting ? "Rascunhando…" : <>Gerar <IconArrowUpRight size={14} /></>}
                </button>
              </div>
            </div>
          )}

          {/* importar documento — a IA extrai e preenche a partir do arquivo */}
          <div className="card" style={{ marginTop: 12, borderColor: "var(--accent-2)", background: "color-mix(in srgb, var(--accent-2) 8%, var(--panel))" }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <IconFileImport size={16} color="var(--accent-2)" style={{ marginTop: 2 }} />
              <div className="grow">
                <div style={{ fontWeight: 500, color: "var(--accent-2)" }}>Importar de um documento</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Envie um <strong>.docx</strong> ou <strong>.pdf</strong> — a IA lê e cria uma ficha por {label.toLowerCase()} encontrado.{MANUSCRIPT.has(type) ? " O texto vai para o manuscrito." : ""}
                </div>
                {imported && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    ✓ {imported.name} · {imported.words.toLocaleString("pt-BR")} palavras lidas{MANUSCRIPT.has(type) ? " (no manuscrito)" : ""}
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={importing || drafting}>
                {importing ? "Lendo…" : "Importar"}
              </button>
            </div>
          </div>
          {error && <div style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}
        </div>

        <div className="row" style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
          <IconMapPin size={14} color="var(--muted)" />
          <span className="muted grow" style={{ fontSize: 12 }}>Já vai pro canvas do mundo</span>
          <button onClick={onClose}>Cancelar</button>
          {multi ? (
            <button className="primary" onClick={createMany} disabled={picked.size === 0 || saving}>
              {saving ? "Criando…" : `Criar ${picked.size} card${picked.size === 1 ? "" : "s"}`}
            </button>
          ) : (
            <button className="primary" onClick={create} disabled={!title.trim() || saving}>{saving ? "Criando…" : "Criar card"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
