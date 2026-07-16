// Cliente OpenAI mínimo via fetch (sem SDK). Chave lida de OPENAI_API_KEY.
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
const BASE = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

export const aiEnabled = () => !!process.env.OPENAI_API_KEY;

function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) {
    const err = new Error("ai_not_configured") as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
  return k;
}

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`openai_embed_${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

export interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }

export async function chat(messages: ChatMsg[], opts: { temperature?: number; json?: boolean } = {}): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: opts.temperature ?? 0.4,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`openai_chat_${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0].message.content ?? "";
}

// versão streaming: chama onDelta a cada token e devolve o texto completo ao final.
export async function chatStream(
  messages: ChatMsg[],
  opts: { temperature?: number },
  onDelta: (text: string) => void,
): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({ model: CHAT_MODEL, messages, temperature: opts.temperature ?? 0.4, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`openai_chat_${res.status}: ${await res.text().catch(() => "")}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // guarda a linha incompleta
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (delta) { full += delta; onDelta(delta); }
      } catch { /* ignora keep-alives / fragmentos */ }
    }
  }
  return full;
}
