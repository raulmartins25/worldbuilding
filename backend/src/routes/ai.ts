import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { entries, relationships, memberships, attributes, aiChecks, maps } from "../db/schema";
import { httpError, requireEntry, requireProject } from "../lib/guard";
import { aiEnabled, embed, chat, chatStream, generateImage } from "../lib/openai";
import { embedEntry, buildEntryText } from "../lib/embedding";

// monta um retrato textual compacto do mundo para a IA
async function buildProjectContext(pid: string): Promise<{ text: string; titleById: Record<string, string> }> {
  const es = await db.select().from(entries).where(eq(entries.projectId, pid));
  const attrs = await db.select().from(attributes).where(eq(attributes.projectId, pid));
  const rels = await db.select().from(relationships).where(eq(relationships.projectId, pid));
  const mems = await db.select().from(memberships).where(eq(memberships.projectId, pid));

  const titleById: Record<string, string> = Object.fromEntries(es.map((e) => [e.id, e.title]));
  const attrsByEntry: Record<string, string[]> = {};
  for (const a of attrs) (attrsByEntry[a.entryId] ??= []).push(`${a.key}=${a.value ?? ""}`);

  const mdOf = (m: unknown) => {
    const o = (m ?? {}) as Record<string, unknown>;
    const parts = Object.entries(o).filter(([, v]) => v != null && String(v).trim());
    return parts.length ? ` | detalhes: ${parts.map(([k, v]) => `${k}=${v}`).join(", ")}` : "";
  };
  const lines: string[] = ["# Entries"];
  for (const e of es) {
    const at = attrsByEntry[e.id]?.length ? ` | atributos: ${attrsByEntry[e.id].join(", ")}` : "";
    lines.push(`- [${e.type}/${e.status}] ${e.title}: ${e.summary ?? "(sem resumo)"}${mdOf(e.metadata)}${at}`);
  }
  if (rels.length) {
    lines.push("\n# Relações");
    for (const r of rels) lines.push(`- ${titleById[r.sourceId] ?? "?"} —${r.type}→ ${titleById[r.targetId] ?? "?"}`);
  }
  if (mems.length) {
    lines.push("\n# Contenção");
    for (const m of mems) lines.push(`- ${titleById[m.containerId] ?? "?"} contém ${titleById[m.memberId] ?? "?"}`);
  }
  return { text: lines.join("\n").slice(0, 14000), titleById };
}

