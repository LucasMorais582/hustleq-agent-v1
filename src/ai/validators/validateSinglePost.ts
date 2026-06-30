export function validateSinglePost(post: any) {
  if (!post) {
    console.log("Invalid: empty post");
    return false;
  }

  /*
    IDEA
  */

  if (!post.idea?.title) {
    console.log("Invalid: missing idea.title");
    return false;
  }

  if (!post.idea?.description) {
    console.log("Invalid: missing idea.description");
    return false;
  }

  if (!post.idea?.hook) {
    console.log("Invalid: missing idea.hook");
    return false;
  }

  /*
    CAPTION
  */

  if (!post.caption?.body) {
    console.log("Invalid: missing caption.body");
    return false;
  }

  if (!post.caption?.caption) {
    console.log("Invalid: missing caption.caption");
    return false;
  }

  /*
    PRODUCTION GUIDANCE
  */

  if (
    !post.productionGuidance?.productionInstructions
  ) {
    console.log(
      "Invalid: missing productionInstructions"
    );
    return false;
  }

  if (
    post.productionGuidance
      .productionInstructions
      .length < 120
  ) {
    console.log(
      "Invalid: productionInstructions too short"
    );
    return false;
  }

  /*
    CREATIVE DIRECTION
  */

  if (
    !post.creativeDirection?.executionDetails
  ) {
    console.log(
      "Invalid: missing executionDetails"
    );
    return false;
  }

  if (
    post.creativeDirection
      .executionDetails
      .length < 120
  ) {
    console.log(
      "Invalid: executionDetails too short"
    );
    return false;
  }

  /*
    POSTING REMINDER
  */

  if (
    !post.postingReminder ||
    !Array.isArray(post.postingReminder)
  ) {
    console.log(
      "Invalid: postingReminder missing"
    );
    return false;
  }

  if (post.postingReminder.length < 3) {
    console.log(
      "Invalid: insufficient posting reminders"
    );
    return false;
  }

  console.log("Post validation passed");

  return true;
}