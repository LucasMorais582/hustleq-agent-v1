import { validateWeekBlueprint }
from "../validators/validateWeekBlueprint.js";

type RetryBlueprintInput = {
  generator: () => Promise<any>;
};

export async function retryWeekBlueprint({
  generator,
}: RetryBlueprintInput) {
  const MAX_ATTEMPTS = 3;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt++
  ) {
    console.log(
      `Generating blueprint attempt ${attempt}`
    );

    const blueprint =
      await generator();

    const valid =
      validateWeekBlueprint(
        blueprint
      );

    if (valid) {
      console.log(
        "Blueprint validated successfully"
      );

      return blueprint;
    }

    console.log(
      "Invalid blueprint. Retrying..."
    );
  }

  throw new Error(
    "Could not generate valid blueprint"
  );
}