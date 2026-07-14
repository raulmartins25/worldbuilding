import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { entries } from "../db/schema";
import { requireEntry, requireProject } from "../lib/guard";
import { embedEntry } from "../lib/embedding";

const ENTRY_TYPES = [
  "character", "location", "region", "faction", "item", "magic_system",
  "species", "creature", "deity", "religion", "event", "lore",
  "language", "scene", "chapter", "note",
] as const;

const createBody = z.object({
  type: z.enum(ENTRY_TYPES),
  title: z.string().min(1),
  summary: z.string().optional(),
  body: z.record(z.any()).optional(),
  coverUrl: z.string().url().optional(),
  importance: z.number().int().min(0).max(5).optional(),
  status: z.enum(["draft", "canon", "archived"]).optional(),
  metadata: z.record(z.any()).optional(),
});

const updateBody = createBody.partial().omit({ type: true }).extend({
  type: z.enum(ENTRY_TYPES).optional(),
});

export async function entryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // listar entries do projeto (filtros: type, status, q)
  app.get("/projects/:pid/entries", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const q = req.query as { type?: string; status?: string; q?: string };

    const filters = [eq(entries.projectId, pid)];
    if (q.type) filters.push(eq(entries.type, q.type as (typeof ENTRY_TYPES)[number]));
    if (q.status) filters.push(eq(entries.status, q.status as "draft" | "canon" | "archived"));
    if (q.q) filters.push(ilike(entries.title, `%${q.q}%`));

    const rows = await db
      .select()
      .from(entries)
      .where(and(...filters))
      .orderBy(desc(entries.updatedAt))
      .limit(500);
    return { entries: rows };
  });

  app.post("/projects/:pid/entries", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const body = createBody.parse(req.body);
    const [entry] = await db
      .insert(entries)
      .values({
        userId: req.user.sub,
        projectId: pid,
        type: body.type,
        title: body.title,
        summary: body.summary,
        body: body.body ?? {},
        coverUrl: body.coverUrl,
        importance: body.importance ?? 0,
        status: body.status ?? "draft",
        metadata: body.metadata ?? {},
      })
      .returning();
    void embedEntry(entry.id).catch(() => {});
    return reply.code(201).send({ entry });
  });

  // busca híbrida (fulltext agora; vetorial/RAG entra quando a IA chegar)
  app.post("/projects/:pid/entries/search", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { q } = z.object({ q: z.string().min(1) }).parse(req.body);
    const rows = await db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.projectId, pid),
          sql`search @@ plainto_tsquery('simple', ${q})`,
        ),
      )
      .limit(50);
    return { entries: rows };
  });

  app.get("/entries/:id", async (req) => {
    const { id } = req.params as { id: string };
    const entry = await requireEntry(req.user.sub, id);
    return { entry };
  });

  app.patch("/entries/:id", async (req) => {
    const { id } = req.params as { id: string };
    await requireEntry(req.user.sub, id);
    const body = updateBody.parse(req.body);
    const [entry] = await db.update(entries).set(body).where(eq(entries.id, id)).returning();
    void embedEntry(entry.id).catch(() => {});
    return { entry };
  });

  app.delete("/entries/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await requireEntry(req.user.sub, id);
    await db.delete(entries).where(eq(entries.id, id));
    return reply.code(204).send();
  });
}
