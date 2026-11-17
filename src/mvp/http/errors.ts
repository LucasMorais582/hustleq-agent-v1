import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

// Every error the app shows carries a code and the time (screen E.2).
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new AppError(404, "not_found", what);
export const unauthorized = () => new AppError(401, "unauthorized", "Log in to continue.");
export const forbidden = () => new AppError(403, "forbidden", "You can't do that.");

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const time = new Date().toISOString();

  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "invalid_input", message: "Check the fields and try again.", issues: err.issues, time } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, time } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "invalid_json", message: "Invalid request body.", time } });
    return;
  }

  console.error("[mvp] unhandled error", err);
  res.status(500).json({ error: { code: "server_error", message: "Something went wrong on our side.", time } });
};

// Express 5 already forwards rejected promises; this keeps handlers typed and short.
export const handler = (fn: RequestHandler): RequestHandler => fn;
