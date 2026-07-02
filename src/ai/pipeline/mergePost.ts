export function mergePost(
  concept: any,
  execution: any
) {
  return {
    idea: concept.idea,

    creativeDirection:
      concept.creativeDirection,

    postingReminder:
      concept.postingReminder,

    caption:
      execution.caption,

    productionGuidance:
      execution.productionGuidance,
  };
}