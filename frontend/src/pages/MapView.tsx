import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { api } from "../lib/api";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";
import { EntryDrawer } from "./EntryDrawer";
import type { Entry } from "../lib/types";

interface WMap { id: string; name: string; imageUrl: string; }
interface Pin { id: string; entryId: string | null; x: number; y: number; label: string | null; color: string | null; }

export function MapView({ projectId }: { projectId: string }) {
  const [maps, setMaps] = useState<WMap[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [addMode, setAddMode] = useState(false);
  const [pinEntry, setPinEntry] = useState("");
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const entryById = Object.fromEntries(entries.map((e) => [e.id, e]));

  const loadMaps = useCallback(async () => {
    const [m, es] = await Promise.all([
      api.get<{ maps: WMap[] }>(`/projects/${projectId}/maps`),
      api.get<{ entries: Entry[] }>(`/projects/${projectId}/entries`),
    ]);
    setMaps(m.maps);
    setEntries(es.entries);
    setSelId((cur) => cur ?? m.maps[0]?.id ?? null);
  }, [projectId]);

  const loadMap = useCallback(async (id: string) => {
    const r = await api.get<{ map: WMap; pins: Pin[] }>(`/maps/${id}`);
    setPins(r.pins);
  }, []);

  useEffect(() => { void loadMaps(); }, [loadMaps]);
  useEffect(() => { if (selId) void loadMap(selId); }, [selId, loadMap]);

  const selMap = maps.find((m) => m.id === selId);

  async function createMap(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !imageUrl.trim()) return;
    const r = await api.post<{ map: WMap }>(`/projects/${projectId}/maps`, { name: name.trim(), imageUrl: imageUrl.trim() });
    setName(""); setImageUrl("");
    await loadMaps();
    setSelId(r.map.id);
  }

  async function onImgClick(ev: MouseEvent) {
    if (!addMode || !selId || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
    await api.post(`/maps/${selId}/pins`, { x, y, entryId: pinEntry || undefined, label: pinEntry ? undefined : "Ponto" });
    await loadMap(selId);
  }

  async function delPin(id: string) {
    await api.del(`/map-pins/${id}`);
    if (selId) await loadMap(selId);
  }

  if (maps.length === 0) {
    return (
      <div style={{ maxWidth: 520, margin: "3rem auto", padding: "0 1rem" }}>
        <h2>Mapa cartográfico</h2>
        <p className="muted">Crie um mapa colando a URL de uma imagem (mapa do seu mundo).</p>
        <form className="stack" onSubmit={createMap}>
          <input placeholder="Nome do mapa" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="URL da imagem (https://…)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          <button className="primary">Criar mapa</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <select value={selId ?? ""} onChange={(e) => setSelId(e.target.value)} style={{ width: 180 }}>
          {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button className={addMode ? "primary" : ""} onClick={() => setAddMode((v) => !v)}>
          {addMode ? "Clique no mapa para fixar…" : "+ Adicionar pino"}
        </button>
        {addMode && (
          <select value={pinEntry} onChange={(e) => setPinEntry(e.target.value)} style={{ width: 200 }}>
            <option value="">— pino sem ficha —</option>
            {entries.map((en) => <option key={en.id} value={en.id}>{typeMeta(en.type).icon} {en.title}</option>)}
          </select>
        )}
        <span className="grow" />
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>novo mapa</summary>
          <form className="row" style={{ marginTop: 6 }} onSubmit={createMap}>
            <input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 110 }} />
            <input placeholder="URL da imagem" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={{ width: 160 }} />
            <button className="primary">Criar</button>
          </form>
        </details>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
          <img
            ref={imgRef} src={selMap?.imageUrl} alt={selMap?.name}
            onClick={onImgClick}
            style={{ maxWidth: "100%", display: "block", borderRadius: 8, cursor: addMode ? "crosshair" : "default" }}
          />
          {pins.map((p) => {
            const entry = p.entryId ? entryById[p.entryId] : undefined;
            const color = p.color ?? (entry ? typeMeta(entry.type).color : "var(--accent)");
            return (
              <div key={p.id}
                style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%,-100%)", zIndex: 2 }}>
                <button
                  onClick={() => (p.entryId ? setOpenId(p.entryId) : undefined)}
                  title={entry?.title ?? p.label ?? "pino"}
                  style={{ padding: "2px 6px", borderRadius: 999, background: "var(--panel)", border: `2px solid ${color}`, display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                  {entry ? <EntryIcon type={entry.type} size={14} color={color} /> : <span style={{ color }}>📍</span>}
                  {entry?.title ?? p.label}
                </button>
                <button onClick={() => delPin(p.id)} title="remover" style={{ marginLeft: 2, padding: "0 4px", border: "none", background: "transparent", color: "var(--muted)" }}>×</button>
              </div>
            );
          })}
        </div>
      </div>

      {openId && <EntryDrawer entryId={openId} projectId={projectId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
