import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { attributes } from "../db/schema";
import { httpError, requireEntry } from "../lib/guard";

const attrItem = z.object({
  key: z.string().min(1),
  value: z.string().optional(),
  valueNum: z.number().optional(),
  unit: z.string().optional(),
});

export async function attributeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/entries/:id/attributes", async (req) => {
    const { id } = req.params as { id: string };
    await requireEntry(req.user.sub, id);
    const rows = await db.select().from(attributes).where(eq(attributes.entryId, id));
    return { attributes: rows };
  });

  // upsert em lote: substitui o conjunto de atributos da entry
  app.put("/entries/:id/attributes", async (req) => {
    const { id } = req.params as { id: string };
    const entry = await requireEntry(req.user.sub, id);
    const items = z.array(attrItem).parse(req.body);

    const rows = await db.transaction(async (tx) => {
      await tx.delete(attributes).where(eq(attributes.entryId, id));
      if (items.length === 0) return [];
      return tx
        .insert(attributes)
        .values(
          items.map((it) => ({
            projectId: entry.projectId,
            entryId: id,
            key: it.key,
            value: it.value,
            valueNum: it.valueNum != null ? String(it.valueNum) : null,
            unit: it.unit,
          })),
        )
        .returning();
    });
    return { attributes: rows };
  });

  app.patch("/attributes/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(attributes).where(eq(attributes.id, id));
    if (!existing) throw httpError(404, "attribute_not_found");
    await requireEntry(req.user.sub, existing.entryId);
    const body = attrItem.partial().parse(req.body);
    const [attribute] = await db
      .update(attributes)
      .set({
        key: body.key,
        value: body.value,
        valueNum: body.valueNum != null ? String(body.valueNum) : undefined,
        unit: body.unit,
      })
      .where(eq(attributes.id, id))
      .returning();
    return { attribute };
  });

  app.delete("/attributes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(attributes).where(eq(attributes.id, id));
    if (!existing) throw httpError(404, "attribute_not_found");
    await requireEntry(req.user.sub, existing.entryId);
    await db.delete(attributes).where(eq(attributes.id, id));
    return reply.code(204).send();
  });
}
