import { eq } from "drizzle-orm";
import { db } from "../db";
import { entries } from "../db/schema";
import { aiEnabled, embed } from "./openai";

// extrai texto puro de um doc Tiptap (JSON)
function textFromDoc(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) return n.content.map(textFromDoc).join(" ");
  return "";
}

export function buildEntryText(e: { title: string; summary: string | null; body: unknown }): string {
  return [e.title, e.summary ?? "", textFromDoc(e.body)].filter((s) => s && s.trim()).join("\n").trim();
}

/** Gera e grava o embedding de uma entry. Best-effort: no-op se a IA não estiver configurada. */
export async function embedEntry(entryId: string): Promise<boolean> {
  if (!aiEnabled()) return false;
  const [e] = await db.select().from(entries).where(eq(entries.id, entryId));
  if (!e) return false;
  const text = buildEntryText(e);
  if (!text) return false;
  const vec = await embed(text);
  await db.update(entries).set({ embedding: vec }).where(eq(entries.id, entryId));
  return true;
}
