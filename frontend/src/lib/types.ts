export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  provider: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EntryType =
  | "character" | "location" | "region" | "faction" | "item" | "magic_system"
  | "species" | "creature" | "deity" | "religion" | "event" | "lore"
  | "language" | "scene" | "chapter" | "note";

export interface Entry {
  id: string;
  projectId: string;
  type: EntryType;
  title: string;
  summary: string | null;
  importance: number;
  status: "draft" | "canon" | "archived";
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export const ENTRY_TYPES: EntryType[] = [
  "character", "location", "region", "faction", "item", "magic_system",
  "species", "creature", "deity", "religion", "event", "lore",
  "language", "scene", "chapter", "note",
];