// contexto de UMA entry (para entrevista): detalhes + atributos + relações + vizinhos RAG
async function buildEntryContext(entryId: string): Promise<{ entry: typeof entries.$inferSelect; text: string }> {
  const [entry] = await db.select().from(entries).where(eq(entries.id, entryId));
  const attrs = await db.select().from(attributes).where(eq(attributes.entryId, entryId));
  const rels = await db.select().from(relationships)
    .where(or(eq(relationships.sourceId, entryId), eq(relationships.targetId, entryId)));

  const otherIds = [...new Set(rels.flatMap((r) => [r.sourceId, r.targetId]).filter((id) => id !== entryId))];
  const others = otherIds.length
    ? await db.select({ id: entries.id, title: entries.title }).from(entries).where(inArray(entries.id, otherIds))
    : [];
  const titleById: Record<string, string> = Object.fromEntries(others.map((o) => [o.id, o.title]));
  titleById[entryId] = entry.title;

  const lines = [`# ${entry.title} (${entry.type}, ${entry.status})`, entry.summary ?? "", buildEntryText(entry)];
  const md = Object.entries((entry.metadata ?? {}) as Record<string, unknown>).filter(([, v]) => v != null && String(v).trim());
  if (md.length) lines.push("Detalhes: " + md.map(([k, v]) => `${k}=${v}`).join(", "));
  if (attrs.length) lines.push("Atributos: " + attrs.map((a) => `${a.key}=${a.value ?? ""}`).join(", "));
  if (rels.length) {
    lines.push("Relações:");
    for (const r of rels) lines.push(`- ${titleById[r.sourceId] ?? "?"} —${r.type}→ ${titleById[r.targetId] ?? "?"}`);
  }

  // vizinhos semânticos para dar mundo ao personagem
  if (aiEnabled()) {
    try {
      const vec = await embed(buildEntryText(entry) || entry.title);
      const lit = `[${vec.join(",")}]`;
      const neighbors = await db.execute(sql`
        SELECT title, summary FROM entries
        WHERE project_id = ${entry.projectId} AND id <> ${entryId} AND embedding IS NOT NULL
        ORDER BY embedding <=> ${lit}::vector LIMIT 5
      `) as unknown as { title: string; summary: string | null }[];
      if (neighbors.length) {
        lines.push("\n# Mundo ao redor");
        for (const n of neighbors) lines.push(`- ${n.title}: ${n.summary ?? ""}`);
      }
    } catch { /* best-effort */ }
  }
  return { entry, text: lines.filter((l) => l && l.trim()).join("\n").slice(0, 12000) };
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/ai/status", async () => ({ enabled: aiEnabled() }));

  app.post("/projects/:pid/ai/reindex", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const rows = await db.select({ id: entries.id }).from(entries).where(eq(entries.projectId, pid));
    let ok = 0;
    for (const r of rows) if (await embedEntry(r.id)) ok++;
    return { reindexed: ok, total: rows.length };
  });

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

  // roda a checagem de consistência: grava findings em ai_checks
  app.post("/projects/:pid/ai/check", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { text, titleById } = await buildProjectContext(pid);
    const titleToId: Record<string, string> = {};
    for (const [id, t] of Object.entries(titleById)) titleToId[t.toLowerCase()] = id;

    const raw = await chat([
      {
        role: "system",
        content:
          "Você é um editor de continuidade de mundos de fantasia. Analise o material e liste " +
          "INCONSISTÊNCIAS factuais/lógicas: personagem morto que reaparece, regra de magia contradita, " +
          "cronologia ou viagem impossível, relações contraditórias (ex.: X é pai e filho de Y), status " +
          "canônico vs rascunho conflitante, etc. Seja específico e conciso. Responda SOMENTE JSON no formato " +
          '{"findings":[{"title":"...","detail":"...","severity":"info|warning|critical","entries":["Título",...]}]}. ' +
          "Se não houver inconsistências, retorne {\"findings\":[]}.",
      },
      { role: "user", content: text },
    ], { json: true, temperature: 0.2 });

    let findings: { title: string; detail?: string; severity?: string; entries?: string[] }[] = [];
    try {
      const parsed = JSON.parse(raw) as { findings?: typeof findings };
      findings = parsed.findings ?? [];
    } catch {
      throw httpError(502, "ai_invalid_response");
    }

    const created = [];
    for (const f of findings) {
      const firstTitle = f.entries?.[0]?.toLowerCase();
      const entryId = firstTitle ? titleToId[firstTitle] ?? null : null;
      const sev = ["info", "warning", "critical"].includes(f.severity ?? "") ? f.severity! : "warning";
      const [row] = await db.insert(aiChecks).values({
        projectId: pid, entryId, kind: "inconsistency", severity: sev,
        title: f.title.slice(0, 200), detail: f.detail ?? null,
        payload: { entries: f.entries ?? [] }, status: "open",
      }).returning();
      created.push(row);
    }
    return { created, count: created.length };
  });

  app.get("/projects/:pid/ai/checks", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { status } = req.query as { status?: string };
    const filters = [eq(aiChecks.projectId, pid)];
    if (status === "open" || status === "ignored" || status === "resolved") filters.push(eq(aiChecks.status, status));
    const rows = await db.select().from(aiChecks).where(and(...filters)).orderBy(desc(aiChecks.createdAt));
    return { checks: rows };
  });

  app.patch("/ai-checks/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(aiChecks).where(eq(aiChecks.id, id));
    if (!existing) throw httpError(404, "check_not_found");
    await requireProject(req.user.sub, existing.projectId);
    const { status } = z.object({ status: z.enum(["open", "ignored", "resolved"]) }).parse(req.body);
    const [check] = await db.update(aiChecks)
      .set({ status, resolvedAt: status === "resolved" ? new Date() : null })
      .where(eq(aiChecks.id, id)).returning();
    return { check };
  });

  // entrevistar personagem: responde em 1ª pessoa a partir do contexto (RAG)
  app.post("/entries/:id/ai/interview", async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = await requireEntry(req.user.sub, id);
    const { question } = z.object({ question: z.string().min(1) }).parse(req.body);
    const { text } = await buildEntryContext(id);
    const messages = [
      {
        role: "system" as const,
        content:
          `Você é ${entry.title}, um(a) ${entry.type} de um mundo de fantasia. Responda SEMPRE em ` +
          "primeira pessoa, incorporando o personagem (tom, voz, personalidade coerentes). Baseie-se no " +
          "CONTEXTO abaixo; se algo não estiver nele, pode improvisar de forma plausível SEM contradizer os " +
          "fatos dados. Nunca saia do personagem nem mencione que é uma IA.\n\nCONTEXTO:\n" + text,
      },
      { role: "user" as const, content: question },
    ];

    // SSE: a resposta é transmitida token a token (personagem "digitando" ao vivo)
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx: não bufferizar este response
    });
    const send = (obj: unknown) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    try {
      await chatStream(messages, { temperature: 0.85 }, (delta) => send({ delta }));
      send({ done: true });
    } catch (e) {
      send({ error: e instanceof Error ? e.message : "erro" });
    }
    reply.raw.end();
  });

  // gerador de mapa por entrevista: a IA entrevista sobre geografia/estilo e devolve o prompt de imagem
  app.post("/projects/:pid/maps/interview", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { messages } = z.object({
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
    }).parse(req.body);
    const { text } = await buildProjectContext(pid);
    const sys = {
      role: "system" as const,
      content:
        "Você é um cartógrafo assistente. Conduza uma ENTREVISTA curta (no máximo 4 perguntas, UMA de cada vez) " +
        "para desenhar o mapa deste mundo de fantasia. Cubra: terreno/bioma dominante; regiões principais e como se " +
        "posicionam entre si; elementos marcantes (mares, montanhas, florestas, desertos, cidades); e o ESTILO visual " +
        "(ex.: mapa antigo em pergaminho, atlas pintado à mão, estilo Tolkien). Use o CONTEXTO do mundo para não " +
        "perguntar o óbvio (aproveite regiões/locais já existentes). Responda SEMPRE em JSON: " +
        '{"ask":"próxima pergunta"} enquanto precisar de mais informação, OU {"prompt":"..."} quando já tiver o ' +
        "suficiente. Nesse caso 'prompt' é uma descrição RICA em INGLÊS para um gerador de imagens desenhar o mapa " +
        "(inclua estilo cartográfico, regiões nomeadas, geografia, paleta; peça 'a fantasy world map, top-down', sem " +
        "texto ilegível). Nunca retorne 'ask' e 'prompt' juntos.\n\nCONTEXTO DO MUNDO:\n" + text,
    };
    const raw = await chat([sys, ...messages], { json: true, temperature: 0.6 });
    let out: { ask?: string; prompt?: string } = {};
    try { out = JSON.parse(raw); } catch { throw httpError(502, "ai_invalid_response"); }
    return { ask: out.ask ?? null, prompt: out.prompt ?? null };
  });

  // gera a imagem do mapa a partir do prompt e salva como um mapa do projeto (imageUrl = data URL)
  app.post("/projects/:pid/maps/generate", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { prompt, name } = z.object({
      prompt: z.string().min(10),
      name: z.string().min(1).default("Mapa gerado"),
    }).parse(req.body);
    const imageUrl = await generateImage(prompt);
    const [map] = await db.insert(maps).values({ projectId: pid, name, imageUrl, width: 1024, height: 1024 }).returning();
    return reply.code(201).send({ map });
  });

  // sugerir ligações: a IA propõe novas relações; grava como ai_checks(kind=suggestion)
  app.post("/projects/:pid/ai/suggest-links", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { text } = await buildProjectContext(pid);
    const raw = await chat([
      {
        role: "system",
        content:
          "Analise o mundo e sugira NOVAS relações plausíveis entre entries que ainda não estão listadas, " +
          "com base em pistas do contexto. Responda SOMENTE JSON no formato " +
          '{"suggestions":[{"source":"Título","target":"Título","type":"aliado_de|inimigo_de|pai_de|mae_de|casado_com|governa|pertence_a|aparece_em","reason":"..."}]}. ' +
          "Máximo 8 sugestões, priorize as mais fundamentadas.",
      },
      { role: "user", content: text },
    ], { json: true, temperature: 0.5 });

    let suggestions: { source: string; target: string; type: string; reason?: string }[] = [];
    try {
      suggestions = (JSON.parse(raw).suggestions ?? []) as typeof suggestions;
    } catch {
      throw httpError(502, "ai_invalid_response");
    }
    for (const s of suggestions) {
      await db.insert(aiChecks).values({
        projectId: pid, kind: "suggestion", severity: "info",
        title: `${s.source} —${s.type}→ ${s.target}`, detail: s.reason ?? null,
        payload: { source: s.source, target: s.target, type: s.type }, status: "open",
      });
    }
    return { suggestions, count: suggestions.length };
  });

  // "resolver = conversa": um turno de conversa que ajuda a costurar a correção
  app.post("/projects/:pid/ai/resolve", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { checkId, messages } = z.object({
      checkId: z.string().uuid(),
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
    }).parse(req.body);

    const [check] = await db.select().from(aiChecks).where(and(eq(aiChecks.id, checkId), eq(aiChecks.projectId, pid)));
    if (!check) throw httpError(404, "check_not_found");

    const involvedTitles = ((check.payload as { entries?: string[] })?.entries ?? []).map((t) => t.toLowerCase());
    const es = await db.select().from(entries).where(eq(entries.projectId, pid));
    const involved = es.filter((e) => involvedTitles.includes(e.title.toLowerCase()));
    const ctx = involved.map((e) => `- [${e.type}/${e.status}] ${e.title}: ${e.summary ?? "(sem resumo)"}`).join("\n") || "(sem fichas específicas)";

    const sys =
      `Você é um editor de continuidade de mundos de fantasia ajudando o autor a CORRIGIR uma inconsistência ` +
      `(não apenas descartá-la). Inconsistência: "${check.title}" — ${check.detail ?? ""}.\nFichas envolvidas:\n${ctx}\n\n` +
      `Converse de forma breve e concreta, propondo como costurar a correção no mundo. Quando houver uma correção ` +
      `específica numa ficha, inclua no JSON o campo "suggestion": {"entryTitle":"...","field":"summary"|"status","value":"..."} ` +
      `(status ∈ draft|canon|archived). Se ainda estiver conversando, use "suggestion": null. Responda SOMENTE JSON: {"reply":"...","suggestion":...}.`;

    const raw = await chat([{ role: "system", content: sys }, ...messages], { json: true, temperature: 0.4 });
    let parsed: { reply?: string; suggestion?: unknown };
    try { parsed = JSON.parse(raw); } catch { parsed = { reply: raw, suggestion: null }; }
    return { reply: parsed.reply ?? "", suggestion: parsed.suggestion ?? null };
  });

  // aplica a correção proposta a uma ficha e marca o apontamento como resolvido
  app.post("/ai-checks/:id/apply", async (req) => {
    const { id } = req.params as { id: string };
    const [check] = await db.select().from(aiChecks).where(eq(aiChecks.id, id));
    if (!check) throw httpError(404, "check_not_found");
    await requireProject(req.user.sub, check.projectId);
    const { entryTitle, field, value } = z.object({
      entryTitle: z.string(),
      field: z.enum(["summary", "status"]),
      value: z.string(),
    }).parse(req.body);
    if (field === "status" && !["draft", "canon", "archived"].includes(value)) throw httpError(400, "invalid_status");

    const es = await db.select().from(entries).where(eq(entries.projectId, check.projectId));
    const target = es.find((e) => e.title.toLowerCase() === entryTitle.toLowerCase());
    if (!target) throw httpError(404, "entry_not_found");

    const set = field === "status" ? { status: value as "draft" | "canon" | "archived" } : { summary: value };
    await db.update(entries).set(set).where(eq(entries.id, target.id));
    await db.update(aiChecks).set({ status: "resolved", resolvedAt: new Date() }).where(eq(aiChecks.id, id));
    return { ok: true, entryId: target.id };
  });
}
