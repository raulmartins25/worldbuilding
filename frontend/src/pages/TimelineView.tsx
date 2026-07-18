import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { useIsMobile } from "../lib/useIsMobile";
import { EntryDrawer } from "./EntryDrawer";
import type { Entry } from "../lib/types";

interface TEvent { id: string; title: string; startValue: number; color: string | null; entryId: string | null; }

export function TimelineView({ projectId }: { projectId: string }) {
  const mobile = useIsMobile();
  const LABEL_W = mobile ? 104 : 168;
  const [events, setEvents] = useState<TEvent[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [flagged, setFlagged] = useState<Set<string>>(new Set()); // títulos em contradição (IA)
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("#7c5cff");
  const [entryId, setEntryId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ev, es, ck] = await Promise.all([
      api.get<{ events: TEvent[] }>(`/projects/${projectId}/timeline`),
      api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries`),
      api.get<{ checks: { payload: { entries?: string[] } }[] }>(`/projects/${projectId}/ai/checks?status=open`).catch(() => ({ checks: [] })),
    ]);
    setEvents(ev.events);
    setEntries(es.entries);
    const f = new Set<string>();
    for (const c of ck.checks) for (const t of c.payload?.entries ?? []) f.add(t.toLowerCase());
    setFlagged(f);
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
  const del = async (id: string) => { await api.del(`/timeline-events/${id}`); await load(); };

  const entryMap = Object.fromEntries(entries.map((e) => [e.id, e]));
  const min = events.length ? Math.min(...events.map((e) => e.startValue)) : 0;
  const max = events.length ? Math.max(...events.map((e) => e.startValue)) : 1;
  const span = max - min || 1;
  const laneW = Math.max(640, Math.min(2400, span * 12));
  const posX = (v: number) => ((v - min) / span) * (laneW - 40) + 20;

  // trilhas: uma por entidade (entryId), + "Sem ficha"
  const groups = new Map<string, TEvent[]>();
  for (const e of events) { const k = e.entryId ?? "__none__"; (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); }
  const tracks = [...groups.entries()]
    .map(([key, evs]) => ({ key, evs, first: Math.min(...evs.map((e) => e.startValue)) }))
    .sort((a, b) => a.first - b.first);

  const isConflict = (ev: TEvent) => {
    const t = entryMap[ev.entryId ?? ""]?.title?.toLowerCase();
    return flagged.has(ev.title.toLowerCase()) || (t ? flagged.has(t) : false);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <form className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }} onSubmit={add}>
        <input placeholder="Evento (ex.: Batalha de Vharn)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: mobile ? "1 1 100%" : "0 0 220px", width: mobile ? "100%" : 220 }} />
        <input placeholder="Ano" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: mobile ? 80 : 90 }} inputMode="numeric" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="cor" style={{ width: 42, padding: 2 }} />
        <select value={entryId} onChange={(e) => setEntryId(e.target.value)} style={{ flex: mobile ? 1 : "0 0 200px", width: mobile ? undefined : 200 }}>
          <option value="">— trilha geral —</option>
          {entries.map((en) => <option key={en.id} value={en.id}>{typeMeta(en.type).icon} {en.title}</option>)}
        </select>
        <button className="primary" style={mobile ? { flex: "1 1 100%" } : undefined}>+ Evento</button>
      </form>

      {mobile && events.length > 0 && (
        <div className="muted" style={{ fontSize: 12, padding: "6px 12px 0", display: "flex", alignItems: "center", gap: 6 }}>← deslize para percorrer os anos →</div>
      )}
      <div style={{ flex: 1, overflow: "auto", padding: mobile ? "0.5rem" : "1rem", WebkitOverflowScrolling: "touch" }}>
        {events.length === 0 ? (
          <p className="muted">Sem eventos. Adicione o primeiro (título + ano + trilha).</p>
        ) : (
          <div style={{ minWidth: LABEL_W + laneW }}>
            {/* eixo */}
            <div className="row" style={{ marginBottom: 6 }}>
              <div style={{ width: LABEL_W }} />
              <div style={{ width: laneW, position: "relative", height: 18 }}>
                <span className="muted" style={{ position: "absolute", left: 0, fontSize: 12 }}>Ano {min}</span>
                <span className="muted" style={{ position: "absolute", right: 0, fontSize: 12 }}>Ano {max}</span>
              </div>
            </div>
            {tracks.map((tr) => {
              const ent = tr.key === "__none__" ? null : entryMap[tr.key];
              const meta = ent ? typeMeta(ent.type) : { color: "var(--muted)", label: "Geral" };
              return (
                <div key={tr.key} className="row" style={{ alignItems: "stretch", borderTop: "1px solid var(--border)" }}>
                  <div className="row" style={{ width: LABEL_W, gap: 6, padding: "8px 4px" }}>
                    {ent ? <EntryIcon type={ent.type} size={16} color={meta.color} /> : <span style={{ width: 16 }} />}
                    <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      onClick={() => ent && setOpenId(ent.id)} title={ent?.title ?? "Trilha geral"}>
                      {ent?.title ?? "Trilha geral"}
                    </span>
                  </div>
                  <div style={{ width: laneW, position: "relative", minHeight: 58 }}>
                    <div style={{ position: "absolute", top: 28, left: 0, right: 0, height: 2, background: "var(--border)" }} />
                    {tr.evs.map((ev) => {
                      const c = ev.color ?? (ent ? meta.color : "var(--accent)");
                      const conflict = isConflict(ev);
                      return (
                        <div key={ev.id} style={{ position: "absolute", left: posX(ev.startValue), top: 6, transform: "translateX(-50%)" }}>
                          <div style={{ position: "absolute", left: "50%", top: 20, width: 11, height: 11, borderRadius: 999, background: c, transform: "translateX(-50%)", border: "2px solid var(--bg)" }} />
                          <div className="card" style={{ padding: "4px 8px", width: 140, borderTop: `3px solid ${conflict ? "var(--warn-strong)" : c}`, position: "relative" }}>
                            {conflict && <span title="Conflito (ver central de IA)" style={{ position: "absolute", top: 3, right: 4, width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "8px solid var(--warn-strong)" }} />}
                            <div className="muted" style={{ fontSize: 10 }}>Ano {ev.startValue}</div>
                            <div className="row">
                              <strong className="grow" style={{ fontSize: 12, fontWeight: 500 }}>{ev.title}</strong>
                              <button onClick={() => del(ev.id)} style={{ padding: "0 3px", border: "none", background: "transparent", color: "var(--muted)" }}>×</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
