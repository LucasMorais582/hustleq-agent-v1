export function temperatureRouter(
  mode?: string
) {
  switch (mode) {
    case "CONTENT_WEEK_BLUEPRINT":
      return 0.9;

    case "CONTENT_POST_CONCEPT":
      return 0.8;

    case "CONTENT_POST_EXECUTION":
      return 0.45;

    case "CONTENT_PLAN_MODIFICATION":
      return 0.3;

    case "CONTENT_SINGLE_POST":
      return 0.55;

    default:
      return 0.7;
  }
}