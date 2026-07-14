import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { ENTRY_TYPES, type Entry, type EntryType } from "../lib/types";
import { typeMeta, STATUS_LABEL } from "../lib/entryTypes";

export function EntriesView({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<EntryType>("character");
  const [filter, setFilter] = useState<string>("");

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

  return (
    <div style={{ padding: "1.5rem", overflow: "auto", height: "100%" }}>
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
            <div key={en.id} className="card row" style={{ borderLeft: `4px solid ${m.color}` }}>
              <span style={{ fontSize: 20 }}>{m.icon}</span>
              <span className="muted" style={{ width: 130, fontSize: 13 }}>{m.label}</span>
              <strong className="grow">{en.title}</strong>
              <span className="muted" style={{ fontSize: 13 }}>{STATUS_LABEL[en.status] ?? en.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
