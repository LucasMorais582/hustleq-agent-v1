import Stripe from "stripe";

// Everything the app asks Stripe, in one place (and one place to mock in tests).
// Prices are found by lookup key and created the first time, so a new Stripe account needs no setup.

export const PLAN_LOOKUP = "hustleq_plan_monthly_usd20";
export const RENEW_LOOKUP = "hustleq_renew_limits_usd20";
export const PLAN_CENTS = 2000;
export const RENEW_CENTS = 2000;
export const FIRST_ACCESS_TRIAL_DAYS = 30;

let client: Stripe | null = null;
export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "1") throw new Error("Live Stripe key refused: set STRIPE_ALLOW_LIVE=1 when going live");
  client ??= new Stripe(key);
  return client;
}

const prices = new Map<string, string>();
async function priceId(lookup: string) {
  const cached = prices.get(lookup);
  if (cached) return cached;
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  let id = found.data[0]?.id;
  if (!id) {
    const monthly = lookup === PLAN_LOOKUP;
    const product = await s.products.create({
      name: monthly ? "HustleQ" : "HustleQ · Renew limits",
      description: monthly ? "Duke plans your Instagram content. US$ 20 a month." : "Explore searches and post validations back to zero. One-time charge.",
    });
    const price = await s.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: monthly ? PLAN_CENTS : RENEW_CENTS,
      lookup_key: lookup,
      ...(monthly ? { recurring: { interval: "month" as const } } : {}),
    });
    id = price.id;
  }
  prices.set(lookup, id);
  return id;
}

export async function ensureCustomer(existing: string | null, user: { id: string; email: string; businessName: string | null }) {
  if (existing) return existing;
  const c = await stripe().customers.create({ email: user.email, ...(user.businessName ? { name: user.businessName } : {}), metadata: { userId: user.id } });
  return c.id;
}

// Monthly plan. First Access: 30 days free, the card is charged after that.
export async function planCheckout(input: { customerId: string; userId: string; firstAccess: boolean; successUrl: string; cancelUrl: string }) {
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.userId,
    line_items: [{ price: await priceId(PLAN_LOOKUP), quantity: 1 }],
    subscription_data: { metadata: { userId: input.userId }, ...(input.firstAccess ? { trial_period_days: FIRST_ACCESS_TRIAL_DAYS } : {}) },
    payment_method_collection: "always",
    allow_promotion_codes: false,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { userId: input.userId, kind: "plan" },
  });
  return { id: session.id, url: session.url! };
}

// Renew limits (9.1c): one-time US$ 20.
export async function renewCheckout(input: { customerId: string; userId: string; successUrl: string; cancelUrl: string }) {
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer: input.customerId,
    client_reference_id: input.userId,
    line_items: [{ price: await priceId(RENEW_LOOKUP), quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { userId: input.userId, kind: "renew_limits" },
    payment_intent_data: { metadata: { userId: input.userId, kind: "renew_limits" } },
  });
  return { id: session.id, url: session.url! };
}

export async function portalUrl(customerId: string, returnUrl: string) {
  const s = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return s.url;
}

export async function setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean, reason?: string | null) {
  return toSub(await stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel, metadata: { cancelReason: reason ?? "" } }));
}

export async function getCheckoutSession(id: string) {
  const s = await stripe().checkout.sessions.retrieve(id);
  return {
    id: s.id,
    mode: s.mode,
    status: s.status,
    paid: s.payment_status === "paid" || s.payment_status === "no_payment_required",
    userId: s.client_reference_id ?? s.metadata?.userId ?? null,
    kind: s.metadata?.kind ?? null,
    customerId: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
    subscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
    paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
  };
}
export type CheckoutInfo = Awaited<ReturnType<typeof getCheckoutSession>>;

// The parts of a Stripe subscription the app keeps.
export type SubInfo = { id: string; customerId: string; status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; trialEnd: Date | null; endedAt: Date | null; userId: string | null };
function toSub(s: Stripe.Subscription): SubInfo {
  const end = s.items?.data?.reduce<number | null>((m, i) => (i.current_period_end && (!m || i.current_period_end < m) ? i.current_period_end : m), null) ?? null;
  return {
    id: s.id,
    customerId: typeof s.customer === "string" ? s.customer : s.customer.id,
    status: s.status,
    currentPeriodEnd: end ? new Date(end * 1000) : null,
    cancelAtPeriodEnd: s.cancel_at_period_end || Boolean(s.cancel_at),
    trialEnd: s.trial_end ? new Date(s.trial_end * 1000) : null,
    endedAt: s.ended_at ? new Date(s.ended_at * 1000) : null,
    userId: s.metadata?.userId ?? null,
  };
}

export async function getSubscription(id: string) {
  return toSub(await stripe().subscriptions.retrieve(id));
}

// Webhook events the app uses, already reduced to what matters.
export type BillingEvent =
  | { type: "subscription"; sub: SubInfo }
  | { type: "checkout"; session: CheckoutInfo }
  | { type: "payment_failed"; subscriptionId: string | null; customerId: string | null }
  | { type: "payment_succeeded"; subscriptionId: string | null }
  | { type: "ignored"; name: string };

export function parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  const event = stripe().webhooks.constructEvent(rawBody, signature ?? "", secret);
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return { type: "subscription", sub: toSub(event.data.object) };
    case "checkout.session.completed": {
      const s = event.data.object;
      return {
        type: "checkout",
        session: {
          id: s.id, mode: s.mode, status: s.status,
          paid: s.payment_status === "paid" || s.payment_status === "no_payment_required",
          userId: s.client_reference_id ?? s.metadata?.userId ?? null, kind: s.metadata?.kind ?? null,
          customerId: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
          subscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
          paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
        },
      };
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      const inv = event.data.object;
      const sub = inv.parent?.subscription_details?.subscription;
      const subscriptionId = typeof sub === "string" ? sub : sub?.id ?? null;
      return event.type === "invoice.paid"
        ? { type: "payment_succeeded", subscriptionId }
        : { type: "payment_failed", subscriptionId, customerId: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null };
    }
    default:
      return { type: "ignored", name: event.type };
  }
}
