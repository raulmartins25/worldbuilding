import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { tags, entryTags } from "../db/schema";
import { httpError, requireEntry, requireProject } from "../lib/guard";

export async function tagRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/projects/:pid/tags", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const rows = await db.select().from(tags).where(eq(tags.projectId, pid));
    return { tags: rows };
  });

  app.post("/projects/:pid/tags", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const body = z.object({ name: z.string().min(1), color: z.string().optional() }).parse(req.body);
    const [tag] = await db
      .insert(tags)
      .values({ projectId: pid, name: body.name, color: body.color })
      .onConflictDoNothing()
      .returning();
    return reply.code(201).send({ tag });
  });

  app.patch("/tags/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(tags).where(eq(tags.id, id));
    if (!existing) throw httpError(404, "tag_not_found");
    await requireProject(req.user.sub, existing.projectId);
    const body = z.object({ name: z.string().optional(), color: z.string().optional() }).parse(req.body);
    const [tag] = await db.update(tags).set(body).where(eq(tags.id, id)).returning();
    return { tag };
  });

  app.delete("/tags/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(tags).where(eq(tags.id, id));
    if (!existing) throw httpError(404, "tag_not_found");
    await requireProject(req.user.sub, existing.projectId);
    await db.delete(tags).where(eq(tags.id, id));
    return reply.code(204).send();
  });

  // tags anexadas a uma entry
  app.get("/entries/:id/tags", async (req) => {
    const { id } = req.params as { id: string };
    await requireEntry(req.user.sub, id);
    const rows = await db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(entryTags)
      .innerJoin(tags, eq(entryTags.tagId, tags.id))
      .where(eq(entryTags.entryId, id));
    return { tags: rows };
  });

  // anexar / desanexar tag de uma entry
  app.post("/entries/:id/tags", async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = await requireEntry(req.user.sub, id);
    const { tagId } = z.object({ tagId: z.string().uuid() }).parse(req.body);
    const [tag] = await db.select().from(tags).where(and(eq(tags.id, tagId), eq(tags.projectId, entry.projectId)));
    if (!tag) throw httpError(404, "tag_not_found");
    await db.insert(entryTags).values({ entryId: id, tagId }).onConflictDoNothing();
    return reply.code(201).send({ ok: true });
  });

  app.delete("/entries/:id/tags/:tagId", async (req, reply) => {
    const { id, tagId } = req.params as { id: string; tagId: string };
    await requireEntry(req.user.sub, id);
    await db.delete(entryTags).where(and(eq(entryTags.entryId, id), eq(entryTags.tagId, tagId)));
    return reply.code(204).send();
  });
}
