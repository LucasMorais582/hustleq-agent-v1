import OpenAI from "openai";
import type { AgentInput } from "../types/agent.types.js";
import type { ChatCompletionMessageParam } from "openai/resources";

function getModeInstruction(mode?: string) {
  switch (mode) {
    case "IDEAS":
      return `
Foque principalmente em ideias de conteúdo.
Capriche na seção "Ideias de conteúdo".
`;

    case "ANALYSIS":
      return `
Foque principalmente em análise estratégica.
Aprofunde o diagnóstico.
`;

    case "CAPTION":
      return `
Foque principalmente em escrita persuasiva.
Capriche na seção de exemplos com legendas completas.
`;

    default:
      return "Responda normalmente como consultor.";
  }
}

export async function runAgent(input: AgentInput) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const systemPrompt = `
Você é um consultor especialista em marketing para Instagram.

Seu objetivo é ajudar o cliente a crescer seguidores, aumentar engajamento e gerar vendas.

REGRAS:
- Seja direto, estratégico e prático
- Evite respostas genéricas
- Sempre personalize com base no contexto
- Sempre traga exemplos concretos

FORMATO OBRIGATÓRIO DE RESPOSTA:

Responda SEMPRE em JSON válido.

{
  "diagnostic": "análise do perfil",
  "strategy": "estratégia geral",
  "ideas": ["ideia 1", "ideia 2", "ideia 3"],
  "examples": "exemplo de legenda ou post",
  "postingFrequency": "frequência recomendada",
  "bestTime": "melhores horários"
}

REGRAS:
- NÃO responda em texto
- NÃO use markdown
- NÃO explique nada fora do JSON

IMPORTANTE:
- Nunca responda fora desse formato
- Nunca deixe seções vazias
`;

  const modeInstruction = getModeInstruction(input.mode);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },

    ...(input.history || []),

    {
      role: "user",
      content: `
MODO:
${modeInstruction}

DADOS DO PERFIL:
${JSON.stringify(input.instagramData)}

CONTEXTO DO NEGÓCIO:
${JSON.stringify(input.businessContext)}

PERGUNTA:
${input.userMessage}
      `,
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.7,
  });


    const content = response.choices[0]?.message.content;

    let parsed;

    try {
    parsed = JSON.parse(content || "{}");
    } catch (err) {
    console.error("Erro ao parsear JSON:", content);
    parsed = { raw: content };
    }

    return parsed;
}