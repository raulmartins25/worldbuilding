import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Tag { id: string; name: string; color: string | null; }

export function TagsTab({ entryId, projectId }: { entryId: string; projectId: string }) {
  const [all, setAll] = useState<Tag[]>([]);
  const [attached, setAttached] = useState<Tag[]>([]);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    const [a, at] = await Promise.all([
      api.get<{ tags: Tag[] }>(`/projects/${projectId}/tags`),
      api.get<{ tags: Tag[] }>(`/entries/${entryId}/tags`),
    ]);
    setAll(a.tags);
    setAttached(at.tags);
  }, [entryId, projectId]);

  useEffect(() => { void load(); }, [load]);

  const attachedIds = new Set(attached.map((t) => t.id));
  const available = all.filter((t) => !attachedIds.has(t.id));

  const attach = async (tagId: string) => { await api.post(`/entries/${entryId}/tags`, { tagId }); await load(); };
  const detach = async (tagId: string) => { await api.del(`/entries/${entryId}/tags/${tagId}`); await load(); };

  async function createAndAttach() {
    const name = newName.trim();
    if (!name) return;
    await api.post(`/projects/${projectId}/tags`, { name });
    setNewName("");
    const a = await api.get<{ tags: Tag[] }>(`/projects/${projectId}/tags`);
    const tag = a.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (tag && !attachedIds.has(tag.id)) await api.post(`/entries/${entryId}/tags`, { tagId: tag.id });
    await load();
  }

  return (
    <div className="stack">
      <div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Tags da entry</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {attached.length === 0 && <span className="muted">nenhuma</span>}
          {attached.map((t) => (
            <span key={t.id} className="row" style={{ gap: 4, padding: "2px 8px", borderRadius: 999, background: "var(--panel-2)", border: `1px solid ${t.color ?? "var(--border)"}` }}>
              {t.name}
              <button onClick={() => detach(t.id)} style={{ padding: "0 4px", border: "none", background: "transparent", color: "var(--muted)" }}>×</button>
            </span>
          ))}
        </div>
      </div>

      {available.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Adicionar existente</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {available.map((t) => (
              <button key={t.id} onClick={() => attach(t.id)} style={{ borderRadius: 999 }}>+ {t.name}</button>
            ))}
          </div>
        </div>
      )}

      <div className="row">
        <input placeholder="nova tag…" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void createAndAttach(); }} className="grow" />
        <button className="primary" onClick={createAndAttach}>criar + anexar</button>
      </div>
    </div>
  );
}
