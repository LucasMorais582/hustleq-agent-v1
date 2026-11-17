import express from "express";

import {
  authMiddleware
} from "../middleware/auth.middleware.js";

import {
  saveBusinessController,
  getBusinessController
} from "../controllers/business.controller.js";

const router =
  express.Router();

router.get(
  "/",

  authMiddleware,

  getBusinessController
);

router.post(
  "/",

  authMiddleware,

  saveBusinessController
);

export default router;