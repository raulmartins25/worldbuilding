import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { entries, relationships, memberships, attributes, aiChecks } from "../db/schema";
import { httpError, requireEntry, requireProject } from "../lib/guard";
import { aiEnabled, embed, chat } from "../lib/openai";
import { embedEntry, buildEntryText } from "../lib/embedding";

// monta um retrato textual compacto do mundo para a IA
async function buildProjectContext(pid: string): Promise<{ text: string; titleById: Record<string, string> }> {
  const es = await db.select().from(entries).where(eq(entries.projectId, pid));
  const attrs = await db.select().from(attributes).where(eq(attributes.projectId, pid));
  const rels = await db.select().from(relationships).where(eq(relationships.projectId, pid));
  const mems = await db.select().from(memberships).where(eq(memberships.projectId, pid));

  const titleById: Record<string, string> = Object.fromEntries(es.map((e) => [e.id, e.title]));
  const attrsByEntry: Record<string, string[]> = {};
  for (const a of attrs) (attrsByEntry[a.entryId] ??= []).push(`${a.key}=${a.value ?? ""}`);

  const lines: string[] = ["# Entries"];
  for (const e of es) {
    const at = attrsByEntry[e.id]?.length ? ` | atributos: ${attrsByEntry[e.id].join(", ")}` : "";
    lines.push(`- [${e.type}/${e.status}] ${e.title}: ${e.summary ?? "(sem resumo)"}${at}`);
  }
  if (rels.length) {
    lines.push("\n# Relações");
    for (const r of rels) lines.push(`- ${titleById[r.sourceId] ?? "?"} —${r.type}→ ${titleById[r.targetId] ?? "?"}`);
  }
  if (mems.length) {
    lines.push("\n# Contenção");
    for (const m of mems) lines.push(`- ${titleById[m.containerId] ?? "?"} contém ${titleById[m.memberId] ?? "?"}`);
  }
  return { text: lines.join("\n").slice(0, 14000), titleById };
}

