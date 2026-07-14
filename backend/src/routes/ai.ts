import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { entries } from "../db/schema";
import { requireProject } from "../lib/guard";
import { aiEnabled, embed } from "../lib/openai";
import { embedEntry } from "../lib/embedding";

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/ai/status", async () => ({ enabled: aiEnabled() }));

  // (re)gera embeddings de todas as entries do projeto
  app.post("/projects/:pid/ai/reindex", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const rows = await db.select({ id: entries.id }).from(entries).where(eq(entries.projectId, pid));
    let ok = 0;
    for (const r of rows) {
      if (await embedEntry(r.id)) ok++;
    }
    return { reindexed: ok, total: rows.length };
  });

  // busca semântica (RAG): embed da query + vizinhos por cosseno (pgvector)
  app.post("/projects/:pid/ai/search", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { query, k } = z.object({ query: z.string().min(1), k: z.number().int().min(1).max(50).optional() }).parse(req.body);
    const qvec = await embed(query);
    const lit = `[${qvec.join(",")}]`;
    const rows = await db.execute(sql`
      SELECT id, title, type, summary, 1 - (embedding <=> ${lit}::vector) AS score
      FROM entries
      WHERE project_id = ${pid} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${k ?? 8}
    `);
    return { results: rows };
  });
}
