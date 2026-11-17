import express, { Router } from "express";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/middleware.js";
import { AppError } from "../http/errors.js";
import {
  BillingInputError, CANCEL_REASONS, cancelPlan, cardPortal, handleEvent, planPage, resumePlan, startPlanCheckout, startRenewCheckout, syncCheckout,
} from "./service.js";
import { parseWebhook, stripeConfigured } from "./stripe.js";

// Plan and limits (13.3-13.6), Checkout, card portal and Stripe webhooks.
export const billingRouter = Router();

// Webhook: raw body (the signature covers the exact bytes). Mounted before express.json().
export const billingWebhook = [
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: express.Request, res: express.Response) => {
    let event;
    try {
      event = parseWebhook(req.body as Buffer, req.header("stripe-signature"));
    } catch (error) {
      console.error("[billing] webhook rejected", error instanceof Error ? error.message : error);
      return res.status(400).json({ error: { code: "bad_signature", message: "Invalid signature." } });
    }
    await handleEvent(event);
    res.json({ received: true });
  },
] as const;

billingRouter.use(requireUser);

async function run<T>(fn: () => Promise<T>) {
  if (!stripeConfigured()) throw new AppError(503, "billing_unavailable", "Payments aren’t set up yet. Try again later.");
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BillingInputError) throw new AppError(400, "invalid_billing", error.message);
    throw error;
  }
}

billingRouter.get("/", async (req, res) => {
  res.json(await planPage(currentUser(req).id));
});

billingRouter.post("/checkout", async (req, res) => {
  res.json(await run(() => startPlanCheckout(currentUser(req).id)));
});

billingRouter.post("/sync", async (req, res) => {
  const { sessionId } = z.object({ sessionId: z.string().min(10).max(200) }).parse(req.body);
  res.json(await run(() => syncCheckout(currentUser(req).id, sessionId)));
});

billingRouter.post("/renew", async (req, res) => {
  res.json(await run(() => startRenewCheckout(currentUser(req).id)));
});

billingRouter.post("/portal", async (req, res) => {
  res.json({ url: await run(() => cardPortal(currentUser(req).id)) });
});

billingRouter.post("/cancel", async (req, res) => {
  const { reason } = z.object({ reason: z.enum(CANCEL_REASONS).nullable().optional() }).parse(req.body ?? {});
  res.json(await run(() => cancelPlan(currentUser(req).id, reason ?? null)));
});

billingRouter.post("/resume", async (req, res) => {
  res.json(await run(() => resumePlan(currentUser(req).id)));
});
