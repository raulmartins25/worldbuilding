import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { typeMeta, relLabel } from "../../lib/entryTypes";

interface Rel { id: string; sourceId: string; targetId: string; type: string; label: string | null; }
interface E { id: string; title: string; type: string; }

const REL_TYPES = ["aliado_de", "inimigo_de", "pai_de", "mae_de", "casado_com", "governa", "pertence_a", "aparece_em"];

export function RelationsTab({ entryId, projectId }: { entryId: string; projectId: string }) {
  const [rels, setRels] = useState<Rel[]>([]);
  const [entries, setEntries] = useState<E[]>([]);
  const [target, setTarget] = useState("");
  const [type, setType] = useState(REL_TYPES[0]);

  const load = useCallback(async () => {
    const [r, es] = await Promise.all([
      api.get<{ relationships: Rel[] }>(`/entries/${entryId}/relationships`),
      api.get<{ entries: E[] }>(`/projects/${projectId}/entries`),
    ]);
    setRels(r.relationships);
    setEntries(es.entries.filter((e) => e.id !== entryId));
  }, [entryId, projectId]);
  useEffect(() => { void load(); }, [load]);

  const titleOf = (id: string) => entries.find((e) => e.id === id)?.title ?? id.slice(0, 8);

  async function add() {
    if (!target) return;
    await api.post(`/projects/${projectId}/relationships`, { sourceId: entryId, targetId: target, type });
    setTarget("");
    await load();
  }
  const del = async (id: string) => { await api.del(`/relationships/${id}`); await load(); };

  return (
    <div className="stack">
      {rels.length === 0 && <p className="muted">Sem relações. Crie aqui ou conectando cards no canvas.</p>}
      {rels.map((r) => {
        const outgoing = r.sourceId === entryId;
        const other = outgoing ? r.targetId : r.sourceId;
        return (
          <div key={r.id} className="card row" style={{ padding: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>{outgoing ? "→" : "←"}</span>
            <span className="grow"><strong>{titleOf(other)}</strong> <span className="muted">· {relLabel(r.type)}</span></span>
            <button onClick={() => del(r.id)}>×</button>
          </div>
        );
      })}
      <div className="row" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 150 }}>
          {REL_TYPES.map((t) => <option key={t} value={t}>{relLabel(t)}</option>)}
        </select>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="grow">
          <option value="">— alvo —</option>
          {entries.map((e) => <option key={e.id} value={e.id}>{typeMeta(e.type).icon} {e.title}</option>)}
        </select>
        <button className="primary" onClick={add} disabled={!target}>+</button>
      </div>
    </div>
  );
}
