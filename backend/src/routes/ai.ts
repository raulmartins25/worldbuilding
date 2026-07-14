import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { entries, relationships, memberships, attributes, aiChecks } from "../db/schema";
import { httpError, requireProject } from "../lib/guard";
import { aiEnabled, embed, chat } from "../lib/openai";
import { embedEntry } from "../lib/embedding";

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
}
