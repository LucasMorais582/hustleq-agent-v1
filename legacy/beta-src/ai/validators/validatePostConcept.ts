export function validatePostConcept(
  concept: any
) {
  if (!concept) {
    console.log(
      "Invalid concept: empty object"
    );

    return false;
  }

  /*
    IDEA
  */

  if (!concept.idea?.title) {
    console.log(
      "Invalid concept: missing title"
    );

    return false;
  }

  if (!concept.idea?.description) {
    console.log(
      "Invalid concept: missing description"
    );

    return false;
  }

  if (!concept.idea?.hook) {
    console.log(
      "Invalid concept: missing hook"
    );

    return false;
  }

  if (!concept.idea?.goal) {
    console.log(
      "Invalid concept: missing goal"
    );

    return false;
  }

  if (
    ![
      "TOFU",
      "MOFU",
      "BOFU"
    ].includes(
      concept.idea?.funnelStage
    )
  ) {
    console.log(
      "Invalid concept: invalid funnelStage"
    );

    return false;
  }

  /*
    CREATIVE DIRECTION
  */

  const creative =
    concept.creativeDirection;

  if (!creative?.visualConcept) {
    console.log(
      "Invalid concept: missing visualConcept"
    );

    return false;
  }

  if (
    creative.visualConcept
      .length < 50
  ) {
    console.log(
      "Invalid concept: visualConcept too short"
    );

    return false;
  }

  if (!creative?.openingImpact) {
    console.log(
      "Invalid concept: missing openingImpact"
    );

    return false;
  }

  if (!creative?.visualNarrative) {
    console.log(
      "Invalid concept: missing visualNarrative"
    );

    return false;
  }

  if (!creative?.visualMood) {
    console.log(
      "Invalid concept: missing visualMood"
    );

    return false;
  }

  if (!creative?.colorAndTypography) {
    console.log(
      "Invalid concept: missing colorAndTypography"
    );

    return false;
  }

  if (!creative?.audienceEmotion) {
    console.log(
      "Invalid concept: missing audienceEmotion"
    );

    return false;
  }

  if (
    !creative?.platformNativeElements
  ) {
    console.log(
      "Invalid concept: missing platformNativeElements"
    );

    return false;
  }

  if (
    !creative?.executionDetails
  ) {
    console.log(
      "Invalid concept: missing executionDetails"
    );

    return false;
  }

  if (
    creative.executionDetails
      .length < 120
  ) {
    console.log(
      "Invalid concept: executionDetails too short"
    );

    return false;
  }

  /*
    POSTING REMINDER
  */

  if (
    !concept.postingReminder ||
    !Array.isArray(
      concept.postingReminder
    )
  ) {
    console.log(
      "Invalid concept: invalid postingReminder"
    );

    return false;
  }

  if (
    concept.postingReminder
      .length < 3
  ) {
    console.log(
      "Invalid concept: not enough reminders"
    );

    return false;
  }

  console.log(
    "Concept validation passed"
  );

  return true;
}