import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { projects } from "../db/schema";
import { requireProject } from "../lib/guard";

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "world"
  );
}

const createBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  calendar: z.record(z.any()).optional(),
});

const updateBody = createBody.partial().extend({
  coverUrl: z.string().url().optional(),
  settings: z.record(z.any()).optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/projects", async (req) => {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, req.user.sub))
      .orderBy(desc(projects.updatedAt));
    return { projects: rows };
  });

  app.post("/projects", async (req, reply) => {
    const body = createBody.parse(req.body);
    let slug = slugify(body.name);
    const [clash] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, req.user.sub), eq(projects.slug, slug)));
    if (clash) slug = `${slug}-${Math.random().toString(16).slice(2, 6)}`;

    const [project] = await db
      .insert(projects)
      .values({
        userId: req.user.sub,
        name: body.name,
        slug,
        description: body.description,
        calendar: body.calendar ?? {},
      })
      .returning();
    return reply.code(201).send({ project });
  });

  app.get("/projects/:pid", async (req) => {
    const { pid } = req.params as { pid: string };
    const project = await requireProject(req.user.sub, pid);
    return { project };
  });

  app.patch("/projects/:pid", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const body = updateBody.parse(req.body);
    const [project] = await db
      .update(projects)
      .set(body)
      .where(eq(projects.id, pid))
      .returning();
    return { project };
  });

  app.delete("/projects/:pid", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    await db.delete(projects).where(eq(projects.id, pid));
    return reply.code(204).send();
  });
}
