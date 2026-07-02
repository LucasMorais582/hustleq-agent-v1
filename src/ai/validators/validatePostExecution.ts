export function validatePostExecution(
  execution: any
) {
  if (!execution) {
    console.log(
      "Invalid execution: empty object"
    );
    return false;
  }

  /*
    CAPTION
  */

  if (!execution.caption?.body) {
    console.log(
      "Invalid execution: missing body"
    );
    return false;
  }

  if (
    !execution.caption?.caption
  ) {
    console.log(
      "Invalid execution: missing caption"
    );
    return false;
  }

  /*
    PRODUCTION GUIDANCE
  */

  if (
    !execution.productionGuidance
      ?.productionInstructions
  ) {
    console.log(
      "Invalid execution: missing productionInstructions"
    );
    return false;
  }

  if (
    execution.productionGuidance
      .productionInstructions
      .length < 100
  ) {
    console.log(
      "Invalid execution: productionInstructions too short"
    );
    return false;
  }

  console.log(
    "Execution validation passed"
  );

  return true;
}