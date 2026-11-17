import {
  createContentStrategy,
  deleteContentStrategy,
  getContentStrategyById,
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

export async function getStrategyController(
  req: any,
  res: any
) {
  try {
    const strategies =
      await getContentStrategyById(
        req.user.userId,
        req.params.id
      );

    return res.json({
      strategies,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Failed to fetch strategy"
    });
  }
}

export async function deleteStrategyController(
  req: any,
  res: any
) {
  try {
    const strategies =
      await deleteContentStrategy(
        req.user.userId,
        req.params.id
      );

    return res.json({
      strategies,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        "Failed to delete strategy"
    });
  }
}