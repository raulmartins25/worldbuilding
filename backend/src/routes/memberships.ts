import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { memberships } from "../db/schema";
import { httpError, requireEntry, requireProject } from "../lib/guard";

const createBody = z.object({
  containerId: z.string().uuid(),
  memberId: z.string().uuid(),
  role: z.string().optional(),
  position: z.number().int().optional(),
});

export async function membershipRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // membros diretos de um contêiner
  app.get("/entries/:id/members", async (req) => {
    const { id } = req.params as { id: string };
    await requireEntry(req.user.sub, id);
    const rows = await db.select().from(memberships).where(eq(memberships.containerId, id));
    return { members: rows };
  });

  // contêineres aos quais uma entry pertence
  app.get("/entries/:id/containers", async (req) => {
    const { id } = req.params as { id: string };
    await requireEntry(req.user.sub, id);
    const rows = await db.select().from(memberships).where(eq(memberships.memberId, id));
    return { containers: rows };
  });

  // árvore de contenção do projeto inteiro (cliente monta a hierarquia)
  app.get("/projects/:pid/tree", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const rows = await db.select().from(memberships).where(eq(memberships.projectId, pid));
    return { memberships: rows };
  });

  app.post("/projects/:pid/memberships", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const body = createBody.parse(req.body);
    if (body.containerId === body.memberId) throw httpError(400, "container_equals_member");

    // ambos precisam pertencer ao usuário e ao projeto
    const container = await requireEntry(req.user.sub, body.containerId);
    const member = await requireEntry(req.user.sub, body.memberId);
    if (container.projectId !== pid || member.projectId !== pid) {
      throw httpError(400, "entries_outside_project");
    }

    const [membership] = await db
      .insert(memberships)
      .values({
        projectId: pid,
        containerId: body.containerId,
        memberId: body.memberId,
        role: body.role,
        position: body.position ?? 0,
      })
      .onConflictDoNothing()
      .returning();
    return reply.code(201).send({ membership });
  });

  app.patch("/memberships/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ role: z.string().optional(), position: z.number().int().optional() }).parse(req.body);
    const [existing] = await db.select().from(memberships).where(eq(memberships.id, id));
    if (!existing) throw httpError(404, "membership_not_found");
    await requireProject(req.user.sub, existing.projectId);
    const [membership] = await db.update(memberships).set(body).where(eq(memberships.id, id)).returning();
    return { membership };
  });

  app.delete("/memberships/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(memberships).where(eq(memberships.id, id));
    if (!existing) throw httpError(404, "membership_not_found");
    await requireProject(req.user.sub, existing.projectId);
    await db.delete(memberships).where(eq(memberships.id, id));
    return reply.code(204).send();
  });
}
