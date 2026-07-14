import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { references } from "../db/schema";
import { httpError, requireEntry } from "../lib/guard";

const createBody = z.object({
  kind: z.enum(["link", "image", "quote", "file"]).default("link"),
  url: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});

export async function referenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/entries/:id/references", async (req) => {
    const { id } = req.params as { id: string };
    await requireEntry(req.user.sub, id);
    const rows = await db.select().from(references).where(eq(references.entryId, id));
    return { references: rows };
  });

  app.post("/entries/:id/references", async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = await requireEntry(req.user.sub, id);
    const body = createBody.parse(req.body);
    const [reference] = await db.insert(references).values({
      projectId: entry.projectId, entryId: id,
      kind: body.kind, url: body.url, title: body.title,
      content: body.content, thumbnailUrl: body.thumbnailUrl,
    }).returning();
    return reply.code(201).send({ reference });
  });

  app.patch("/references/:refId", async (req) => {
    const { refId } = req.params as { refId: string };
    const [existing] = await db.select().from(references).where(eq(references.id, refId));
    if (!existing) throw httpError(404, "reference_not_found");
    await requireEntry(req.user.sub, existing.entryId);
    const body = createBody.partial().parse(req.body);
    const [reference] = await db.update(references).set(body).where(eq(references.id, refId)).returning();
    return { reference };
  });

  app.delete("/references/:refId", async (req, reply) => {
    const { refId } = req.params as { refId: string };
    const [existing] = await db.select().from(references).where(eq(references.id, refId));
    if (!existing) throw httpError(404, "reference_not_found");
    await requireEntry(req.user.sub, existing.entryId);
    await db.delete(references).where(eq(references.id, refId));
    return reply.code(204).send();
  });
}