// contexto de UMA entry (para entrevista): detalhes + atributos + relações + vizinhos RAG
async function buildEntryContext(entryId: string): Promise<{ entry: typeof entries.$inferSelect; text: string }> {
  const [entry] = await db.select().from(entries).where(eq(entries.id, entryId));
  const attrs = await db.select().from(attributes).where(eq(attributes.entryId, entryId));
  const rels = await db.select().from(relationships)
    .where(or(eq(relationships.sourceId, entryId), eq(relationships.targetId, entryId)));

  const otherIds = [...new Set(rels.flatMap((r) => [r.sourceId, r.targetId]).filter((id) => id !== entryId))];
  const others = otherIds.length
    ? await db.select({ id: entries.id, title: entries.title }).from(entries).where(inArray(entries.id, otherIds))
    : [];
  const titleById: Record<string, string> = Object.fromEntries(others.map((o) => [o.id, o.title]));
  titleById[entryId] = entry.title;

  const lines = [`# ${entry.title} (${entry.type}, ${entry.status})`, entry.summary ?? "", buildEntryText(entry)];
  if (attrs.length) lines.push("Atributos: " + attrs.map((a) => `${a.key}=${a.value ?? ""}`).join(", "));
  if (rels.length) {
    lines.push("Relações:");
    for (const r of rels) lines.push(`- ${titleById[r.sourceId] ?? "?"} —${r.type}→ ${titleById[r.targetId] ?? "?"}`);
  }

  // vizinhos semânticos para dar mundo ao personagem
  if (aiEnabled()) {
    try {
      const vec = await embed(buildEntryText(entry) || entry.title);
      const lit = `[${vec.join(",")}]`;
      const neighbors = await db.execute(sql`
        SELECT title, summary FROM entries
        WHERE project_id = ${entry.projectId} AND id <> ${entryId} AND embedding IS NOT NULL
        ORDER BY embedding <=> ${lit}::vector LIMIT 5
      `) as unknown as { title: string; summary: string | null }[];
      if (neighbors.length) {
        lines.push("\n# Mundo ao redor");
        for (const n of neighbors) lines.push(`- ${n.title}: ${n.summary ?? ""}`);
      }
    } catch { /* best-effort */ }
  }
  return { entry, text: lines.filter((l) => l && l.trim()).join("\n").slice(0, 12000) };
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/ai/status", async () => ({ enabled: aiEnabled() }));

  app.post("/projects/:pid/ai/reindex", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const rows = await db.select({ id: entries.id }).from(entries).where(eq(entries.projectId, pid));
    let ok = 0;
    for (const r of rows) if (await embedEntry(r.id)) ok++;
    return { reindexed: ok, total: rows.length };
  });

  app.post("/projects/:pid/ai/search", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { query, k } = z.object({ query: z.string().min(1), k: z.number().int().min(1).max(50).optional() }).parse(req.body);
    const qvec = await embed(query);
    const lit = `[${qvec.join(",")}]`;
    const rows = await db.execute(sql`
      SELECT id, title, type, summary, 1 - (embedding <=> ${lit}::vector) AS score
      FROM entries
      WHERE project_id = ${pid} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${k ?? 8}
    `);
    return { results: rows };
  });

  // roda a checagem de consistência: grava findings em ai_checks
  app.post("/projects/:pid/ai/check", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { text, titleById } = await buildProjectContext(pid);
    const titleToId: Record<string, string> = {};
    for (const [id, t] of Object.entries(titleById)) titleToId[t.toLowerCase()] = id;

    const raw = await chat([
      {
        role: "system",
        content:
          "Você é um editor de continuidade de mundos de fantasia. Analise o material e liste " +
          "INCONSISTÊNCIAS factuais/lógicas: personagem morto que reaparece, regra de magia contradita, " +
          "cronologia ou viagem impossível, relações contraditórias (ex.: X é pai e filho de Y), status " +
          "canônico vs rascunho conflitante, etc. Seja específico e conciso. Responda SOMENTE JSON no formato " +
          '{"findings":[{"title":"...","detail":"...","severity":"info|warning|critical","entries":["Título",...]}]}. ' +
          "Se não houver inconsistências, retorne {\"findings\":[]}.",
      },
      { role: "user", content: text },
    ], { json: true, temperature: 0.2 });

    let findings: { title: string; detail?: string; severity?: string; entries?: string[] }[] = [];
    try {
      const parsed = JSON.parse(raw) as { findings?: typeof findings };
      findings = parsed.findings ?? [];
    } catch {
      throw httpError(502, "ai_invalid_response");
    }

    const created = [];
    for (const f of findings) {
      const firstTitle = f.entries?.[0]?.toLowerCase();
      const entryId = firstTitle ? titleToId[firstTitle] ?? null : null;
      const sev = ["info", "warning", "critical"].includes(f.severity ?? "") ? f.severity! : "warning";
      const [row] = await db.insert(aiChecks).values({
        projectId: pid, entryId, kind: "inconsistency", severity: sev,
        title: f.title.slice(0, 200), detail: f.detail ?? null,
        payload: { entries: f.entries ?? [] }, status: "open",
      }).returning();
      created.push(row);
    }
    return { created, count: created.length };
  });

  app.get("/projects/:pid/ai/checks", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { status } = req.query as { status?: string };
    const filters = [eq(aiChecks.projectId, pid)];
    if (status === "open" || status === "ignored" || status === "resolved") filters.push(eq(aiChecks.status, status));
    const rows = await db.select().from(aiChecks).where(and(...filters)).orderBy(desc(aiChecks.createdAt));
    return { checks: rows };
  });

  app.patch("/ai-checks/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(aiChecks).where(eq(aiChecks.id, id));
    if (!existing) throw httpError(404, "check_not_found");
    await requireProject(req.user.sub, existing.projectId);
    const { status } = z.object({ status: z.enum(["open", "ignored", "resolved"]) }).parse(req.body);
    const [check] = await db.update(aiChecks)
      .set({ status, resolvedAt: status === "resolved" ? new Date() : null })
      .where(eq(aiChecks.id, id)).returning();
    return { check };
  });

  // entrevistar personagem: responde em 1ª pessoa a partir do contexto (RAG)
  app.post("/entries/:id/ai/interview", async (req) => {
    const { id } = req.params as { id: string };
    const entry = await requireEntry(req.user.sub, id);
    const { question } = z.object({ question: z.string().min(1) }).parse(req.body);
    const { text } = await buildEntryContext(id);
    const answer = await chat([
      {
        role: "system",
        content:
          `Você é ${entry.title}, um(a) ${entry.type} de um mundo de fantasia. Responda SEMPRE em ` +
          "primeira pessoa, incorporando o personagem (tom, voz, personalidade coerentes). Baseie-se no " +
          "CONTEXTO abaixo; se algo não estiver nele, pode improvisar de forma plausível SEM contradizer os " +
          "fatos dados. Nunca saia do personagem nem mencione que é uma IA.\n\nCONTEXTO:\n" + text,
      },
      { role: "user", content: question },
    ], { temperature: 0.85 });
    return { answer };
  });

  // sugerir ligações: a IA propõe novas relações; grava como ai_checks(kind=suggestion)
  app.post("/projects/:pid/ai/suggest-links", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { text } = await buildProjectContext(pid);
    const raw = await chat([
      {
        role: "system",
        content:
          "Analise o mundo e sugira NOVAS relações plausíveis entre entries que ainda não estão listadas, " +
          "com base em pistas do contexto. Responda SOMENTE JSON no formato " +
          '{"suggestions":[{"source":"Título","target":"Título","type":"aliado_de|inimigo_de|pai_de|mae_de|casado_com|governa|pertence_a|aparece_em","reason":"..."}]}. ' +
          "Máximo 8 sugestões, priorize as mais fundamentadas.",
      },
      { role: "user", content: text },
    ], { json: true, temperature: 0.5 });

    let suggestions: { source: string; target: string; type: string; reason?: string }[] = [];
    try {
      suggestions = (JSON.parse(raw).suggestions ?? []) as typeof suggestions;
    } catch {
      throw httpError(502, "ai_invalid_response");
    }
    for (const s of suggestions) {
      await db.insert(aiChecks).values({
        projectId: pid, kind: "suggestion", severity: "info",
        title: `${s.source} —${s.type}→ ${s.target}`, detail: s.reason ?? null,
        payload: { source: s.source, target: s.target, type: s.type }, status: "open",
      });
    }
    return { suggestions, count: suggestions.length };
  });
}
