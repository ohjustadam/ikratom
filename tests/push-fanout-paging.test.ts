import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sendPush = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/push/send", () => ({ isPushConfigured: () => true, sendPush: (...a: unknown[]) => sendPush(...(a as [])) }));
vi.mock("@/lib/notifications/push-gate", () => ({
  canPushUser: () => true,
  digestDue: (p: { digest?: string | null }) => p.digest !== "daily",
}));

import { fanoutPushNotifications } from "@/modules/notifications/push-fanout";

type Row = Record<string, unknown>;

/** In-memory stand-in for the PostgREST calls the fan-out makes. */
function fakeDb(tables: Record<string, Row[]>) {
  const seen = { maxIn: 0 };
  const from = (table: string) => {
    let op: "select" | "update" | "delete" = "select";
    let patch: Row = {};
    const filters: ((r: Row) => boolean)[] = [];
    const orders: [string, boolean][] = [];
    let lim = Infinity;
    const run = () => {
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (op === "update") { rows.forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
      if (op === "delete") { tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r)); return { data: null, error: null }; }
      const cmp = (a: Row, b: Row) => {
        for (const [c, asc] of orders) {
          const x = String(a[c]), y = String(b[c]);
          if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      };
      return { data: [...rows].sort(cmp).slice(0, lim).map((r) => ({ ...r })), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Row) => { op = "update"; patch = p; return b; },
      delete: () => { op = "delete"; return b; },
      insert: async (rows: Row[]) => { tables[table] = [...(tables[table] ?? []), ...rows]; return { data: null, error: null }; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; },
      lt: (c: string, v: string) => { filters.push((r) => r[c] !== undefined && String(r[c]) < v); return b; },
      in: (c: string, vs: unknown[]) => {
        seen.maxIn = Math.max(seen.maxIn, vs.length);
        const s = new Set(vs);
        filters.push((r) => s.has(r[c]));
        return b;
      },
      or: (expr: string) => {
        const m = expr.match(/^created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.([^)]+)\)$/);
        if (!m) throw new Error(`unexpected or(): ${expr}`);
        const [, at, , id] = m;
        filters.push((r) => String(r.created_at) < at || (r.created_at === at && String(r.id) < id));
        return b;
      },
      order: (c: string, o?: { ascending?: boolean }) => { orders.push([c, o?.ascending !== false]); return b; },
      limit: (n: number) => { lim = n; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, tables, seen };
}

const pad = (i: number) => String(i).padStart(5, "0");
const member = (i: number, createdAt: string) => ({
  notif: { id: `n${pad(i)}`, user_id: `u${pad(i)}`, kind: "alert", title: "Hearing Tuesday", body: null, link: "/bills/1", created_at: createdAt, pushed_at: null },
  sub: { id: `s${pad(i)}`, user_id: `u${pad(i)}`, endpoint: `https://push.example/${i}`, p256dh: "k", auth: "a" },
});

describe("push fan-out paging", () => {
  it("reaches all 1,000 members of one broadcast, even with one shared created_at", async () => {
    sendPush.mockClear();
    const at = new Date().toISOString();
    const ms = Array.from({ length: 1000 }, (_, i) => member(i, at));
    const { db, tables, seen } = fakeDb({
      notifications: ms.map((m) => m.notif),
      push_subscriptions: ms.map((m) => m.sub),
      notification_preferences: [],
      push_send_log: [],
    });
    const r = await fanoutPushNotifications(db, { budgetMs: 60_000 });
    expect(r.sent).toBe(1000);
    expect(r.pages).toBe(4);
    expect(r.more).toBe(false);
    expect(tables.notifications.every((n) => n.pushed_at)).toBe(true);
    expect(sendPush).toHaveBeenCalledTimes(1000);
    expect(seen.maxIn).toBeLessThanOrEqual(100);
  });

  it("held digest rows no longer starve members who want alerts now", async () => {
    sendPush.mockClear();
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date().toISOString();
    const instant = Array.from({ length: 200 }, (_, i) => member(i, older));
    const daily = Array.from({ length: 700 }, (_, i) => member(1000 + i, newer));
    const { db, tables } = fakeDb({
      notifications: [...instant, ...daily].map((m) => m.notif),
      push_subscriptions: [...instant, ...daily].map((m) => m.sub),
      notification_preferences: daily.map((m) => ({ user_id: m.notif.user_id, in_app: true, digest: "daily" })),
      push_send_log: [],
    });
    const r = await fanoutPushNotifications(db, { budgetMs: 60_000 });
    expect(r.sent).toBe(200);
    expect(r.held).toBe(700);
    const pushed = tables.notifications.filter((n) => n.pushed_at).map((n) => n.user_id);
    expect(new Set(pushed)).toEqual(new Set(instant.map((m) => m.notif.user_id)));
  });

  it("stops at its time budget and says more is waiting", async () => {
    const { db } = fakeDb({ notifications: [member(1, new Date().toISOString()).notif] });
    const r = await fanoutPushNotifications(db, { budgetMs: -1 });
    expect(r).toMatchObject({ sent: 0, pages: 0, more: true });
  });
});
