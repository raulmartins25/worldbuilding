import { useCallback, useEffect, useState } from "react";
import { IconWand, IconX, IconArrowRight, IconCheck } from "@tabler/icons-react";
import { api } from "../lib/api";
import { type EntryType } from "../lib/types";
import { typeMeta } from "../lib/entryTypes";
import { EntryIcon } from "../lib/EntryIcon";

interface Question { field: string; q: string; }
interface Section { key: string; type: EntryType; importance: number; title: string; repeatable?: boolean; questions: Question[]; }

const SECTIONS: Section[] = [
  { key: "mundo", type: "lore", importance: 0, title: "O Mundo", questions: [
    { field: "tom", q: "Que tom define o seu mundo?" },
    { field: "genero", q: "Que gênero mais combina com ele?" },
    { field: "conflito", q: "Qual é a grande tensão central do mundo?" },
    { field: "epoca", q: "Em que época ou nível de civilização ele vive?" },
    { field: "geografia", q: "Que paisagem domina o mundo?" },
    { field: "singular", q: "O que torna esse mundo único, diferente de qualquer outro?" },
  ] },
  { key: "historia", type: "lore", importance: 0, title: "História & Mito", questions: [
    { field: "origem", q: "Como o mundo (ou a vida nele) começou, segundo o mito?" },
    { field: "cataclismo", q: "Que grande evento do passado ainda assombra o presente?" },
    { field: "era_atual", q: "Que era o mundo vive agora?" },
    { field: "segredo", q: "Que verdade histórica foi esquecida ou escondida?" },
  ] },
  { key: "reino", type: "region", importance: 0, title: "Reino Principal", questions: [
    { field: "nome", q: "Qual o nome do reino ou região central da história?" },
    { field: "governo", q: "Como ele é governado?" },
    { field: "clima", q: "Que clima e terreno predominam ali?" },
    { field: "povo", q: "Como é o povo que vive nele?" },
    { field: "tensao", q: "Que conflito interno ferve nesse reino?" },
  ] },
  { key: "magia", type: "magic_system", importance: 0, title: "Sistema de Magia", questions: [
    { field: "fonte", q: "De onde vem o poder mágico?" },
    { field: "custo", q: "Qual é o preço de usar magia?" },
    { field: "quem", q: "Quem consegue usar magia?" },
    { field: "regras", q: "Qual a regra mais importante da magia?" },
    { field: "limite", q: "Qual a maior limitação da magia?" },
    { field: "manifestacao", q: "Como a magia se manifesta visualmente?" },
  ] },
  { key: "religiao", type: "religion", importance: 0, title: "Religião & Panteão", questions: [
    { field: "divindade", q: "Qual força ou divindade é mais reverenciada?" },
    { field: "dogma", q: "Qual a crença central dessa fé?" },
    { field: "simbolo", q: "Qual o símbolo ou ritual que a representa?" },
    { field: "relacao_magia", q: "Como a religião enxerga a magia?" },
  ] },
  { key: "faccao", type: "faction", importance: 0, title: "Facção Dominante", questions: [
    { field: "nome", q: "Qual o nome da facção mais influente?" },
    { field: "lider", q: "Quem a lidera?" },
    { field: "objetivo", q: "O que ela quer, acima de tudo?" },
    { field: "metodo", q: "Como ela busca isso?" },
    { field: "inimigo", q: "Quem é o maior inimigo dela?" },
  ] },
  { key: "protagonista", type: "character", importance: 4, title: "Protagonista", questions: [
    { field: "nome", q: "Quem é o seu protagonista? (nome ou arquétipo)" },
    { field: "objetivo", q: "O que move esse protagonista?" },
    { field: "ferida", q: "Que ferida do passado o marca?" },
    { field: "medo", q: "Qual o maior medo dele?" },
    { field: "relacao_magia", q: "Qual a relação dele com a magia do mundo?" },
    { field: "arco", q: "Que transformação ele viverá na história?" },
  ] },
  { key: "antagonista", type: "character", importance: 4, title: "Antagonista", questions: [
    { field: "nome", q: "Quem se opõe ao protagonista? (nome ou papel)" },
    { field: "motivacao", q: "Por que o antagonista acredita estar certo?" },
    { field: "metodo", q: "Como ele age para conseguir o que quer?" },
    { field: "vinculo", q: "Que laço (passado ou presente) o liga ao protagonista?" },
    { field: "forca", q: "Qual a maior força ou recurso dele?" },
  ] },
  { key: "coadjuvante", type: "character", importance: 2, title: "Coadjuvante", repeatable: true, questions: [
    { field: "nome", q: "Quem é esse coadjuvante? (nome ou papel)" },
    { field: "relacao_protagonista", q: "Qual a relação dele com o protagonista?" },
    { field: "funcao", q: "Que função ele cumpre na história?" },
    { field: "segredo", q: "Que segredo ou peculiaridade ele carrega?" },
  ] },
  { key: "criatura", type: "creature", importance: 0, title: "Criatura Emblemática", questions: [
    { field: "nome", q: "Que criatura marca esse mundo?" },
    { field: "habitat", q: "Onde ela vive?" },
    { field: "perigo", q: "Por que ela é temida (ou reverenciada)?" },
    { field: "relacao", q: "Como ela se relaciona com a magia ou o povo?" },
  ] },
  { key: "artefato", type: "item", importance: 0, title: "Artefato Central", questions: [
    { field: "nome", q: "Qual objeto tem peso na trama?" },
    { field: "poder", q: "Que poder ou propriedade ele guarda?" },
    { field: "origem", q: "De onde ele veio?" },
    { field: "cobica", q: "Quem o cobiça e por quê?" },
  ] },
];

