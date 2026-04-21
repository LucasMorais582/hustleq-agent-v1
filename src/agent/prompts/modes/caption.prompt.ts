export const CAPTION_PROMPT = `
TASK:

Write a high-quality Instagram caption.

You must adapt the caption to:
- The business niche
- The content goal (ENGAGEMENT, CONVERSION, EDUCATIONAL)

---

STRUCTURE (MANDATORY):

1. Hook (first line)
- Must stop scrolling
- Must be specific and emotionally engaging
- Must NOT be generic

2. Body
- Expand the idea naturally
- Use concrete and specific details related to the niche
- Sound like a real Instagram post, not a business pitch

3. CTA (Call to Action)
- Must be clear, direct and aligned with the goal

---

GOAL ENFORCEMENT (CRITICAL):

You MUST follow this strictly:

- If goal is CONVERSION:
  - CTA must drive a real action (visit, order, DM, book, click)
  - NEVER ask for comments, opinions or engagement
  - Focus on getting the user to take action immediately

- If goal is ENGAGEMENT:
  - CTA must encourage comments, opinions or tagging
  - Do NOT include sales actions

- If goal is EDUCATIONAL:
  - CTA should be soft (save, follow, learn more)
  - Focus on delivering value first

If you fail to follow this, the response is incorrect.

---

GENERIC LANGUAGE IS FORBIDDEN:

Do NOT use phrases like:
- "fresh ingredients"
- "explosion of flavors"
- "high quality"
- "made with love"
- "best experience"
- "incredible taste"

Instead:
- Describe something specific
- Use real or tangible details
- Make it feel authentic and unique

---

HOOK RULE:

Bad example:
"A comida vegetariana pode ser incrível"

Good example:
"Se você acha que comida vegetariana é sem graça, isso vai te surpreender"

The hook must create curiosity, contrast or relatability.

---

STYLE:

- Use simple, natural language
- Avoid corporate or marketing terms
- Do NOT mention marketing concepts (engagement, leads, strategy)
- Keep it human and slightly informal

---

CREATIVE EXPLORATION (IMPORTANT):

Before writing the final caption:
- Think of at least 3 different hook angles (e.g., curiosity, contrarian, relatable)
- Think of at least 2 CTA styles (soft vs direct)

Then:
- Select the strongest combination for the main output
- Generate 3 additional caption variations using different angles

VARIATION RULES:
- Variations must NOT be simple rewrites
- Each variation must feel like a different post idea
- Each variation should use a different hook approach or emotional angle
- Avoid repeating the same structure or wording

---

IMPORTANT:

- The caption must feel like it was written specifically for that business
- It must NOT feel generic
- It must NOT sound like AI
`;