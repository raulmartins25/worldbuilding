import type { CSSProperties } from "react";
import {
  IconUser, IconBuildingCastle, IconCrown, IconUsers, IconSword, IconSparkles,
  IconUsersGroup, IconFlame, IconFlare, IconBuildingChurch, IconFlag, IconBook,
  IconLanguage, IconMovie, IconBook2, IconNote, type Icon,
} from "@tabler/icons-react";
import type { EntryType } from "./types";

// tipo → ícone Tabler outline (pares do brief; extras mapeados por afinidade)
const MAP: Record<EntryType, Icon> = {
  character: IconUser,
  location: IconBuildingCastle,
  region: IconCrown,
  faction: IconUsers,
  item: IconSword,
  magic_system: IconSparkles,
  species: IconUsersGroup,
  creature: IconFlame,
  deity: IconFlare,
  religion: IconBuildingChurch,
  event: IconFlag,
  lore: IconBook,
  language: IconLanguage,
  scene: IconMovie,
  chapter: IconBook2,
  note: IconNote,
};

export function EntryIcon({ type, size = 24, color, style }: { type: string; size?: number; color?: string; style?: CSSProperties }) {
  const Icon = MAP[type as EntryType] ?? IconNote;
  return <Icon size={size} color={color} stroke={1.75} style={{ display: "block", flexShrink: 0, ...style }} />;
}
