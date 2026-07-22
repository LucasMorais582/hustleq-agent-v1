import express from "express";

import {
  authMiddleware
} from "../middleware/auth.middleware.js";

import {
  registerController,
  loginController,
  meController
} from "../controllers/auth.controller.js";

const router =
  express.Router();

/*
  Register
*/

router.post(
  "/register",

  registerController
);

/*
  Login
*/

router.post(
  "/login",

  loginController
);

/*
  Current user
*/

router.get(
  "/me",

  authMiddleware,

  meController
);

export default router;