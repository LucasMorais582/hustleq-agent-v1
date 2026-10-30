import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

import {
  demoIdeaController,
  demoProfileController,
  demoProfileImageController,
  getNichesController
} from "./demo.controller.js";

const router = express.Router();

/*
  CORS: only the landing can call the demo.
  Mounted before the app-wide cors("*") so it takes precedence on /demo.
*/

const DEFAULT_ORIGINS = [
  "https://hustleq.netlify.app",
  "https://hustleq.tech",
  "https://www.hustleq.tech",
  "http://localhost:8080",
  "http://localhost:5173",
];

const allowedOrigins = process.env.DEMO_ALLOWED_ORIGINS
  ? process.env.DEMO_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : DEFAULT_ORIGINS;

router.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));

/*
  Rate limits are per IP and generous: at the event many people share the venue Wi-Fi.
  The daily lookup cap in demoProfile.service is what protects the Apify budget.
*/

const limiter = (limit: number) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests, try again in a few minutes" },
});

router.get(
  "/niches",

  getNichesController
);

router.post(
  "/profile",

  limiter(Number(process.env.DEMO_PROFILE_LIMIT_PER_15MIN || 60)),

  demoProfileController
);

// Served to <img>, so CORS doesn't apply; it only reads profiles already looked up.
router.get(
  "/profile-image/:handle",

  limiter(Number(process.env.DEMO_IMAGE_LIMIT_PER_15MIN || 300)),

  demoProfileImageController
);

router.post(
  "/idea",

  limiter(Number(process.env.DEMO_IDEA_LIMIT_PER_15MIN || 60)),

  demoIdeaController
);

export default router;
