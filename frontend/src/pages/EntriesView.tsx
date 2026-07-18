import { useEffect, useState, type FormEvent } from "react";
import { IconTrash } from "@tabler/icons-react";
import { api } from "../lib/api";
import { ENTRY_TYPES, type Entry, type EntryType } from "../lib/types";
import { typeMeta, STATUS_LABEL } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { EntryDrawer } from "./EntryDrawer";

export function EntriesView({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<EntryType>("character");
  const [filter, setFilter] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    const qs = filter ? `?type=${filter}` : "";
    const r = await api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries${qs}`);
    setEntries(r.entries);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filter]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api.post(`/projects/${projectId}/entries`, { type, title });
    setTitle("");
    void load();
  }

  async function remove(en: Entry) {
    if (!confirm(`Excluir a ficha "${en.title}"? Isso remove o card, relações e menções dela. Não dá pra desfazer.`)) return;
    await api.del(`/entries/${en.id}`);
    if (openId === en.id) setOpenId(null);
    void load();
  }

  return (
    <div style={{ padding: "1.5rem", overflow: "auto", height: "100%", position: "relative" }}>
      <form className="row" onSubmit={create}>
        <select style={{ width: 200 }} value={type} onChange={(e) => setType(e.target.value as EntryType)}>
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{typeMeta(t).icon} {typeMeta(t).label}</option>)}
        </select>
        <input className="grow" placeholder="Título da nova ficha…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="primary">Adicionar</button>
      </form>

      <div className="row" style={{ marginTop: "1rem" }}>
        <span className="muted">Filtrar:</span>
        <select style={{ width: 220 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos os tipos</option>
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{typeMeta(t).icon} {typeMeta(t).label}</option>)}
        </select>
      </div>

      <div className="stack" style={{ marginTop: "1rem" }}>
        {entries.length === 0 && <p className="muted">Nenhuma ficha ainda.</p>}
        {entries.map((en) => {
          const m = typeMeta(en.type);
          return (
            <div key={en.id} className="card row" style={{ borderLeft: `4px solid ${m.color}`, cursor: "pointer" }}
              onClick={() => setOpenId(en.id)} title="abrir / editar">
              <EntryIcon type={en.type} size={22} color={m.color} />
              <span style={{ width: 140, fontSize: 12, fontWeight: 500, color: m.color }}>{m.label}</span>
              <strong className="grow" style={{ fontWeight: 500 }}>{en.title}</strong>
              <span style={{ fontSize: 12, padding: "1px 8px", borderRadius: 999, background: m.tint, color: m.ink }}>{STATUS_LABEL[en.status] ?? en.status}</span>
              <button onClick={(e) => { e.stopPropagation(); void remove(en); }} title="excluir ficha"
                style={{ padding: "3px 6px", border: "none", background: "transparent", color: "var(--muted)" }}>
                <IconTrash size={16} />
              </button>
            </div>
          );
        })}
      </div>

      {openId && <EntryDrawer key={openId} entryId={openId} projectId={projectId} onClose={() => { setOpenId(null); void load(); }} />}
    </div>
  );
}
