import { useState } from "react";
import { api } from "../../lib/api";
import { TYPE_TEMPLATES, type Field } from "../../lib/templates";
import type { EntryType } from "../../lib/types";

export function DetailsTab({ entryId, type, initialMetadata }: { entryId: string; type: string; initialMetadata: Record<string, unknown> }) {
  const fields: Field[] = TYPE_TEMPLATES[type as EntryType] ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = initialMetadata?.[f.key] != null ? String(initialMetadata[f.key]) : "";
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const set = (k: string, val: string) => setValues((v) => ({ ...v, [k]: val }));

  async function save() {
    setSaving(true);
    try {
      // mescla com o metadata existente (preserva chaves fora do template)
      const metadata: Record<string, unknown> = { ...initialMetadata };
      for (const f of fields) {
        if (values[f.key]?.trim()) metadata[f.key] = f.kind === "number" ? Number(values[f.key]) : values[f.key];
        else delete metadata[f.key];
      }
      await api.patch(`/entries/${entryId}`, { metadata });
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setSaving(false);
    }
  }

  if (fields.length === 0) {
    return <p className="muted">Este tipo não tem campos específicos — use a aba <strong>Conteúdo</strong>.</p>;
  }

  return (
    <div className="stack">
      {fields.map((f) => (
        <div key={f.key} className="stack" style={{ gap: 4 }}>
          <label className="muted" style={{ fontSize: 13 }}>{f.label}</label>
          {f.kind === "textarea" ? (
            <textarea value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} rows={2} />
          ) : f.kind === "select" ? (
            <select value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">—</option>
              {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input type={f.kind === "number" ? "number" : "text"} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} />
          )}
        </div>
      ))}
      <div className="row">
        <span className="grow" />
        {savedAt && <span className="muted" style={{ fontSize: 12 }}>salvo {savedAt}</span>}
        <button className="primary" onClick={save} disabled={saving}>{saving ? "…" : "Salvar detalhes"}</button>
      </div>
    </div>
  );
}
