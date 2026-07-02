import {
  createContentStrategy,
  listContentStrategies
} from "../services/contentStrategy.service.js";

export async function createStrategyController(
  req: any,
  res: any
) {
  try {
    const strategy =
      await createContentStrategy(
        req.user.userId,
        req.body
      );

    return res.json({
      strategy,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Failed to create strategy"
    });
  }
}

export async function getStrategiesController(
  req: any,
  res: any
) {
  try {
    const strategies =
      await listContentStrategies(
        req.user.userId
      );

    return res.json({
      strategies,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Failed to fetch strategies"
    });
  }
}