import type { AgentInput }
from "../../types/agent.types.js";

import { processSinglePost }
from "./processSinglePost.js";

export async function processPostBatch(
  items: any[],
  input: AgentInput
) {
  return Promise.all(
    items.map(
      async (item) =>
        processSinglePost(
          item,
          input
        )
    )
  );
}