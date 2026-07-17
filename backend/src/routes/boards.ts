import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { boards, boardNodes, boardEdges, entries, relationships, memberships } from "../db/schema";
import { httpError, requireBoard, requireProject } from "../lib/guard";
import { embedEntry } from "../lib/embedding";

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
      summary: z.string().optional(),
      importance: z.number().int().min(0).max(5).optional(),
      metadata: z.record(z.any()).optional(),
      x: z.number(), y: z.number(),
    }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.insert(entries).values({
        userId: req.user.sub, projectId: board.projectId, type: body.type, title: body.title,
        summary: body.summary, importance: body.importance ?? 0, metadata: body.metadata ?? {},
      }).returning();
      const [node] = await tx.insert(boardNodes).values({
        projectId: board.projectId, boardId: id, entryId: entry.id, kind: "card", x: body.x, y: body.y,
      }).returning();
      return { entry, node };
    });
    void embedEntry(result.entry.id).catch(() => {});
    return reply.code(201).send(result);
  });

  // plota no board os membros (memberships) do contêiner ainda não presentes
  app.post("/boards/:id/expand-container", async (req, reply) => {
    const { id } = req.params as { id: string };
    const board = await requireBoard(req.user.sub, id);
    const { containerNodeId } = z.object({ containerNodeId: z.string().uuid() }).parse(req.body);

    const [cnode] = await db.select().from(boardNodes)
      .where(and(eq(boardNodes.id, containerNodeId), eq(boardNodes.boardId, id)));
    if (!cnode || !cnode.entryId) throw httpError(400, "not_a_container_node");

    const mems = await db.select().from(memberships).where(eq(memberships.containerId, cnode.entryId));
    const memberEntryIds = mems.map((m) => m.memberId);
    if (memberEntryIds.length === 0) return { created: [] };

    const existing = await db.select({ entryId: boardNodes.entryId }).from(boardNodes)
      .where(and(eq(boardNodes.boardId, id), inArray(boardNodes.entryId, memberEntryIds)));
    const existingSet = new Set(existing.map((n) => n.entryId));
    const toCreate = memberEntryIds.filter((eid) => !existingSet.has(eid));

    const created = [];
    let i = 0;
    for (const eid of toCreate) {
      const [n] = await db.insert(boardNodes).values({
        projectId: board.projectId, boardId: id, entryId: eid, kind: "card",
        x: cnode.x + 40 + (i % 4) * 200, y: cnode.y + 150 + Math.floor(i / 4) * 120,
      }).returning();
      created.push(n);
      i++;
    }
    return reply.code(201).send({ created });
  });

  // framear um contêiner: cria uma moldura com o nome do contêiner e posiciona os membros dentro (grade)
  app.post("/boards/:id/frame-container", async (req, reply) => {
    const { id } = req.params as { id: string };
    const board = await requireBoard(req.user.sub, id);
    const { containerEntryId, x, y } = z.object({
      containerEntryId: z.string().uuid(), x: z.number().optional(), y: z.number().optional(),
    }).parse(req.body);

    const [container] = await db.select().from(entries).where(eq(entries.id, containerEntryId));
    if (!container) throw httpError(404, "entry_not_found");
    const mems = await db.select().from(memberships).where(eq(memberships.containerId, containerEntryId));
    const memberIds = mems.map((m) => m.memberId);

    const PAD = 22, HEAD = 48, CW = 200, CH = 96, GX = 22, GY = 20;
    const cols = Math.max(1, Math.min(3, memberIds.length || 1));
    const rows = Math.max(1, Math.ceil((memberIds.length || 1) / cols));
    const fx = x ?? 60, fy = y ?? 60;
    const width = PAD * 2 + cols * CW + (cols - 1) * GX;
    const height = HEAD + PAD + rows * CH + (rows - 1) * GY;

    const [frame] = await db.insert(boardNodes).values({
      projectId: board.projectId, boardId: id, kind: "frame", x: fx, y: fy,
      width, height, style: { label: container.title, color: "#8891a7" },
    }).returning();

    const existing = memberIds.length
      ? await db.select().from(boardNodes).where(and(eq(boardNodes.boardId, id), inArray(boardNodes.entryId, memberIds)))
      : [];
    const byEntry = new Map(existing.map((n) => [n.entryId, n]));

    const nodes = [];
    let i = 0;
    for (const eid of memberIds) {
      const col = i % cols, row = Math.floor(i / cols);
      const px = fx + PAD + col * (CW + GX);
      const py = fy + HEAD + row * (CH + GY);
      const ex = byEntry.get(eid);
      if (ex) {
        const [n] = await db.update(boardNodes).set({ x: px, y: py }).where(eq(boardNodes.id, ex.id)).returning();
        nodes.push(n);
      } else {
        const [n] = await db.insert(boardNodes).values({
          projectId: board.projectId, boardId: id, entryId: eid, kind: "card", x: px, y: py,
        }).returning();
        nodes.push(n);
      }
      i++;
    }
    return reply.code(201).send({ frame, nodes });
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

  // criar edge no board; opcionalmente cria/associa um relationship semântico
  app.post("/boards/:id/edges", async (req, reply) => {
    const { id } = req.params as { id: string };
    const board = await requireBoard(req.user.sub, id);
    const body = z.object({
      sourceNodeId: z.string().uuid(),
      targetNodeId: z.string().uuid(),
      label: z.string().optional(),
      relationshipType: z.string().optional(),
      style: z.record(z.any()).optional(),
    }).parse(req.body);

    // garante que os nodes são do board (e pega as entries deles)
    const ns = await db.select({ id: boardNodes.id, entryId: boardNodes.entryId }).from(boardNodes)
      .where(and(eq(boardNodes.boardId, id), inArray(boardNodes.id, [body.sourceNodeId, body.targetNodeId])));
    if (ns.length !== 2) throw httpError(400, "nodes_outside_board");

    let relationship: typeof relationships.$inferSelect | null = null;
    if (body.relationshipType) {
      const src = ns.find((n) => n.id === body.sourceNodeId);
      const tgt = ns.find((n) => n.id === body.targetNodeId);
      if (src?.entryId && tgt?.entryId) {
        const rows = await db.insert(relationships).values({
          projectId: board.projectId, sourceId: src.entryId, targetId: tgt.entryId, type: body.relationshipType,
        }).onConflictDoNothing().returning();
        relationship = rows[0] ?? (await db.select().from(relationships).where(and(
          eq(relationships.sourceId, src.entryId),
          eq(relationships.targetId, tgt.entryId),
          eq(relationships.type, body.relationshipType),
        )))[0] ?? null;
      }
    }

    const [edge] = await db.insert(boardEdges).values({
      projectId: board.projectId, boardId: id,
      sourceNodeId: body.sourceNodeId, targetNodeId: body.targetNodeId,
      label: body.label ?? body.relationshipType,
      relationshipId: relationship?.id,
      style: body.style ?? {},
    }).returning();
    return reply.code(201).send({ edge, relationship });
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
