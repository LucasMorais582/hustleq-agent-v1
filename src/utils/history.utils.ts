export function extractLastOutput(history: any[]) {
  if (!history || history.length === 0) return null;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];

    if (msg.role !== "assistant") continue;

    try {
      const parsed = JSON.parse(msg.content);

      if (parsed?.type && parsed?.data) {
        return parsed;
      }

    } catch {
      continue;
    }
  }

  return null;
}