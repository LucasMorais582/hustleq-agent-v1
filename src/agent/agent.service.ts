import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AgentInput } from "../types/agent.types.js";

export async function runAgent(input: AgentInput) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const systemPrompt = `
Você é um consultor especialista em marketing para Instagram.

Seu objetivo é ajudar o cliente a crescer seguidores, aumentar engajamento e gerar vendas.

Sempre:
- Seja direto e prático
- Use exemplos reais
- Evite respostas genéricas

Quando possível, inclua:
- Ideias de posts
- Sugestões de legenda
- Frequência ideal
- Horários recomendados

Responda sempre estruturado com:

## Diagnóstico
## Estratégia
## Exemplos práticos
`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },

    // histórico da conversa
    ...(input.history || []),

    // contexto fixo
    {
      role: "user",
      content: `
DADOS DO PERFIL:
${JSON.stringify(input.instagramData)}

CONTEXTO:
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

  return response.choices[0]?.message?.content ?? "";
}