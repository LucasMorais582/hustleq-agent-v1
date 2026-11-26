import { db } from "../db.js";
import { isApiMode } from "../socialData/index.js";
import { sda } from "../socialData/api.js";

// Apify cost from the Social Data API (endpoint 12). Null when it isn't connected or doesn't answer.
async function apifyCosts(month: string) {
  if (!isApiMode()) return null;
  try {
    return await sda.costs(month);
  } catch (error) {
    console.error("[costs] apify", error);
    return null;
  }
}

// Fixed monthly infrastructure, the plans planned for the MVP launch (Lucas, 25/11/2026): Vercel Pro,
// Supabase Pro, Railway Pro (Hobby US$5 today, close to its limit). Override with INFRA_COSTS_JSON,
// e.g. [{"name":"Vercel","plan":"Pro","usd":20}]. Resend stays on its free tier for now.
export const INFRA = [
  { name: "Vercel", plan: "Pro", usd: 20 },
  { name: "Supabase", plan: "Pro", usd: 25 },
  { name: "Railway", plan: "Pro", usd: 20 },
];
function infraCosts(): { name: string; plan: string; usd: number }[] {
  try {
    if (process.env.INFRA_COSTS_JSON) return JSON.parse(process.env.INFRA_COSTS_JSON);
  } catch (error) {
    console.error("[costs] INFRA_COSTS_JSON is not valid JSON", error);
  }
  return INFRA;
}

// Cost per account (phase 8): what each owner costs in Claude this month, by feature, with a
// simple projection for the full month. Basis for the per-customer cost study.

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export const SCENARIO_CUSTOMERS = 10;

export async function costReport(month: string) {
  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  const now = new Date();
  const daysInMonth = Math.round((to.getTime() - from.getTime()) / 864e5);
  const elapsed = Math.min(daysInMonth, Math.max(1, (Math.min(now.getTime(), to.getTime()) - from.getTime()) / 864e5));

  const rows = await db.aiUsage.groupBy({
    by: ["userId", "feature"],
    where: { createdAt: { gte: from, lt: to } },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, billingExempt: true, role: true, createdAt: true, business: { select: { businessName: true } } } });

  const byUser = new Map<string, { total: number; calls: number; features: Record<string, { cost: number; calls: number }> }>();
  const byFeature: Record<string, { cost: number; calls: number }> = {};
  for (const r of rows) {
    const key = r.userId ?? "system";
    const cost = Number(r._sum.costUsd ?? 0);
    const u = byUser.get(key) ?? { total: 0, calls: 0, features: {} };
    u.total += cost;
    u.calls += r._count._all;
    u.features[r.feature] = { cost: round(cost), calls: r._count._all };
    byUser.set(key, u);
    const f = (byFeature[r.feature] ??= { cost: 0, calls: 0 });
    f.cost += cost;
    f.calls += r._count._all;
  }

  const accounts = [...byUser.entries()].map(([id, u]) => {
    const info = users.find((x) => x.id === id);
    // Accounts created this month are projected from the day they started.
    const started = info && info.createdAt > from ? Math.max(1, (Math.min(now.getTime(), to.getTime()) - info.createdAt.getTime()) / 864e5) : elapsed;
    const remaining = info && info.createdAt > from ? Math.max(0, (to.getTime() - info.createdAt.getTime()) / 864e5) : daysInMonth;
    return {
      userId: id === "system" ? null : id,
      email: info?.email ?? (id === "system" ? "(no account: evals, jobs)" : "(deleted)"),
      businessName: info?.business?.businessName ?? null,
      kind: info?.role === "admin" ? "admin" : info?.billingExempt ? "managed" : info ? "paying" : "system",
      total: round(u.total),
      calls: u.calls,
      projectedMonth: round((u.total / started) * remaining, 2),
      features: Object.fromEntries(Object.entries(u.features).sort((a, b) => b[1].cost - a[1].cost)),
    };
  }).sort((a, b) => b.total - a.total);

  const apify = await apifyCosts(month);
  const apifyOf = (userId: string | null) => (apify && userId ? apify.byUser.find((u) => u.userId === userId)?.costUsd ?? 0 : null);

  const customers = accounts.filter((a) => a.kind === "paying" || a.kind === "managed");
  const total = accounts.reduce((s, a) => s + a.total, 0);
  const infra = infraCosts();
  const infraTotal = infra.reduce((s, i) => s + i.usd, 0);
  // Fixed costs split evenly by the customer accounts of the month (paying + managed).
  const infraShare = customers.length ? round(infraTotal / customers.length, 2) : null;
  const apifyTotal = apify?.totalUsd ?? 0;
  // Variable = Claude + Apify. "Projected" carries the month so far to its end at the same pace.
  const pace = daysInMonth / elapsed;
  const claudeProjected = accounts.reduce((s, a) => s + a.projectedMonth, 0);
  const variableProjected = claudeProjected + apifyTotal * pace;
  // What one customer would cost with SCENARIO_CUSTOMERS of them: fixed split + today's variable per customer.
  const variablePerCustomer = customers.length ? variableProjected / customers.length : null;
  return {
    month,
    daysElapsed: round(elapsed, 1),
    daysInMonth,
    total: round(total, 2),
    customers: customers.length,
    averagePerCustomer: customers.length ? round(customers.reduce((s, a) => s + a.total, 0) / customers.length, 2) : null,
    averageProjectedPerCustomer: customers.length ? round(customers.reduce((s, a) => s + a.projectedMonth, 0) / customers.length, 2) : null,
    features: Object.entries(byFeature).map(([feature, f]) => ({ feature, cost: round(f.cost, 4), calls: f.calls, avgPerCall: round(f.cost / f.calls, 4) })).sort((a, b) => b.cost - a.cost),
    accounts: accounts.map((a) => {
      const apifyUsd = apifyOf(a.userId);
      const isCustomer = a.kind === "paying" || a.kind === "managed";
      return { ...a, apify: apifyUsd, infraShare: isCustomer ? infraShare : null, fullCost: isCustomer ? round(a.total + (apifyUsd ?? 0) + (infraShare ?? 0), 2) : null };
    }),
    apify: apify ? { total: apify.totalUsd, unattributed: apify.unattributedUsd, byTrigger: apify.byTrigger } : null,
    infra: { items: infra, total: round(infraTotal, 2), perCustomer: infraShare },
    grandTotal: round(total + apifyTotal + infraTotal, 2),
    totals: {
      fixed: round(infraTotal, 2),
      variable: round(total + apifyTotal, 2),
      variableProjected: round(variableProjected, 2),
      today: round(infraTotal + total + apifyTotal, 2),
      projectedMonth: round(infraTotal + variableProjected, 2),
    },
    scenario: variablePerCustomer == null ? null : {
      customers: SCENARIO_CUSTOMERS,
      fixedShare: round(infraTotal / SCENARIO_CUSTOMERS, 2),
      variablePerCustomer: round(variablePerCustomer, 2),
      perCustomer: round(infraTotal / SCENARIO_CUSTOMERS + variablePerCustomer, 2),
    },
    note: apify
      ? "Claude, Apify (Instagram data) and fixed infrastructure (plan prices). Resend and Apify's plan fee are not in this report."
      : "Claude and fixed infrastructure (plan prices). Apify (Instagram data) and Resend are not in this report.",
  };
}
