import { useRef, useState } from "react";
import { IconFileImport, IconX, IconTrash, IconPlus } from "@tabler/icons-react";
import { api } from "../lib/api";
import { ENTRY_TYPES, type EntryType } from "../lib/types";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { TYPE_TEMPLATES } from "../lib/templates";

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

const DEFAULT_TYPES: EntryType[] = ["character", "location", "faction", "magic_system", "item", "event", "creature", "chapter"];

interface BatchResult { cards: number; relationships: number; entities: { type: string; title: string }[]; docs: string[]; }

export function BatchImportModal({ projectId, projectName, onClose, onDone }: {
  projectId: string; projectName: string; onClose: () => void; onDone: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [types, setTypes] = useState<Set<EntryType>>(new Set(DEFAULT_TYPES));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const ok = Array.from(list).filter((f) => /\.(docx|pdf)$/i.test(f.name));
    setFiles((prev) => [...prev, ...ok]);
    if (fileRef.current) fileRef.current.value = "";
  };
  const toggleType = (t: EntryType) => setTypes((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });

  async function run() {
    if (files.length === 0 || types.size === 0 || busy) return;
    setBusy(true); setError(null);
    try {
      const documents = await Promise.all(files.map(async (f) => ({ filename: f.name, dataBase64: await fileToBase64(f) })));
      const typesPayload = [...types].map((t) => ({ type: t, fields: (TYPE_TEMPLATES[t] ?? []).map((f) => ({ key: f.key, label: f.label, options: f.options })) }));
      const r = await api.post<BatchResult>(`/projects/${projectId}/import-batch`, { documents, types: typesPayload });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "não consegui processar os documentos");
    } finally { setBusy(false); }
  }

  return (
    <div onClick={busy ? undefined : onClose} className="modal-backdrop" style={{ position: "fixed", inset: 0, zIndex: 58, background: "rgba(15,18,30,.45)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "5vh" }}>
      <div onClick={(e) => e.stopPropagation()} className="modal-sheet" style={{ width: 640, maxWidth: "95vw", maxHeight: "88vh", background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 40px rgba(20,24,40,.25)", display: "flex", flexDirection: "column" }}>
        <div className="row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <IconFileImport size={18} color="var(--accent)" />
          <strong className="grow" style={{ fontWeight: 500 }}>Construir mundo com documentos</strong>
          <button onClick={onClose} disabled={busy} title="fechar" style={{ border: "none", background: "transparent" }}><IconX size={18} /></button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {result ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="card" style={{ borderColor: "var(--success)", background: "color-mix(in srgb, var(--success) 8%, var(--panel))" }}>
                <strong style={{ fontWeight: 500 }}>Pronto!</strong> Criei <strong>{result.cards}</strong> ficha{result.cards === 1 ? "" : "s"} e <strong>{result.relationships}</strong> conexõe{result.relationships === 1 ? "m" : "s"} a partir de {result.docs.length} documento{result.docs.length === 1 ? "" : "s"}.
              </div>
              <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em" }}>Fichas criadas</div>
              <div className="stack" style={{ gap: 4, maxHeight: 320, overflow: "auto" }}>
                {result.entities.map((e, i) => {
                  const m = typeMeta(e.type);
                  return (
                    <div key={i} className="row" style={{ gap: 8, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 8 }}>
                      <EntryIcon type={e.type} size={17} color={m.color} />
                      <span style={{ width: 120, fontSize: 12, color: m.color }}>{m.label}</span>
                      <strong className="grow" style={{ fontWeight: 500, fontSize: 14 }}>{e.title}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Suba vários <strong>.docx/.pdf</strong>. A IA lê tudo junto, entende documentos complementares (ex.: "Sistema de Magia" + "Níveis de Magia"), cria as fichas e já faz as conexões entre elas.
              </div>

              <div className="row" style={{ marginBottom: 6 }}>
                <span className="muted grow" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>1. Documentos ({files.length})</span>
                <input ref={fileRef} type="file" multiple accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
                <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                  <IconPlus size={14} /> Adicionar
                </button>
              </div>
              <div className="stack" style={{ gap: 4 }}>
                {files.length === 0 && <div className="muted" style={{ fontSize: 13, padding: "6px 0" }}>Nenhum arquivo ainda.</div>}
                {files.map((f, i) => (
                  <div key={i} className="row" style={{ gap: 8, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 8 }}>
                    <IconFileImport size={15} color="var(--muted)" />
                    <span className="grow" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{(f.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} disabled={busy} style={{ padding: "2px 5px", border: "none", background: "transparent", color: "var(--muted)" }}><IconTrash size={14} /></button>
                  </div>
                ))}
              </div>

              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", margin: "16px 0 6px" }}>2. Tipos presentes nos documentos</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ENTRY_TYPES.map((t) => {
                  const on = types.has(t);
                  const m = typeMeta(t);
                  return (
                    <button key={t} onClick={() => toggleType(t)} disabled={busy}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, fontSize: 13, border: `1px solid ${on ? m.color : "var(--border)"}`, background: on ? m.tint : "transparent", color: on ? m.color : "var(--muted)" }}>
                      <EntryIcon type={t} size={14} color={on ? m.color : "var(--muted)"} /> {m.label}
                    </button>
                  );
                })}
              </div>

              {error && <div style={{ color: "var(--danger)", marginTop: 12 }}>{error}</div>}
              {busy && <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>Lendo cada documento a fundo e conectando as fichas… bases grandes podem levar alguns minutos — pode deixar rodando.</div>}
            </>
          )}
        </div>

        <div className="row" style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
          <span className="muted grow" style={{ fontSize: 12 }}>em {projectName}</span>
          {result ? (
            <button className="primary" onClick={onDone}>Ver no quadro</button>
          ) : (
            <>
              <button onClick={onClose} disabled={busy}>Cancelar</button>
              <button className="primary" onClick={run} disabled={busy || files.length === 0 || types.size === 0}>
                {busy ? "Processando…" : `Processar ${files.length} documento${files.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
