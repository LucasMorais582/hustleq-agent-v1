import { validateSinglePost }
from "../validators/validateSinglePost.js";

type RetrySinglePostInput = {
  generator: () => Promise<any>;
};

export async function retrySinglePost({
  generator,
}: RetrySinglePostInput) {
  const MAX_ATTEMPTS = 3;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt++
  ) {
    console.log(
      `Generating post attempt ${attempt}`
    );

    const startedAt = Date.now();

    const post =
    await generator();

    const finishedAt = Date.now();

    console.log(
    `Generation took ${
        finishedAt - startedAt
    }ms`
    );

    const valid =
      validateSinglePost(post);

    if (valid) {
      console.log(
        "Post validated successfully"
      );

      return post;
    }

    console.log(
      "Invalid post. Retrying..."
    );
  }

    console.log(
        "All retry attempts failed"
    );

    throw new Error(
        "Could not generate valid post after retries"
    );
}