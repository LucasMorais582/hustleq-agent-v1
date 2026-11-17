import express from "express";

import { authMiddleware }
from "../middleware/auth.middleware.js";

import { agentChatController }
from "../controllers/agent.controller.js";

const router =
  express.Router();

/*
  Agent chat
*/

router.post(
  "/chat",

  authMiddleware,

  agentChatController
);

export default router;