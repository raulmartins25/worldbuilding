import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { timelineEvents } from "../db/schema";
import { httpError, requireProject } from "../lib/guard";

const bodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  startValue: z.number().int(),
  startStruct: z.record(z.any()).optional(),
  endValue: z.number().int().optional(),
  importance: z.number().int().min(0).max(5).optional(),
  color: z.string().optional(),
  entryId: z.string().uuid().optional(),
});

export async function timelineRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/projects/:pid/timeline", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const events = await db.select().from(timelineEvents)
      .where(eq(timelineEvents.projectId, pid))
      .orderBy(asc(timelineEvents.startValue));
    return { events };
  });

  app.post("/projects/:pid/timeline", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const b = bodySchema.parse(req.body);
    const [event] = await db.insert(timelineEvents).values({
      projectId: pid, title: b.title, description: b.description,
      startValue: b.startValue, startStruct: b.startStruct ?? {},
      endValue: b.endValue, endStruct: b.endValue != null ? {} : undefined,
      importance: b.importance ?? 0, color: b.color, entryId: b.entryId,
    }).returning();
    return reply.code(201).send({ event });
  });

  app.patch("/timeline-events/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(timelineEvents).where(eq(timelineEvents.id, id));
    if (!existing) throw httpError(404, "event_not_found");
    await requireProject(req.user.sub, existing.projectId);
    const b = bodySchema.partial().parse(req.body);
    const [event] = await db.update(timelineEvents).set(b).where(eq(timelineEvents.id, id)).returning();
    return { event };
  });

  app.delete("/timeline-events/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(timelineEvents).where(eq(timelineEvents.id, id));
    if (!existing) throw httpError(404, "event_not_found");
    await requireProject(req.user.sub, existing.projectId);
    await db.delete(timelineEvents).where(eq(timelineEvents.id, id));
    return reply.code(204).send();
  });
}
