export function parseOpenAIResponse(
  content: string
) {
  const cleaned = content
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");

      const jsonString = cleaned.slice(
        start,
        end + 1
      );

      return JSON.parse(jsonString);
    } catch {
      console.error(
        "JSON parse failed:",
        cleaned
      );

      return {
        raw: cleaned,
      };
    }
  }
}