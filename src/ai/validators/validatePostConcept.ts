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

  /*
    CREATIVE DIRECTION
  */

  if (
    !concept.creativeDirection
      ?.executionDetails
  ) {
    console.log(
      "Invalid concept: missing executionDetails"
    );
    return false;
  }

  if (
    concept.creativeDirection
      .executionDetails
      .length < 100
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