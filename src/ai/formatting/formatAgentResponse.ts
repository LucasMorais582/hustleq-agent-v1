export function formatAgentResponse(
  parsed: any,
  mode: string
) {
  if (parsed?.ideas) {
    parsed = {
      text:
        "Here are some ideas based on your request.",
      data: {
        type: mode,
        data: parsed,
      },
    };
  }

  if (parsed?.text && parsed?.data) {
    return [
      {
        role: "assistant",
        content: {
          type: "TEXT",
          data: {
            text: parsed.text,
          },
        },
      },
      {
        role: "assistant",
        content: parsed.data,
      },
    ];
  }

  return [
    {
      role: "assistant",
      content: parsed,
    },
  ];
}