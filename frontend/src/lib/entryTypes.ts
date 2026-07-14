import type { EntryType } from "./types";

export interface TypeMeta { label: string; icon: string; color: string; }

// identidade visual + rótulo PT-BR por tipo de entry
export const ENTRY_TYPE_META: Record<EntryType, TypeMeta> = {
  character:    { label: "Personagem",        icon: "🧙", color: "#7c5cff" },
  location:     { label: "Local",             icon: "🗼", color: "#4cc2ff" },
  region:       { label: "Reino / Região",    icon: "🏰", color: "#f0a020" },
  faction:      { label: "Facção",            icon: "⚔️", color: "#f85149" },
  item:         { label: "Item",              icon: "💎", color: "#39c5cf" },
  magic_system: { label: "Sistema de Magia",  icon: "✨", color: "#a371f7" },
  species:      { label: "Espécie",           icon: "🧬", color: "#3fb950" },
  creature:     { label: "Criatura",          icon: "🐉", color: "#db61a2" },
  deity:        { label: "Divindade",         icon: "🔱", color: "#f2cc60" },
  religion:     { label: "Religião",          icon: "⛩️", color: "#e3b341" },
  event:        { label: "Evento",            icon: "⚡", color: "#ff7b72" },
  lore:         { label: "Lenda / Saber",     icon: "📖", color: "#79c0ff" },
  language:     { label: "Idioma",            icon: "🗣️", color: "#56d364" },
  scene:        { label: "Cena",              icon: "🎬", color: "#bc8cff" },
  chapter:      { label: "Capítulo",          icon: "📜", color: "#d2a8ff" },
  note:         { label: "Nota",              icon: "📝", color: "#8b949e" },
};

export function typeMeta(t: string): TypeMeta {
  return ENTRY_TYPE_META[t as EntryType] ?? { label: t, icon: "▫️", color: "#8b949e" };
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  canon: "Canônico",
  archived: "Arquivado",
};

// rótulos PT para os tipos de relação (a chave armazenada continua a mesma)
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
