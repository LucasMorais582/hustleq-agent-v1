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

  if (
    !execution.caption?.hook
  ) {
    console.log(
      "Invalid execution: missing hook"
    );

    return false;
  }

  if (
    !execution.caption?.body
  ) {
    console.log(
      "Invalid execution: missing body"
    );

    return false;
  }

  if (
    !execution.caption?.cta
  ) {
    console.log(
      "Invalid execution: missing cta"
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
      ?.recordingPlan
  ) {
    console.log(
      "Invalid execution: missing recordingPlan"
    );

    return false;
  }

  if (
    execution.productionGuidance
      .recordingPlan.length < 120
  ) {
    console.log(
      "Invalid execution: recordingPlan too short"
    );

    return false;
  }

  if (
    !execution.productionGuidance
      ?.editingGuidelines
  ) {
    console.log(
      "Invalid execution: missing editingGuidelines"
    );

    return false;
  }

  if (
    execution.productionGuidance
      .editingGuidelines.length < 80
  ) {
    console.log(
      "Invalid execution: editingGuidelines too short"
    );

    return false;
  }

  if (
    !execution.productionGuidance
      ?.creatorInstructions
  ) {
    console.log(
      "Invalid execution: missing creatorInstructions"
    );

    return false;
  }

  if (
    !Array.isArray(
      execution.productionGuidance
        ?.assetsRequired
    )
  ) {
    console.log(
      "Invalid execution: assetsRequired must be array"
    );

    return false;
  }

  if (
    !Array.isArray(
      execution.productionGuidance
        ?.productionChecklist
    )
  ) {
    console.log(
      "Invalid execution: productionChecklist must be array"
    );

    return false;
  }

  console.log(
    "Execution validation passed"
  );

  return true;
}