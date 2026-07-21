import express from "express";

import {
  authMiddleware
} from "../middleware/auth.middleware.js";

import {
  createStrategyController,
  deleteStrategyController,
  getStrategiesController,
  getStrategyController
} from "../controllers/strategy.controller.js";

const router =
  express.Router();

/*
  Get strategies
*/

router.get(
  "/",

  authMiddleware,

  getStrategiesController
);

/*
  Get strategiy
*/

router.get(
  "/:id",

  authMiddleware,

  getStrategyController
);

/*
  Create strategy
*/

router.post(
  "/",

  authMiddleware,

  createStrategyController
);

/*
  Delete strategy
*/

router.delete(
  "/:id",

  authMiddleware,

  deleteStrategyController
);
export default router;