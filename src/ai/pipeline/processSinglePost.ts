import type { AgentInput }
from "../../types/agent.types.js";

import { retryPostConcept }
from "../retries/retryPostConcept.js";

import { retryPostExecution }
from "../retries/retryPostExecution.js";

import { mergePost }
from "./mergePost.js";

export async function processSinglePost(
  item: any,
  input: AgentInput
) {
  /*
    Generate concept with retry
  */

  const conceptStart =
    Date.now();

  const concept =
    await retryPostConcept(
      input,
      item
    );

  const conceptEnd =
    Date.now();

  console.log(
    `Concept generation: ${
      conceptEnd - conceptStart
    }ms`
  );

  /*
    Generate execution with retry
  */

  const executionStart =
    Date.now();

  const execution =
    await retryPostExecution(
      input,
      concept
    );

  const executionEnd =
    Date.now();

  console.log(
    `Execution generation: ${
      executionEnd - executionStart
    }ms`
  );

  /*
    Merge final post
  */

  const post =
    mergePost(
      concept,
      execution
    );

  return {
    ...post,
    contentType:
      item.contentType,
  };
}