import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { boards, boardNodes, boardEdges, entries } from "../db/schema";
import { httpError, requireBoard, requireProject } from "../lib/guard";

const ENTRY_TYPES = [
  "character", "location", "region", "faction", "item", "magic_system",
  "species", "creature", "deity", "religion", "event", "lore",
  "language", "scene", "chapter", "note",
] as const;

async function boardBundle(boardId: string) {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
  const nodes = await db.select().from(boardNodes).where(eq(boardNodes.boardId, boardId));
  const edges = await db.select().from(boardEdges).where(eq(boardEdges.boardId, boardId));
  return { board, nodes, edges };
}

export async function boardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/projects/:pid/boards", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const rows = await db.select().from(boards).where(eq(boards.projectId, pid));
    return { boards: rows };
  });

  app.post("/projects/:pid/boards", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const body = z.object({ name: z.string().min(1).optional() }).parse(req.body ?? {});
    const [board] = await db.insert(boards).values({ projectId: pid, name: body.name ?? "Main" }).returning();
    return reply.code(201).send({ board });
  });

  // atalho: board default do projeto (cria se não existir) + nodes/edges
  app.get("/projects/:pid/board", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    let [board] = await db.select().from(boards).where(eq(boards.projectId, pid)).limit(1);
    if (!board) {
      [board] = await db.insert(boards).values({ projectId: pid, name: "Main" }).returning();
    }
    return boardBundle(board.id);
  });

  app.get("/boards/:id", async (req) => {
    const { id } = req.params as { id: string };
    await requireBoard(req.user.sub, id);
    return boardBundle(id);
  });

  app.patch("/boards/:id", async (req) => {
    const { id } = req.params as { id: string };
    await requireBoard(req.user.sub, id);
    const body = z.object({ name: z.string().optional(), viewport: z.record(z.any()).optional() }).parse(req.body);
    const [board] = await db.update(boards).set(body).where(eq(boards.id, id)).returning();
    return { board };
  });

  app.delete("/boards/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await requireBoard(req.user.sub, id);
    await db.delete(boards).where(eq(boards.id, id));
    return reply.code(204).send();
  });

  // criar node avulso (referenciando entry existente, ou frame/texto)
  app.post("/boards/:id/nodes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const board = await requireBoard(req.user.sub, id);
    const body = z.object({
      entryId: z.string().uuid().optional(),
      kind: z.enum(["card", "frame", "text", "group"]).optional(),
      x: z.number(), y: z.number(),
      width: z.number().optional(), height: z.number().optional(),
      style: z.record(z.any()).optional(),
    }).parse(req.body);
    const [node] = await db.insert(boardNodes).values({
      projectId: board.projectId, boardId: id, entryId: body.entryId,
      kind: body.kind ?? "card", x: body.x, y: body.y,
      width: body.width, height: body.height, style: body.style ?? {},
    }).returning();
    return reply.code(201).send({ node });
  });

  // atalho: criar entry + node num passo (novo card no canvas)
  app.post("/boards/:id/cards", async (req, reply) => {
    const { id } = req.params as { id: string };
    const board = await requireBoard(req.user.sub, id);
    const body = z.object({
      type: z.enum(ENTRY_TYPES),
      title: z.string().min(1),
      x: z.number(), y: z.number(),
    }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.insert(entries).values({
        userId: req.user.sub, projectId: board.projectId, type: body.type, title: body.title,
      }).returning();
      const [node] = await tx.insert(boardNodes).values({
        projectId: board.projectId, boardId: id, entryId: entry.id, kind: "card", x: body.x, y: body.y,
      }).returning();
      return { entry, node };
    });
    return reply.code(201).send(result);
  });

  // batch de posições/tamanho (salvar drag)
  app.patch("/boards/:id/nodes", async (req) => {
    const { id } = req.params as { id: string };
    await requireBoard(req.user.sub, id);
    const items = z.array(z.object({
      id: z.string().uuid(),
      x: z.number().optional(), y: z.number().optional(),
      width: z.number().optional(), height: z.number().optional(),
      zIndex: z.number().int().optional(),
    })).parse(req.body);
    await db.transaction(async (tx) => {
      for (const it of items) {
        await tx.update(boardNodes)
          .set({ x: it.x, y: it.y, width: it.width, height: it.height, zIndex: it.zIndex })
          .where(and(eq(boardNodes.id, it.id), eq(boardNodes.boardId, id)));
      }
    });
    return { updated: items.length };
  });

  app.patch("/board-nodes/:nodeId", async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    const [existing] = await db.select().from(boardNodes).where(eq(boardNodes.id, nodeId));
    if (!existing) throw httpError(404, "node_not_found");
    await requireBoard(req.user.sub, existing.boardId);
    const body = z.object({
      x: z.number().optional(), y: z.number().optional(),
      width: z.number().optional(), height: z.number().optional(),
      zIndex: z.number().int().optional(), style: z.record(z.any()).optional(),
    }).parse(req.body);
    const [node] = await db.update(boardNodes).set(body).where(eq(boardNodes.id, nodeId)).returning();
    return { node };
  });

  app.delete("/board-nodes/:nodeId", async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const [existing] = await db.select().from(boardNodes).where(eq(boardNodes.id, nodeId));
    if (!existing) throw httpError(404, "node_not_found");
    await requireBoard(req.user.sub, existing.boardId);
    await db.delete(boardNodes).where(eq(boardNodes.id, nodeId));
    return reply.code(204).send();
  });

  // edges do board (fatia 2 usa mais; já deixo o CRUD)
  app.post("/boards/:id/edges", async (req, reply) => {
    const { id } = req.params as { id: string };
    const board = await requireBoard(req.user.sub, id);
    const body = z.object({
      sourceNodeId: z.string().uuid(),
      targetNodeId: z.string().uuid(),
      label: z.string().optional(),
      relationshipId: z.string().uuid().optional(),
      style: z.record(z.any()).optional(),
    }).parse(req.body);
    // garante que os nodes são do board
    const ns = await db.select({ id: boardNodes.id }).from(boardNodes)
      .where(and(eq(boardNodes.boardId, id), inArray(boardNodes.id, [body.sourceNodeId, body.targetNodeId])));
    if (ns.length !== 2) throw httpError(400, "nodes_outside_board");
    const [edge] = await db.insert(boardEdges).values({
      projectId: board.projectId, boardId: id,
      sourceNodeId: body.sourceNodeId, targetNodeId: body.targetNodeId,
      label: body.label, relationshipId: body.relationshipId, style: body.style ?? {},
    }).returning();
    return reply.code(201).send({ edge });
  });

  app.delete("/board-edges/:edgeId", async (req, reply) => {
    const { edgeId } = req.params as { edgeId: string };
    const [existing] = await db.select().from(boardEdges).where(eq(boardEdges.id, edgeId));
    if (!existing) throw httpError(404, "edge_not_found");
    await requireBoard(req.user.sub, existing.boardId);
    await db.delete(boardEdges).where(eq(boardEdges.id, edgeId));
    return reply.code(204).send();
  });
}
