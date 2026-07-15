import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { typeMeta } from "../lib/entryTypes";
import { EntryDrawer } from "./EntryDrawer";
import type { Entry } from "../lib/types";

interface TEvent {
  id: string; title: string; description: string | null;
  startValue: number; color: string | null; entryId: string | null;
}

export function TimelineView({ projectId }: { projectId: string }) {
  const [events, setEvents] = useState<TEvent[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("#7c5cff");
  const [entryId, setEntryId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ev, es] = await Promise.all([
      api.get<{ events: TEvent[] }>(`/projects/${projectId}/timeline`),
      api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries`),
    ]);
    setEvents(ev.events);
    setEntries(es.entries);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const y = parseInt(year, 10);
    if (!title.trim() || Number.isNaN(y)) return;
    await api.post(`/projects/${projectId}/timeline`, { title: title.trim(), startValue: y, color, entryId: entryId || undefined });
    setTitle(""); setYear("");
    await load();
  }
  async function del(id: string) {
    await api.del(`/timeline-events/${id}`);
    await load();
  }

  const min = events.length ? Math.min(...events.map((e) => e.startValue)) : 0;
  const max = events.length ? Math.max(...events.map((e) => e.startValue)) : 1;
  const span = max - min || 1;
  const posOf = (v: number) => ((v - min) / span) * 100;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <form className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }} onSubmit={add}>
        <input placeholder="Evento (ex.: Batalha de Vharn)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: 220 }} />
        <input placeholder="Ano" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 90 }} inputMode="numeric" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="cor" style={{ width: 42, padding: 2 }} />
        <select value={entryId} onChange={(e) => setEntryId(e.target.value)} style={{ width: 190 }}>
          <option value="">— sem ficha —</option>
          {entries.map((en) => <option key={en.id} value={en.id}>{typeMeta(en.type).icon} {en.title}</option>)}
        </select>
        <button className="primary">+ Evento</button>
      </form>

      <div style={{ flex: 1, overflow: "auto", padding: "2.5rem 1.5rem" }}>
        {events.length === 0 ? (
          <p className="muted">Sem eventos. Adicione o primeiro acima (título + ano).</p>
        ) : (
          <div style={{ position: "relative", minHeight: 320, minWidth: Math.max(600, events.length * 120) }}>
            {/* eixo */}
            <div style={{ position: "absolute", top: 150, left: 0, right: 0, height: 2, background: "var(--border)" }} />
            <div style={{ position: "absolute", top: 158, left: 0, fontSize: 12, color: "var(--muted)" }}>Ano {min}</div>
            <div style={{ position: "absolute", top: 158, right: 0, fontSize: 12, color: "var(--muted)" }}>Ano {max}</div>
            {events.map((ev, i) => {
              const up = i % 2 === 0;
              const c = ev.color ?? "var(--accent)";
              const entry = ev.entryId ? entries.find((e) => e.id === ev.entryId) : undefined;
              return (
                <div key={ev.id} style={{ position: "absolute", left: `${posOf(ev.startValue)}%`, top: 150, transform: "translateX(-50%)" }}>
                  {/* haste */}
                  <div style={{ position: "absolute", left: "50%", top: up ? -60 : 2, width: 2, height: 60, background: c, transform: "translateX(-50%)" }} />
                  {/* ponto */}
                  <div style={{ position: "absolute", left: "50%", top: -5, width: 12, height: 12, borderRadius: 999, background: c, transform: "translateX(-50%)", border: "2px solid var(--bg)" }} />
                  {/* card */}
                  <div className="card" style={{ position: "absolute", left: "50%", top: up ? -140 : 64, transform: "translateX(-50%)", width: 150, padding: 8, borderTop: `3px solid ${c}` }}>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>Ano {ev.startValue}</div>
                    <div className="row">
                      <strong className="grow" style={{ fontSize: 13, cursor: entry ? "pointer" : "default" }}
                        onClick={() => entry && setOpenId(entry.id)}>{ev.title}</strong>
                      <button onClick={() => del(ev.id)} style={{ padding: "0 4px", border: "none", background: "transparent", color: "var(--muted)" }}>×</button>
                    </div>
                    {entry && <div className="muted" style={{ fontSize: 11 }}>{typeMeta(entry.type).icon} {entry.title}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {openId && <EntryDrawer key={openId} entryId={openId} projectId={projectId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
