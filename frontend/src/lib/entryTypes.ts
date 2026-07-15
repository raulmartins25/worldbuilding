import type { EntryType } from "./types";

// ── util de cor: mistura hex1→hex2 por t (0..1) ─────────────────────────────
function hexToRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const to = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${to(r1, r2)}${to(g1, g2)}${to(b1, b2)}`;
}
export const tintOf = (c: string) => mix(c, "#ffffff", 0.88);
export const borderOf = (c: string) => mix(c, "#ffffff", 0.45);
export const inkOf = (c: string) => mix(c, "#14171d", 0.34);

export interface TypeMeta { label: string; icon: string; color: string; tint: string; border: string; ink: string; }

// cor de destaque + rótulo PT + emoji (usado só nos <option>) por tipo
const BASE: Record<EntryType, { label: string; icon: string; color: string }> = {
  character:    { label: "Personagem",       icon: "🧙", color: "#D4537E" },
  location:     { label: "Local",            icon: "🗼", color: "#378ADD" },
  region:       { label: "Reino / Região",   icon: "🏰", color: "#3B5BDB" },
  faction:      { label: "Facção",           icon: "⚔️", color: "#BA7517" },
  item:         { label: "Item",             icon: "💎", color: "#5F5E5A" },
  magic_system: { label: "Sistema de Magia", icon: "✨", color: "#7F77DD" },
  species:      { label: "Espécie",          icon: "🧬", color: "#1D9E75" },
  creature:     { label: "Criatura",         icon: "🐉", color: "#D85A30" },
  deity:        { label: "Divindade",        icon: "🔱", color: "#534AB7" },
  religion:     { label: "Religião",         icon: "⛩️", color: "#534AB7" },
  event:        { label: "Evento",           icon: "⚡", color: "#0F6E56" },
  lore:         { label: "Lenda / Saber",    icon: "📖", color: "#9A6B3F" },
  language:     { label: "Idioma",           icon: "🗣️", color: "#227C9D" },
  scene:        { label: "Cena",             icon: "🎬", color: "#7048E8" },
  chapter:      { label: "Capítulo",         icon: "📜", color: "#5F3DC4" },
  note:         { label: "Nota",             icon: "📝", color: "#868E96" },
};

export function typeMeta(t: string): TypeMeta {
  const b = BASE[t as EntryType] ?? { label: t, icon: "▫️", color: "#868E96" };
  return { ...b, tint: tintOf(b.color), border: borderOf(b.color), ink: inkOf(b.color) };
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  canon: "Canônico",
  archived: "Arquivado",
};

export const REL_TYPE_LABEL: Record<string, string> = {
  aliado_de: "Aliado de",
  inimigo_de: "Inimigo de",
  pai_de: "Pai de",
  mae_de: "Mãe de",
  casado_com: "Casado(a) com",
  governa: "Governa",
  pertence_a: "Pertence a",
  aparece_em: "Aparece em",
};
export const relLabel = (t: string | null | undefined) => (t ? REL_TYPE_LABEL[t] ?? t : "");
