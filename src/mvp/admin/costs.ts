import { db } from "../db.js";

// Cost per account (phase 8): what each owner costs in Claude this month, by feature, with a
// simple projection for the full month. Basis for the per-customer cost study.

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

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

  const customers = accounts.filter((a) => a.kind === "paying" || a.kind === "managed");
  const total = accounts.reduce((s, a) => s + a.total, 0);
  return {
    month,
    daysElapsed: round(elapsed, 1),
    daysInMonth,
    total: round(total, 2),
    customers: customers.length,
    averagePerCustomer: customers.length ? round(customers.reduce((s, a) => s + a.total, 0) / customers.length, 2) : null,
    averageProjectedPerCustomer: customers.length ? round(customers.reduce((s, a) => s + a.projectedMonth, 0) / customers.length, 2) : null,
    features: Object.entries(byFeature).map(([feature, f]) => ({ feature, cost: round(f.cost, 4), calls: f.calls, avgPerCall: round(f.cost / f.calls, 4) })).sort((a, b) => b.cost - a.cost),
    accounts,
    note: "Claude only. Apify (Instagram data), Supabase, Resend and Railway are not in this report yet.",
  };
}
