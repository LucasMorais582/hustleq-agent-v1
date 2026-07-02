import express from "express";

import {
  authMiddleware
} from "../middleware/auth.middleware.js";

import {
  getConversationsController,
  getMessagesController
} from "../controllers/conversation.controller.js";

const router =
  express.Router();

/*
  List conversations
*/

router.get(
  "/",

  authMiddleware,

  getConversationsController
);

/*
  Conversation messages
*/

router.get(
  "/:id",

  authMiddleware,

  getMessagesController
);

export default router;