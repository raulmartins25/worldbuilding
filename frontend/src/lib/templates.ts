import type { EntryType } from "./types";

export interface Field {
  key: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select";
  options?: string[];
}

// campos específicos por tipo (salvos em entry.metadata). "" = sem campos próprios.
export const TYPE_TEMPLATES: Record<EntryType, Field[]> = {
  character: [
    { key: "raca", label: "Raça / Espécie", kind: "text" },
    { key: "idade", label: "Idade", kind: "text" },
    { key: "ocupacao", label: "Ocupação / Papel", kind: "text" },
    { key: "aparencia", label: "Aparência", kind: "textarea" },
    { key: "personalidade", label: "Personalidade", kind: "textarea" },
    { key: "objetivo", label: "Objetivo / Motivação", kind: "textarea" },
  ],
  location: [
    { key: "tipo", label: "Tipo", kind: "select", options: ["cidade", "vila", "fortaleza", "ruína", "floresta", "montanha", "masmorra", "outro"] },
    { key: "clima", label: "Clima", kind: "text" },
    { key: "populacao", label: "População", kind: "text" },
    { key: "geografia", label: "Geografia", kind: "textarea" },
    { key: "pontos", label: "Pontos de referência", kind: "textarea" },
  ],
  region: [
    { key: "capital", label: "Capital", kind: "text" },
    { key: "governo", label: "Governo", kind: "text" },
    { key: "populacao", label: "População", kind: "text" },
    { key: "clima", label: "Clima predominante", kind: "text" },
    { key: "extensao", label: "Extensão / Fronteiras", kind: "textarea" },
  ],
  faction: [
    { key: "lider", label: "Líder", kind: "text" },
    { key: "sede", label: "Sede", kind: "text" },
    { key: "tamanho", label: "Tamanho / Poder", kind: "text" },
    { key: "objetivo", label: "Objetivo", kind: "textarea" },
    { key: "aliados", label: "Aliados", kind: "text" },
    { key: "inimigos", label: "Inimigos", kind: "text" },
  ],
  item: [
    { key: "tipo", label: "Tipo", kind: "text" },
    { key: "raridade", label: "Raridade", kind: "select", options: ["comum", "incomum", "raro", "lendário", "único"] },
    { key: "poderes", label: "Poderes / Propriedades", kind: "textarea" },
    { key: "dono", label: "Dono atual", kind: "text" },
    { key: "origem", label: "Origem", kind: "textarea" },
  ],
  magic_system: [
    { key: "fonte", label: "Fonte do poder", kind: "text" },
    { key: "custo", label: "Custo", kind: "textarea" },
    { key: "regras", label: "Regras", kind: "textarea" },
    { key: "limitacoes", label: "Limitações", kind: "textarea" },
  ],
  species: [
    { key: "aparencia", label: "Aparência", kind: "textarea" },
    { key: "habitat", label: "Habitat", kind: "text" },
    { key: "comportamento", label: "Comportamento", kind: "textarea" },
    { key: "vida", label: "Expectativa de vida", kind: "text" },
  ],
  creature: [
    { key: "habitat", label: "Habitat", kind: "text" },
    { key: "dieta", label: "Dieta", kind: "text" },
    { key: "tamanho", label: "Tamanho", kind: "text" },
    { key: "perigo", label: "Nível de perigo", kind: "select", options: ["inofensivo", "baixo", "moderado", "alto", "letal"] },
    { key: "habilidades", label: "Habilidades", kind: "textarea" },
  ],
  deity: [
    { key: "dominio", label: "Domínio", kind: "text" },
    { key: "simbolo", label: "Símbolo", kind: "text" },
    { key: "alinhamento", label: "Alinhamento", kind: "text" },
    { key: "seguidores", label: "Seguidores", kind: "text" },
  ],
  religion: [
    { key: "divindade", label: "Divindade(s)", kind: "text" },
    { key: "doutrina", label: "Doutrina", kind: "textarea" },
    { key: "rituais", label: "Rituais", kind: "textarea" },
    { key: "hierarquia", label: "Hierarquia", kind: "textarea" },
  ],
  event: [
    { key: "ano", label: "Ano / Data", kind: "text" },
    { key: "local", label: "Local", kind: "text" },
    { key: "participantes", label: "Participantes", kind: "textarea" },
    { key: "causa", label: "Causa", kind: "textarea" },
    { key: "consequencias", label: "Consequências", kind: "textarea" },
  ],
  lore: [
    { key: "origem", label: "Origem", kind: "textarea" },
    { key: "veracidade", label: "Veracidade", kind: "select", options: ["fato", "lenda", "boato", "profecia"] },
    { key: "relevancia", label: "Relevância", kind: "textarea" },
  ],
  language: [
    { key: "falantes", label: "Falantes", kind: "text" },
    { key: "escrita", label: "Sistema de escrita", kind: "text" },
    { key: "origem", label: "Origem", kind: "textarea" },
  ],
  scene: [
    { key: "local", label: "Local", kind: "text" },
    { key: "personagens", label: "Personagens", kind: "textarea" },
    { key: "resumo", label: "Resumo", kind: "textarea" },
    { key: "capitulo", label: "Capítulo", kind: "text" },
  ],
  chapter: [
    { key: "numero", label: "Número", kind: "number" },
    { key: "pov", label: "Ponto de vista", kind: "text" },
    { key: "resumo", label: "Resumo", kind: "textarea" },
    { key: "cenas", label: "Cenas", kind: "textarea" },
  ],
  note: [],
};

// tipos que podem ser "entrevistados" (têm voz)
export const INTERVIEWABLE = new Set<EntryType>(["character", "creature", "deity"]);