interface CreatedCard { title: string; type: string; connections: { target: string; type: string }[]; }

export function WorldWizard({ projectId, projectName, onClose, onDone }: {
  projectId: string; projectName: string; onClose: () => void; onDone: () => void;
}) {
  const [si, setSi] = useState(0);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<string[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [custom, setCustom] = useState("");
  const [phase, setPhase] = useState<"asking" | "committing" | "sectionDone" | "finished">("asking");
  const [created, setCreated] = useState<CreatedCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  const section = SECTIONS[si];
  const question = section?.questions[qi];

  const fetchOptions = useCallback(async () => {
    if (!question) return;
    setLoadingOpts(true); setOptions([]); setError(null);
    try {
      const r = await api.post<{ options: string[] }>(`/projects/${projectId}/wizard/options`, { question: question.q, answers });
      setOptions(r.options ?? []);
    } catch { setOptions([]); } finally { setLoadingOpts(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, si, qi]);

  useEffect(() => { if (phase === "asking") void fetchOptions(); }, [phase, fetchOptions]);

  async function commitSection(finalAnswers: Record<string, string>) {
    setPhase("committing"); setError(null);
    try {
      const r = await api.post<CreatedCard & { entry: { title: string; type: string } }>(
        `/projects/${projectId}/wizard/commit`,
        { type: section.type, importance: section.importance, answers: finalAnswers },
      );
      setCreated((c) => [...c, { title: r.entry.title, type: r.entry.type, connections: r.connections ?? [] }]);
      if (section.repeatable) setPhase("sectionDone");
      else advanceSection();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao criar a ficha");
      setPhase("asking");
    }
  }

  function advanceSection() {
    if (si + 1 < SECTIONS.length) { setSi(si + 1); setQi(0); setAnswers({}); setCustom(""); setPhase("asking"); }
    else setPhase("finished");
  }

  function skipSection() {
    setError(null);
    advanceSection();
  }

  function answer(value: string) {
    const v = value.trim();
    if (!v) return;
    const next = { ...answers, [question.field]: v };
    setAnswers(next); setCustom("");
    if (qi + 1 < section.questions.length) { setQi(qi + 1); }
    else void commitSection(next);
  }

  const totalSteps = SECTIONS.length;

  return (
    <div className="modal-backdrop" style={{ position: "fixed", inset: 0, zIndex: 59, background: "rgba(15,18,30,.5)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "5vh" }}>
      <div className="modal-sheet" style={{ width: 680, maxWidth: "95vw", maxHeight: "90vh", background: "var(--panel)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 40px rgba(20,24,40,.28)", display: "flex", flexDirection: "column" }}>
        <div className="row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <IconWand size={18} color="var(--accent)" />
          <strong className="grow" style={{ fontWeight: 500 }}>Assistente de mundo</strong>
          <span className="muted" style={{ fontSize: 12 }}>em {projectName}</span>
          <button onClick={onClose} title="fechar" style={{ border: "none", background: "transparent" }}><IconX size={18} /></button>
        </div>

        {/* progresso das etapas */}
        <div className="row" style={{ padding: "10px 16px 0", gap: 6 }}>
          {SECTIONS.map((s, i) => (
            <div key={s.key} style={{ flex: 1, height: 5, borderRadius: 999, background: i < si || phase === "finished" ? "var(--success)" : i === si ? "var(--accent)" : "var(--border)" }} title={s.title} />
          ))}
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {phase !== "finished" && (
            <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
              Etapa {si + 1}/{totalSteps} · {section.title}
            </div>
          )}

          {phase === "asking" && question && (
            <>
              <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 14 }}>{question.q}</div>
              <div className="stack" style={{ gap: 8 }}>
                {loadingOpts && <div className="muted">pensando em opções…</div>}
                {options.map((o, i) => (
                  <button key={i} onClick={() => answer(o)} style={{ textAlign: "left", padding: "10px 12px", borderRadius: 10, fontSize: 14, lineHeight: 1.4 }}>
                    {o}
                  </button>
                ))}
              </div>
              <div className="row" style={{ marginTop: 12, gap: 8 }}>
                <input className="grow" placeholder="Escrever o meu…" value={custom} onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") answer(custom); }} />
                <button className="primary" onClick={() => answer(custom)} disabled={!custom.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  Usar <IconArrowRight size={15} />
                </button>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <span className="muted grow" style={{ fontSize: 12 }}>Pergunta {qi + 1} de {section.questions.length}</span>
                <button onClick={skipSection} style={{ fontSize: 12, padding: "3px 10px", color: "var(--muted)" }}>Pular esta etapa →</button>
              </div>
              {error && <div style={{ color: "var(--danger)", marginTop: 10 }}>{error}</div>}
            </>
          )}

          {phase === "committing" && (
            <div className="stack" style={{ alignItems: "center", padding: "24px 0" }}>
              <IconWand size={28} color="var(--accent)" />
              <div className="muted">Criando <strong>{section.title}</strong> e conectando ao mundo…</div>
            </div>
          )}

          {phase === "sectionDone" && (
            <div className="stack" style={{ gap: 12 }}>
              <div className="card" style={{ borderColor: "var(--success)", background: "color-mix(in srgb, var(--success) 8%, var(--panel))" }}>
                <IconCheck size={16} color="var(--success)" /> <strong style={{ fontWeight: 500 }}>{created[created.length - 1]?.title}</strong> criado e conectado.
              </div>
              <div className="row">
                <button className="primary" onClick={() => { setQi(0); setAnswers({}); setCustom(""); setPhase("asking"); }}>+ Outro coadjuvante</button>
                <button onClick={advanceSection}>Concluir esta parte</button>
              </div>
            </div>
          )}

          {phase === "finished" && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="card" style={{ borderColor: "var(--success)", background: "color-mix(in srgb, var(--success) 8%, var(--panel))" }}>
                <strong style={{ fontWeight: 500 }}>Mundo montado!</strong> Criei {created.length} ficha{created.length === 1 ? "" : "s"} conectadas.
              </div>
            </div>
          )}

          {/* fichas já criadas nesta sessão */}
          {created.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Criado até agora ({created.length})</div>
              <div className="stack" style={{ gap: 4 }}>
                {created.map((c, i) => {
                  const m = typeMeta(c.type);
                  return (
                    <div key={i} className="row" style={{ gap: 8, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 8 }}>
                      <EntryIcon type={c.type} size={16} color={m.color} />
                      <strong className="grow" style={{ fontWeight: 500, fontSize: 13 }}>{c.title}</strong>
                      {c.connections.length > 0 && <span className="muted" style={{ fontSize: 11 }}>{c.connections.length} conexõe{c.connections.length === 1 ? "m" : "s"}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="row" style={{ padding: 12, borderTop: "1px solid var(--border)", justifyContent: "flex-end" }}>
          {phase === "finished" ? (
            <button className="primary" onClick={onDone}>Ver no quadro</button>
          ) : (
            <button onClick={onClose}>Sair (mantém o que já criei)</button>
          )}
        </div>
      </div>
    </div>
  );
}
