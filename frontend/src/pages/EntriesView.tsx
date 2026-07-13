import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { ENTRY_TYPES, type Entry, type EntryType } from "../lib/types";

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
        <select style={{ width: 180 }} value={type} onChange={(e) => setType(e.target.value as EntryType)}>
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="grow" placeholder="Título da nova entry…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="primary">Adicionar</button>
      </form>

      <div className="row" style={{ marginTop: "1rem" }}>
        <span className="muted">Filtrar:</span>
        <select style={{ width: 200 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">todos os tipos</option>
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="stack" style={{ marginTop: "1rem" }}>
        {entries.length === 0 && <p className="muted">Nenhuma entry ainda.</p>}
        {entries.map((en) => (
          <div key={en.id} className="card row">
            <span className="muted" style={{ width: 120, fontSize: 13 }}>{en.type}</span>
            <strong className="grow">{en.title}</strong>
            <span className="muted" style={{ fontSize: 13 }}>{en.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
