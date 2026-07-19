import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { entries, relationships, memberships, attributes, aiChecks, maps, boards, boardNodes, boardEdges } from "../db/schema";
import { httpError, requireEntry, requireProject } from "../lib/guard";
import { aiEnabled, embed, chat, chatStream, generateImage, EXTRACT_MODEL } from "../lib/openai";
import { embedEntry, buildEntryText } from "../lib/embedding";
import mammoth from "mammoth";

// extrai texto de um .docx (mammoth) ou .pdf (unpdf) a partir do buffer
async function extractDocText(filename: string, buf: Buffer): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) {
    const r = await mammoth.extractRawText({ buffer: buf });
    return r.value;
  }
  if (lower.endsWith(".pdf")) {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  throw httpError(400, "unsupported_file");
}

// texto → doc Tiptap (parágrafos), para o corpo de capítulos/cenas
function textToDoc(text: string): Record<string, unknown> {
  const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  return { type: "doc", content: paras.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) };
}
const MANUSCRIPT_TYPES = new Set(["chapter", "scene"]);
const REL_VOCAB = ["aliado_de", "inimigo_de", "pai_de", "mae_de", "casado_com", "governa", "pertence_a", "aparece_em", "contem"];
const ENTRY_TYPES = [
  "character", "location", "region", "faction", "item", "magic_system",
  "species", "creature", "deity", "religion", "event", "lore",
  "language", "scene", "chapter", "note",
] as const;
type EntryTypeName = (typeof ENTRY_TYPES)[number];

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

  // importar .docx/.pdf: extrai o texto e a IA preenche a ficha do tipo (fiel ao documento)
  app.post("/projects/:pid/entries/import", { bodyLimit: 25 * 1024 * 1024 }, async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { filename, dataBase64, type, fields } = z.object({
      filename: z.string().min(1),
      dataBase64: z.string().min(1),
      type: z.string().min(1),
      fields: z.array(z.object({ key: z.string(), label: z.string(), options: z.array(z.string()).optional() })).default([]),
    }).parse(req.body);

    const buf = Buffer.from(dataBase64, "base64");
    const text = (await extractDocText(filename, buf)).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw httpError(422, "empty_document");

    const { text: world } = await buildProjectContext(pid);
    const keys = fields
      .map((f) => `- ${f.key} (${f.label})${f.options?.length ? ` — UM de: ${f.options.join(", ")}` : ""}`)
      .join("\n") || "(sem campos próprios)";
    const raw = await chat([
      {
        role: "system",
        content:
          `Você extrai fichas de um mundo de fantasia a partir de um DOCUMENTO enviado pelo autor. Encontre TODAS as fichas ` +
          `do tipo "${type}" descritas no documento — pode haver VÁRIAS (ex.: vários personagens num mesmo texto). ` +
          "Para CADA uma, preencha os campos do template SOMENTE com o que o documento diz sobre ela — NÃO invente; deixe " +
          "vazio o campo que o documento não cobrir. Use o CONTEXTO do mundo apenas para desambiguar nomes já existentes. " +
          'Responda SOMENTE JSON: {"entities":[{"title":string,"summary":string,"metadata":{<as chaves do template>}}]}. ' +
          "'title' = nome curto e específico; 'summary' = UMA frase. Máximo 30 fichas. Em português.\n\nCHAVES DO TEMPLATE:\n" + keys,
      },
      { role: "user", content: "CONTEXTO DO MUNDO:\n" + world.slice(0, 6000) + `\n\nDOCUMENTO (tipo "${type}"):\n` + text.slice(0, 16000) },
    ], { json: true, temperature: 0.3 });
    let out: { entities?: { title?: string; summary?: string; metadata?: Record<string, unknown> }[] } = {};
    try { out = JSON.parse(raw); } catch { throw httpError(502, "ai_invalid_response"); }
    const entities = (Array.isArray(out.entities) ? out.entities : [])
      .filter((e) => e?.title)
      .slice(0, 30)
      .map((e) => ({ title: String(e.title), summary: e.summary ? String(e.summary) : "", metadata: e.metadata ?? {} }));
    return { entities, text, words: text.split(/\s+/).filter(Boolean).length };
  });

  // ASSISTENTE DE MUNDO — gera 5 opções contextuais para a pergunta atual da entrevista
  app.post("/projects/:pid/wizard/options", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { question, answers } = z.object({
      question: z.string().min(1),
      answers: z.record(z.string()).default({}),
    }).parse(req.body);
    const { text: world } = await buildProjectContext(pid);
    const ans = Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join("\n") || "(nada ainda)";
    const raw = await chat([
      {
        role: "system",
        content:
          "Você conduz uma entrevista de worldbuilding. Para a PERGUNTA dada, ofereça 5 opções CURTAS (uma frase cada), " +
          "distintas e evocativas, COERENTES com o mundo já criado (CONTEXTO) e com as respostas anteriores. " +
          'Responda SOMENTE JSON: {"options":[5 strings]}. Em português.',
      },
      { role: "user", content: `CONTEXTO DO MUNDO:\n${world.slice(0, 4000)}\n\nRESPOSTAS ATÉ AGORA:\n${ans}\n\nPERGUNTA: ${question}` },
    ], { json: true, temperature: 0.9 });
    let out: { options?: string[] } = {};
    try { out = JSON.parse(raw); } catch { throw httpError(502, "ai_invalid_response"); }
    return { options: (out.options ?? []).filter((o) => typeof o === "string" && o.trim()).slice(0, 5) };
  });

  // ASSISTENTE DE MUNDO — consolida as respostas de uma etapa em uma ficha + conexões
  app.post("/projects/:pid/wizard/commit", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { type, importance, answers } = z.object({
      type: z.enum(ENTRY_TYPES),
      importance: z.number().int().min(0).max(5).optional(),
      answers: z.record(z.string()).default({}),
    }).parse(req.body);
    const { text: world } = await buildProjectContext(pid);
    const ans = Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join("\n") || "(sem respostas)";
    const raw = await chat([
      {
        role: "system",
        content:
          `Você monta uma ficha da bíblia de um mundo de fantasia a partir das RESPOSTAS de uma entrevista. Tipo da ficha: "${type}". ` +
          'Responda SOMENTE JSON: {"title","summary","metadata":{<campos>},"relationships":[{"target","type","reason"}]}. ' +
          "'title' = nome curto e específico (use o nome dado nas respostas, se houver); 'summary' = UMA frase; " +
          "'metadata' = organize as informações das respostas em campos coerentes; " +
          `'relationships' = conexões com fichas JÁ EXISTENTES (target = título EXATO de uma ficha do CONTEXTO; type = ${REL_VOCAB.join(", ")}). ` +
          "NUNCA relacione com fichas que não estão no contexto. Em português.",
      },
      { role: "user", content: `CONTEXTO (fichas existentes):\n${world.slice(0, 6000)}\n\nRESPOSTAS:\n${ans}` },
    ], { json: true, temperature: 0.5 });
    let out: { title?: string; summary?: string; metadata?: Record<string, unknown>; relationships?: { target?: string; type?: string }[] } = {};
    try { out = JSON.parse(raw); } catch { throw httpError(502, "ai_invalid_response"); }
    if (!out.title) out.title = answers.nome || answers.title || "Nova ficha";

    // board padrão
    let [board] = await db.select().from(boards).where(eq(boards.projectId, pid)).limit(1);
    if (!board) [board] = await db.insert(boards).values({ projectId: pid, name: "Main" }).returning();
    const existing = await db.select({ id: entries.id, title: entries.title }).from(entries).where(eq(entries.projectId, pid));
    const entryByTitle = new Map(existing.map((e) => [e.title.trim().toLowerCase(), e.id]));
    const nodeCount = (await db.select({ id: boardNodes.id }).from(boardNodes).where(eq(boardNodes.boardId, board.id))).length;

    // cria a ficha + node
    const metadata: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.metadata ?? {})) if (v != null && String(v).trim()) metadata[k] = v;
    const [entry] = await db.insert(entries).values({
      userId: req.user.sub, projectId: pid, type: type as EntryTypeName, title: out.title.trim(),
      summary: out.summary ? String(out.summary) : null, importance: importance ?? 0, metadata,
    }).returning();
    void embedEntry(entry.id).catch(() => {});
    const col = nodeCount % 5, row = Math.floor(nodeCount / 5);
    const [node] = await db.insert(boardNodes).values({
      projectId: pid, boardId: board.id, entryId: entry.id, kind: "card", x: 60 + col * 220, y: 60 + row * 130,
    }).returning();
    entryByTitle.set(entry.title.trim().toLowerCase(), entry.id);

    // conexões com fichas existentes
    const nodesByEntry = new Map((await db.select().from(boardNodes).where(eq(boardNodes.boardId, board.id))).filter((n) => n.entryId).map((n) => [n.entryId as string, n.id]));
    const connections: { target: string; type: string }[] = [];
    for (const r of out.relationships ?? []) {
      if (!r?.target || !REL_VOCAB.includes(r.type as string)) continue;
      const tgtEntry = entryByTitle.get(r.target.trim().toLowerCase());
      if (!tgtEntry || tgtEntry === entry.id) continue;
      if (r.type === "contem") {
        try { await db.insert(memberships).values({ projectId: pid, containerId: entry.id, memberId: tgtEntry }); } catch { /* ok */ }
      } else {
        await db.insert(relationships).values({ projectId: pid, sourceId: entry.id, targetId: tgtEntry, type: r.type as string });
        const tgtNode = nodesByEntry.get(tgtEntry);
        if (tgtNode) await db.insert(boardEdges).values({ projectId: pid, boardId: board.id, sourceNodeId: node.id, targetNodeId: tgtNode, label: r.type as string });
      }
      connections.push({ target: r.target, type: r.type as string });
    }

    return { entry: { id: entry.id, title: entry.title, type: entry.type }, connections };
  });

  // INGESTÃO EM LOTE: vários documentos → a IA cria as fichas (mesclando complementares) e as conexões
  app.post("/projects/:pid/import-batch", { bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { documents, types } = z.object({
      documents: z.array(z.object({ filename: z.string().min(1), dataBase64: z.string().min(1) })).min(1).max(15),
      types: z.array(z.object({
        type: z.enum(ENTRY_TYPES),
        fields: z.array(z.object({ key: z.string(), label: z.string(), options: z.array(z.string()).optional() })).default([]),
      })).min(1),
    }).parse(req.body);

    // 1) extrai texto de cada documento
    const docs: { name: string; full: string }[] = [];
    for (const d of documents) {
      let text = "";
      try { text = (await extractDocText(d.filename, Buffer.from(d.dataBase64, "base64"))).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(); }
      catch { text = ""; }
      if (text) docs.push({ name: d.filename, full: text });
    }
    if (docs.length === 0) throw httpError(422, "no_text_extracted");

    const allowed = types.map((t) => t.type);
    const tplHint = types.map((t) => {
      const keys = t.fields.map((f) => `${f.key}(${f.label})${f.options?.length ? `[${f.options.join("/")}]` : ""}`).join(", ") || "sem campos";
      return `- ${t.type}: ${keys}`;
    }).join("\n");
    const { text: world } = await buildProjectContext(pid);

    // 2) EXTRAÇÃO POR DOCUMENTO — uma chamada por doc, sem truncar (foco e fidelidade)
    type Ext = { type: string; title: string; summary?: string; metadata?: Record<string, unknown>; details?: string; sourceHeading?: string; verbatim?: string };
    const perDoc: Ext[] = [];
    for (const d of docs) {
      const raw = await chat([
        {
          role: "system",
          content:
            "Você extrai fichas de um mundo de fantasia a partir de UM documento. Encontre TODAS as fichas dos TIPOS permitidos " +
            "descritas nele — seja EXAUSTIVO e FIEL: NÃO invente, NÃO resuma demais e NÃO omita personagens/elementos citados. " +
            'Responda SOMENTE JSON: {"entities":[{"type","title","summary","metadata":{<campos do template>},"details","sourceHeading"}]}. ' +
            "'summary' = UMA frase; 'metadata' = os campos do template preenchidos com o que o doc diz; " +
            "'details' = descrição RICA e fiel reunindo as informações relevantes daquela ficha no documento (até ~1600 caracteres). " +
            "'sourceHeading' = APENAS para fichas de tipo chapter/scene: copie EXATAMENTE a linha de título daquele capítulo/cena " +
            "como aparece no documento (para eu recuperar o texto integral). Para os outros tipos, null. " +
            "IMPORTANTE: se o documento tiver capítulos ou cenas (ex.: 'Capítulo 1 – A Recusa', 'Cena 3 – ...'), crie UMA ficha " +
            "do tipo chapter (ou scene) para CADA UM deles, sem pular nenhum. E NUNCA use o tipo chapter/scene para pessoas, " +
            "sistemas ou lugares — personagens são character, e assim por diante. " +
            "Use SOMENTE os tipos permitidos. Em português.\n\nTIPOS PERMITIDOS E CAMPOS:\n" + tplHint,
        },
        { role: "user", content: `DOCUMENTO "${d.name}":\n\n${d.full.slice(0, 55000)}` },
      ], { json: true, temperature: 0.2, model: EXTRACT_MODEL });
      let ents: Ext[] = [];
      try {
        const p = JSON.parse(raw) as { entities?: Ext[] };
        ents = (p.entities ?? []).filter((e) => e?.title && e?.type && (allowed as string[]).includes(e.type));
      } catch { ents = []; }

      // capítulos/cenas: recupera o TEXTO INTEGRAL (verbatim) fatiando o doc entre os cabeçalhos
      const chapters = ents
        .filter((e) => MANUSCRIPT_TYPES.has(e.type) && e.sourceHeading)
        .map((e) => ({ e, idx: d.full.toLowerCase().indexOf(String(e.sourceHeading).trim().toLowerCase()) }))
        .filter((p) => p.idx >= 0)
        .sort((a, b) => a.idx - b.idx);
      for (let i = 0; i < chapters.length; i++) {
        const start = chapters[i].idx;
        const end = i + 1 < chapters.length ? chapters[i + 1].idx : d.full.length;
        chapters[i].e.verbatim = d.full.slice(start, end).trim().slice(0, 40000);
      }
      perDoc.push(...ents);
    }
    if (perDoc.length === 0) throw httpError(422, "no_entities_extracted");
    const norm = (s: string) => s.trim().toLowerCase();

    // 2.5) CANONICALIZAÇÃO POR TIPO — funde variações do MESMO nome, nunca entidades/tipos diferentes
    interface Group { canonicalTitle: string; type: string; indices: number[]; }
    const byType = new Map<string, number[]>();
    perDoc.forEach((e, i) => { const a = byType.get(e.type) ?? []; a.push(i); byType.set(e.type, a); });
    const groups: Group[] = [];
    for (const [t, idxs] of byType) {
      if (idxs.length === 1) { groups.push({ canonicalTitle: perDoc[idxs[0]].title, type: t, indices: [idxs[0]] }); continue; }
      let sub: Group[] = [];
      try {
        const list = idxs.map((gi, k) => `${k}. ${perDoc[gi].title}${perDoc[gi].summary ? ` — ${String(perDoc[gi].summary).slice(0, 60)}` : ""}`).join("\n");
        const raw = await chat([
          {
            role: "system",
            content:
              `Abaixo há fichas do MESMO tipo ("${t}") extraídas de documentos diferentes. Algumas podem ser a MESMA entidade com o ` +
              "nome escrito de formas variadas (ex.: 'Kael', 'KAEL VALTHOR' e 'Kael Fragmentos' são a MESMA pessoa). " +
              "Agrupe SOMENTE quando for CLARAMENTE a mesma entidade — NA DÚVIDA, DEIXE SEPARADO. " +
              "Entidades diferentes (capítulos diferentes, pessoas diferentes) NUNCA devem ser agrupadas. " +
              'Responda SOMENTE JSON: {"groups":[{"canonicalTitle","indices":[números]}]}. Todo índice em EXATAMENTE um grupo.',
          },
          { role: "user", content: list },
        ], { json: true, temperature: 0.1 });
        const gs = (JSON.parse(raw).groups ?? []) as { canonicalTitle?: string; indices?: number[] }[];
        const seenLocal = new Set<number>();
        for (const g of gs) {
          const local = (g.indices ?? []).filter((k) => Number.isInteger(k) && k >= 0 && k < idxs.length && !seenLocal.has(k) && (seenLocal.add(k), true));
          if (local.length === 0 || !g.canonicalTitle) continue;
          sub.push({ canonicalTitle: String(g.canonicalTitle), type: t, indices: local.map((k) => idxs[k]) });
        }
        for (let k = 0; k < idxs.length; k++) if (!seenLocal.has(k)) sub.push({ canonicalTitle: perDoc[idxs[k]].title, type: t, indices: [idxs[k]] });
        // trava anti-superfusão: se um grupo engoliu mais da metade, a canonicalização errou → descarta
        if (sub.some((g) => g.indices.length > Math.max(3, idxs.length / 2))) sub = [];
      } catch { sub = []; }
      if (sub.length === 0) { // fallback seguro: funde só por título idêntico
        const m = new Map<string, number[]>();
        for (const gi of idxs) { const k = norm(perDoc[gi].title); const a = m.get(k) ?? []; a.push(gi); m.set(k, a); }
        for (const [, arr] of m) sub.push({ canonicalTitle: perDoc[arr[0]].title, type: t, indices: arr });
      }
      groups.push(...sub);
    }

    // 3) monta as fichas consolidadas a partir dos grupos (soma summaries/metadata/details)
    interface Merged { type: string; title: string; summaries: string[]; metadata: Record<string, unknown>; details: string[]; verbatim: string[]; }
    const mergedList: Merged[] = groups.slice(0, 90).map((g) => {
      const items = g.indices.map((i) => perDoc[i]);
      const metadata: Record<string, unknown> = {};
      for (const it of items) for (const [k, v] of Object.entries(it.metadata ?? {})) if (v != null && String(v).trim() && !metadata[k]) metadata[k] = v;
      // o tipo vem do VOTO dos itens extraídos (a canonicalização às vezes erra o tipo)
      const counts = new Map<string, number>();
      for (const it of items) counts.set(it.type, (counts.get(it.type) ?? 0) + 1);
      const votedType = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return {
        type: votedType, title: g.canonicalTitle.trim(),
        summaries: items.map((it) => it.summary).filter((s): s is string => !!s).map(String),
        metadata,
        details: items.map((it) => it.details).filter((s): s is string => !!s).map(String),
        verbatim: items.map((it) => it.verbatim).filter((s): s is string => !!s).map(String),
      };
    });

    // 4) board + fichas existentes
    let [board] = await db.select().from(boards).where(eq(boards.projectId, pid)).limit(1);
    if (!board) [board] = await db.insert(boards).values({ projectId: pid, name: "Main" }).returning();
    const existingEntries = await db.select({ id: entries.id, title: entries.title }).from(entries).where(eq(entries.projectId, pid));
    const entryByTitle = new Map(existingEntries.map((e) => [norm(e.title), e.id]));
    const existingNodes = await db.select().from(boardNodes).where(eq(boardNodes.boardId, board.id));
    const nodeByEntry = new Map(existingNodes.filter((n) => n.entryId).map((n) => [n.entryId as string, n.id]));
    const entryIdByTitle = new Map<string, string>(entryByTitle);
    const nodeIdByTitle = new Map<string, string>();
    const gridStart = existingNodes.length;
    let gi = 0, createdCards = 0;

    for (const m of mergedList) {
      const key = norm(m.title);
      let entryId = entryByTitle.get(key);
      if (!entryId) {
        // capítulo/cena → manuscrito VERBATIM do documento; demais tipos → descrição rica extraída
        const verbatimText = m.verbatim.join("\n\n").slice(0, 40000);
        const detailText = m.details.join("\n\n").slice(0, 14000);
        const bodyText = MANUSCRIPT_TYPES.has(m.type) && verbatimText ? verbatimText : detailText;
        const [entry] = await db.insert(entries).values({
          userId: req.user.sub, projectId: pid, type: m.type as EntryTypeName, title: m.title,
          summary: m.summaries[0] ?? null, metadata: m.metadata,
          body: bodyText ? textToDoc(bodyText) : {}, // texto-fonte guardado na ficha (fica indexado)
        }).returning();
        entryId = entry.id;
        entryByTitle.set(key, entryId);
        void embedEntry(entryId).catch(() => {});
        createdCards++;
      }
      entryIdByTitle.set(key, entryId);
      let nodeId = nodeByEntry.get(entryId);
      if (!nodeId) {
        const col = (gridStart + gi) % 5, row = Math.floor((gridStart + gi) / 5);
        const [n] = await db.insert(boardNodes).values({ projectId: pid, boardId: board.id, entryId, kind: "card", x: 60 + col * 240, y: 60 + row * 150 }).returning();
        nodeId = n.id; nodeByEntry.set(entryId, nodeId); gi++;
      }
      nodeIdByTitle.set(key, nodeId);
    }

    // 5) PASSE DE RELAÇÕES sobre a lista consolidada
    let createdRels = 0;
    const entList = mergedList.map((m) => `- [${m.type}] ${m.title}: ${(m.summaries[0] ?? "").slice(0, 120)}`).join("\n");
    const relRaw = await chat([
      {
        role: "system",
        content:
          "Dada a LISTA de fichas de um mundo de fantasia, identifique as RELAÇÕES entre elas (e com as fichas já existentes). " +
          'Responda SOMENTE JSON: {"relationships":[{"source","target","type"}]}. ' +
          `'type' ∈ ${REL_VOCAB.join(", ")} (contem = hierarquia/contenção). 'source'/'target' = títulos EXATOS da lista. ` +
          "Seja generoso nas relações plausíveis (família, aliados, inimigos, mentor/aprendiz, pertence a facção/sistema, governa, aparece em local). Em português.",
      },
      { role: "user", content: `FICHAS:\n${entList}\n\nFICHAS JÁ EXISTENTES NO MUNDO:\n${world.slice(0, 3000)}` },
    ], { json: true, temperature: 0.4 });
    let rels: { source?: string; target?: string; type?: string }[] = [];
    try { rels = (JSON.parse(relRaw).relationships ?? []) as typeof rels; } catch { rels = []; }
    for (const r of rels) {
      if (!r?.source || !r?.target || !REL_VOCAB.includes(r.type as string)) continue;
      const sk = norm(r.source), tk = norm(r.target);
      const sEntry = entryIdByTitle.get(sk), tEntry = entryIdByTitle.get(tk);
      if (!sEntry || !tEntry || sEntry === tEntry) continue;
      if (r.type === "contem") {
        try { await db.insert(memberships).values({ projectId: pid, containerId: sEntry, memberId: tEntry }); createdRels++; } catch { /* ok */ }
        continue;
      }
      await db.insert(relationships).values({ projectId: pid, sourceId: sEntry, targetId: tEntry, type: r.type as string });
      const sNode = nodeIdByTitle.get(sk), tNode = nodeIdByTitle.get(tk);
      if (sNode && tNode) await db.insert(boardEdges).values({ projectId: pid, boardId: board.id, sourceNodeId: sNode, targetNodeId: tNode, label: r.type as string });
      createdRels++;
    }

    return { cards: createdCards, relationships: createdRels, entities: mergedList.map((m) => ({ type: m.type, title: m.title })), docs: docs.map((d) => d.name) };
  });

  // "deixar a IA rascunhar": preenche o template do tipo respeitando magia/clima/tom do mundo
  app.post("/projects/:pid/entries/draft", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { type, title, importance, fields } = z.object({
      type: z.string().min(1),
      title: z.string().optional(),
      importance: z.number().int().min(0).max(5).optional(),
      fields: z.array(z.object({ key: z.string(), label: z.string(), options: z.array(z.string()).optional() })).default([]),
    }).parse(req.body);
    const { text: world } = await buildProjectContext(pid);
    const keys = fields
      .map((f) => `- ${f.key} (${f.label})${f.options?.length ? ` — escolha UM: ${f.options.join(", ")}` : ""}`)
      .join("\n") || "(sem campos próprios)";
    const raw = await chat([
      {
        role: "system",
        content:
          "Você rascunha fichas para a bíblia de um mundo de fantasia. Preencha o template respeitando a MAGIA, o CLIMA e " +
          "o TOM do mundo do CONTEXTO — coerente com o que já existe, sem contradizer nada. Seja concreto e específico " +
          "(nomes, detalhes próprios deste mundo), nunca genérico. Escreva em português.\n" +
          'Responda SOMENTE JSON: {"title": string, "summary": string, "metadata": {<as chaves do template>}}. ' +
          "'summary' = UMA frase que resume a ficha. Preencha TODAS as chaves listadas.\n\nCHAVES DO TEMPLATE:\n" + keys,
      },
      {
        role: "user",
        content: "CONTEXTO DO MUNDO:\n" + world + `\n\nRascunhe uma ficha do tipo "${type}"` +
          (title?.trim() ? ` chamada "${title.trim()}".` : " (invente o nome).") +
          (importance != null ? ` Peso na história: ${importance} de 4.` : ""),
      },
    ], { json: true, temperature: 0.8 });
    let out: { title?: string; summary?: string; metadata?: Record<string, unknown> } = {};
    try { out = JSON.parse(raw); } catch { throw httpError(502, "ai_invalid_response"); }
    return { title: out.title ?? title ?? "", summary: out.summary ?? "", metadata: out.metadata ?? {} };
  });

  // assistente da cena (modo foco): sussurro criativo + checagem de continuidade contra a bíblia, numa chamada
  app.post("/projects/:pid/scenes/assist", async (req) => {
    const { pid } = req.params as { pid: string };
    await requireProject(req.user.sub, pid);
    const { text } = z.object({ text: z.string().default("") }).parse(req.body);
    const { text: world } = await buildProjectContext(pid);
    const raw = await chat([
      {
        role: "system",
        content:
          "Você é o assistente de escrita do autor, guardião da BÍBLIA deste mundo de fantasia. Recebe um TRECHO de " +
          'manuscrito (uma cena) e a BÍBLIA. Responda SOMENTE JSON: {"whisper": string, "continuity": [{"issue": string}]}.\n' +
          "- 'whisper': UMA sugestão curta e sutil (máx 240 caracteres, em português) que aprofunde a cena — motivação, " +
          "tensão ou subtexto — baseada na personalidade e nas relações das fichas envolvidas. Tom de sussurro, nunca uma ordem.\n" +
          "- 'continuity': lista (máx 3) de CONTRADIÇÕES entre o trecho e a bíblia (fatos, status como exilado/morto, " +
          "localização, linha do tempo). Cada item {\"issue\"}: 1 frase citando a ficha e o conflito. Vazio se nada contradiz.",
      },
      { role: "user", content: "BÍBLIA:\n" + world + "\n\nTRECHO DA CENA:\n" + (text.slice(0, 6000) || "(cena vazia)") },
    ], { json: true, temperature: 0.5 });
    let out: { whisper?: string; continuity?: { issue?: string }[] } = {};
    try { out = JSON.parse(raw); } catch { throw httpError(502, "ai_invalid_response"); }
    const continuity = Array.isArray(out.continuity) ? out.continuity.filter((c) => c?.issue).map((c) => ({ issue: c.issue as string })) : [];
    return { whisper: out.whisper ?? null, continuity };
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
        "perguntar o óbvio (aproveite regiões/locais já existentes).\n" +
        "Responda SEMPRE em JSON com EXATAMENTE UM campo:\n" +
        '- Para continuar: {"ask": <string>} onde a string é uma pergunta CONCRETA e específica a este mundo. ' +
        "NUNCA use texto genérico/placeholder (jamais responda literalmente 'próxima pergunta') e NUNCA repita uma pergunta já feita.\n" +
        '- Quando já tiver o suficiente: {"prompt": <string>} onde a string é uma descrição RICA em INGLÊS para um ' +
        "gerador de imagens desenhar o mapa (inclua estilo cartográfico, regiões nomeadas, geografia, paleta; comece por " +
        "'a fantasy world map, top-down'; sem texto ilegível). " +
        "Nunca inclua 'ask' e 'prompt' juntos.\n\nCONTEXTO DO MUNDO:\n" + text,
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
