import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Row { key: string; value: string; unit: string; }

export function AttributesTab({ entryId }: { entryId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ attributes: { key: string; value: string | null; unit: string | null }[] }>(`/entries/${entryId}/attributes`)
      .then((r) => setRows(r.attributes.map((a) => ({ key: a.key, value: a.value ?? "", unit: a.unit ?? "" }))));
  }, [entryId]);

  const upd = (i: number, f: keyof Row, v: string) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)));
  const add = () => setRows((rs) => [...rs, { key: "", value: "", unit: "" }]);
  const remove = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  async function save() {
    setSaving(true);
    try {
      const payload = rows.filter((r) => r.key.trim()).map((r) => ({
        key: r.key.trim(), value: r.value || undefined, unit: r.unit || undefined,
      }));
      await api.put(`/entries/${entryId}/attributes`, payload);
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      {rows.length === 0 && <p className="muted">Nenhum atributo. Ex.: idade, elemento, alinhamento…</p>}
      {rows.map((r, i) => (
        <div key={i} className="row">
          <input placeholder="chave" value={r.key} onChange={(e) => upd(i, "key", e.target.value)} style={{ width: 120 }} />
          <input placeholder="valor" value={r.value} onChange={(e) => upd(i, "value", e.target.value)} className="grow" />
          <input placeholder="un." value={r.unit} onChange={(e) => upd(i, "unit", e.target.value)} style={{ width: 60 }} />
          <button onClick={() => remove(i)} title="remover">×</button>
        </div>
      ))}
      <div className="row">
        <button onClick={add}>+ atributo</button>
        <span className="grow" />
        {savedAt && <span className="muted" style={{ fontSize: 12 }}>salvo {savedAt}</span>}
        <button className="primary" onClick={save} disabled={saving}>{saving ? "…" : "Salvar atributos"}</button>
      </div>
    </div>
  );
}
