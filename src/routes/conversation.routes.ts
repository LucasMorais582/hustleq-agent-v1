import express from "express";

import {
  authMiddleware
} from "../middleware/auth.middleware.js";

import {
  deleteConversationController,
  deleteMessagesController,
  getConversationController,
  getConversationsController,
  getMessagesController
} from "../controllers/conversation.controller.js";

const router = express.Router();

/*
  List conversations
*/

router.get(
  "/",

  authMiddleware,

  getConversationsController
);

/*
  Get conversation
*/

router.get(
  "/:id",

  authMiddleware,

  getConversationController
);

/*
  Delete conversation
*/

router.delete(
  "/:id",

  authMiddleware,

  deleteConversationController
);

/*
  Conversation messages
*/

router.get(
  "/:id/messages",

  authMiddleware,

  getMessagesController
);

/*
  Delete messages
*/

router.delete(
  "/:conversationId/messages/:id",

  authMiddleware,

  deleteMessagesController
);

export default router;