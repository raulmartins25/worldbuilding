import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { maps, mapPins } from "../db/schema";
import { httpError, requireMap, requireProject } from "../lib/guard";

export async function mapRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/projects/:pid/maps", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const rows = await db.select().from(maps).where(eq(maps.projectId, pid));
    return { maps: rows };
  });

  app.post("/projects/:pid/maps", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const body = z.object({
      name: z.string().min(1),
      imageUrl: z.string().url(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      parentMapId: z.string().uuid().optional(),
    }).parse(req.body);
    const [map] = await db.insert(maps).values({
      projectId: pid, name: body.name, imageUrl: body.imageUrl,
      width: body.width, height: body.height, parentMapId: body.parentMapId,
    }).returning();
    return reply.code(201).send({ map });
  });

  app.get("/maps/:id", async (req) => {
    const { id } = req.params as { id: string };
    const map = await requireMap(req.user.sub, id);
    const pins = await db.select().from(mapPins).where(eq(mapPins.mapId, id));
    return { map, pins };
  });

  app.patch("/maps/:id", async (req) => {
    const { id } = req.params as { id: string };
    await requireMap(req.user.sub, id);
    const body = z.object({ name: z.string().optional(), imageUrl: z.string().url().optional() }).parse(req.body);
    const [map] = await db.update(maps).set(body).where(eq(maps.id, id)).returning();
    return { map };
  });

  app.delete("/maps/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await requireMap(req.user.sub, id);
    await db.delete(maps).where(eq(maps.id, id));
    return reply.code(204).send();
  });

  // pins (coordenadas normalizadas 0..1 sobre a imagem)
  app.post("/maps/:id/pins", async (req, reply) => {
    const { id } = req.params as { id: string };
    const map = await requireMap(req.user.sub, id);
    const body = z.object({
      entryId: z.string().uuid().optional(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      label: z.string().optional(),
      icon: z.string().optional(),
      color: z.string().optional(),
      childMapId: z.string().uuid().optional(),
    }).parse(req.body);
    const [pin] = await db.insert(mapPins).values({
      projectId: map.projectId, mapId: id, entryId: body.entryId,
      x: body.x, y: body.y, label: body.label, icon: body.icon,
      color: body.color, childMapId: body.childMapId,
    }).returning();
    return reply.code(201).send({ pin });
  });

  app.patch("/map-pins/:pinId", async (req) => {
    const { pinId } = req.params as { pinId: string };
    const [existing] = await db.select().from(mapPins).where(eq(mapPins.id, pinId));
    if (!existing) throw httpError(404, "pin_not_found");
    await requireMap(req.user.sub, existing.mapId);
    const body = z.object({
      x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(),
      label: z.string().optional(), color: z.string().optional(), entryId: z.string().uuid().optional(),
    }).parse(req.body);
    const [pin] = await db.update(mapPins).set(body).where(eq(mapPins.id, pinId)).returning();
    return { pin };
  });

  app.delete("/map-pins/:pinId", async (req, reply) => {
    const { pinId } = req.params as { pinId: string };
    const [existing] = await db.select().from(mapPins).where(eq(mapPins.id, pinId));
    if (!existing) throw httpError(404, "pin_not_found");
    await requireMap(req.user.sub, existing.mapId);
    await db.delete(mapPins).where(eq(mapPins.id, pinId));
    return reply.code(204).send();
  });
}
