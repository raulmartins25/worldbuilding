import type { FastifyInstance } from "fastify";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { entries, relationships } from "../db/schema";
import { httpError, requireEntry, requireProject } from "../lib/guard";

const GENEALOGY_TYPES = ["pai_de", "mae_de", "filho_de", "casado_com", "irmao_de"];

const createBody = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: z.string().min(1),
  label: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export async function relationshipRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/projects/:pid/relationships", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { type } = req.query as { type?: string };
    const filters = [eq(relationships.projectId, pid)];
    if (type) filters.push(eq(relationships.type, type));
    const rows = await db.select().from(relationships).where(and(...filters));
    return { relationships: rows };
  });

  app.post("/projects/:pid/relationships", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const body = createBody.parse(req.body);
    if (body.sourceId === body.targetId) throw httpError(400, "source_equals_target");

    const source = await requireEntry(req.user.sub, body.sourceId);
    const target = await requireEntry(req.user.sub, body.targetId);
    if (source.projectId !== pid || target.projectId !== pid) {
      throw httpError(400, "entries_outside_project");
    }

    const [relationship] = await db
      .insert(relationships)
      .values({
        projectId: pid,
        sourceId: body.sourceId,
        targetId: body.targetId,
        type: body.type,
        label: body.label,
        metadata: body.metadata ?? {},
      })
      .onConflictDoNothing()
      .returning();
    return reply.code(201).send({ relationship });
  });

  app.get("/entries/:id/relationships", async (req) => {
    const { id } = req.params as { id: string };
    await requireEntry(req.user.sub, id);
    const rows = await db
      .select()
      .from(relationships)
      .where(or(eq(relationships.sourceId, id), eq(relationships.targetId, id)));
    return { relationships: rows };
  });

  // grafo do projeto: nós (entries) + arestas (relationships)
  app.get("/projects/:pid/graph", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const nodes = await db
      .select({ id: entries.id, title: entries.title, type: entries.type })
      .from(entries)
      .where(eq(entries.projectId, pid));
    const edges = await db.select().from(relationships).where(eq(relationships.projectId, pid));
    return { nodes, edges };
  });

  // árvore genealógica: subconjunto de relações do projeto
  app.get("/entries/:id/genealogy", async (req) => {
    const { id } = req.params as { id: string };
    const entry = await requireEntry(req.user.sub, id);
    const edges = await db
      .select()
      .from(relationships)
      .where(
        and(
          eq(relationships.projectId, entry.projectId),
          inArray(relationships.type, GENEALOGY_TYPES),
        ),
      );
    return { root: id, edges };
  });

  app.patch("/relationships/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(relationships).where(eq(relationships.id, id));
    if (!existing) throw httpError(404, "relationship_not_found");
    await requireProject(req.user.sub, existing.projectId);
    const body = z
      .object({ type: z.string().optional(), label: z.string().optional(), metadata: z.record(z.any()).optional() })
      .parse(req.body);
    const [relationship] = await db.update(relationships).set(body).where(eq(relationships.id, id)).returning();
    return { relationship };
  });

  app.delete("/relationships/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(relationships).where(eq(relationships.id, id));
    if (!existing) throw httpError(404, "relationship_not_found");
    await requireProject(req.user.sub, existing.projectId);
    await db.delete(relationships).where(eq(relationships.id, id));
    return reply.code(204).send();
  });
}
