export function temperatureRouter(
  mode?: string
) {
  switch (mode) {
    case "CONTENT_WEEK_BLUEPRINT":
      return 0.85;

    case "CONTENT_SINGLE_POST":
      return 0.55;

    case "CONTENT_PLAN_MODIFICATION":
      return 0.35;

    default:
      return 0.7;
  }
}