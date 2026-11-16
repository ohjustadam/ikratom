import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * PJ, 2026-11-11: "Sending · 15 of 110", then PJ left the campaign page to
 * write a group post and the send stopped until they went back minutes later.
 * Only the campaign page drove the queue; the cron runs ~22 times a day.
 *
 * What this pins:
 *   1. From ANY page, the app-shell route drains the member's own queue.
 *   2. The browser driver takes over the moment the campaign panel unmounts,
 *      and stays out of the way while the panel drives.
 *   3. Two tabs can't double-send, and can't push past the daily cap: one
 *      slice per mailbox (the drain lease), one driving tab per browser (the
 *      Web Lock), and under both the per-recipient compare-and-swap.
 *
 * Nothing here touches the network: an in-memory Supabase with the real
 * compare-and-swap and check_rate_limit semantics stands in for the database,
 * and the mailbox is a recorder. No letter can reach a real legislator.
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tick = () => new Promise<void>((r) => setImmediate(r));

  class Query {
    private op: "select" | "insert" | "update" = "select";
    private opts: { count?: string; head?: boolean } | undefined;
    private patch: Row = {};
    private rows: Row[] = [];
    private filters: ((r: Row) => boolean)[] = [];
    private sort: { col: string; asc: boolean } | null = null;
    private max: number | null = null;
    private single: "maybe" | "one" | null = null;
    private returning = false;
    private ifAbsent = false;
    constructor(private db: FakeDb, private table: string) {}
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (this.op === "select") this.opts = opts; else this.returning = true;
      return this;
    }
    insert(rows: Row | Row[]) { this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    /** Only the `ignoreDuplicates` (on conflict do nothing) form, keyed on `key`. */
    upsert(row: Row) { this.op = "insert"; this.rows = [row]; this.ifAbsent = true; return this; }
    update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
    gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
    lt(c: string, v: string) { this.filters.push((r) => String(r[c]) < v); return this; }
    order(col: string, o?: { ascending?: boolean }) { this.sort = { col, asc: o?.ascending !== false }; return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = "maybe"; return this; }
    then<A, B>(ok: (v: unknown) => A, bad?: (e: unknown) => B) { return this.run().then(ok, bad); }
    // Yield first, then apply the whole statement at once, like one SQL statement.
    private async run() {
      await tick();
      const t = (this.db.tables[this.table] ??= []);
      if (this.op === "insert") {
        const now = new Date().toISOString();
        if (this.ifAbsent && t.some((r) => r.key === this.rows[0].key)) return { data: null, error: null };
        const added = this.rows.map((r) => ({ id: `${this.table}-${++this.db.seq}`, created_at: now, sent_at: now, ...r }));
        t.push(...added);
        return { data: this.returning ? added : null, error: null };
      }
      let rows = t.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of rows) Object.assign(r, this.patch);
        return { data: this.returning ? rows.map((r) => ({ ...r })) : null, error: null };
      }
      if (this.opts?.head) return { data: null, count: rows.length, error: null };
      if (this.sort) {
        const { col, asc } = this.sort;
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (this.max != null) rows = rows.slice(0, this.max);
      const out = rows.map((r) => ({ ...r }));
      if (this.single) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
  }

  class FakeDb {
    tables: Record<string, Row[]> = {};
    seq = 0;
    client(user: { id: string } | null = null) {
      return {
        from: (t: string) => new Query(this, t),
        auth: { getUser: async () => ({ data: { user } }) },
      };
    }
    /** Shifts the database clock, so a test can let a lease run out. */
    offsetMs = 0;
    /**
     * public.check_rate_limit, as written in migration 0002. The no-row path
     * is two steps in Postgres too: `select … for update` finds nothing to
     * lock, then `insert … on conflict do nothing` and `return true`, for
     * every caller in that race.
     */
    async checkRateLimit(key: string, max: number, windowSeconds: number) {
      await tick();
      const t = (this.tables.rate_limits ??= []);
      const now = Date.now() + this.offsetMs;
      const row = t.find((r) => r.key === key);
      if (!row) {
        await tick();
        if (!t.some((r) => r.key === key)) t.push({ key, window_start: new Date(now).toISOString(), count: 1 });
        return true;
      }
      if (now - Date.parse(String(row.window_start)) > windowSeconds * 1000) {
        row.window_start = new Date(now).toISOString();
        row.count = 1;
        return true;
      }
      if ((row.count as number) >= max) return false;
      row.count = (row.count as number) + 1;
      return true;
    }
  }

  return {
    db: new FakeDb(),
    FakeDb,
    sent: [] as { to: string; subject: string; body: string }[],
    limits: { effectiveDaily: 500 },
    /** Runs as each letter starts sending, with the count sent so far. */
    beforeSend: null as null | ((n: number) => Promise<void>),
    signedIn: { id: "user-pj" } as { id: string } | null,
  };
});

vi.mock("@/lib/email/user-send", () => ({
  getEmailIntegration: async () => ({ provider: "gmail", account_email: "member@gmail.com" }),
  sendOnUserBehalf: async (m: { to: string; subject: string; body: string }) => {
    await h.beforeSend?.(h.sent.length);
    await new Promise((r) => setImmediate(r));
    h.sent.push({ to: m.to, subject: m.subject, body: m.body });
  },
  markEmailIntegrationRevoked: async () => {},
  EmailTokenRevokedError: class extends Error { provider = "gmail"; },
}));
vi.mock("@/lib/email/provider-limits", () => ({
  // 60,000/min = a 1 ms pace, so a test slice finishes at once.
  resolveLimits: () => ({ tier: "gmail_free", label: "Gmail", maxPerMinute: 60_000, effectiveDaily: h.limits.effectiveDaily, newAccount: false }),
  capForNewAccount: (l: unknown) => l,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (k: string, m: number, w: number) => h.db.checkRateLimit(k, m, w),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db.client(h.signedIn) }));

import { POST } from "../src/app/api/campaigns/send-queue/route";
import { drainBatch, type DrainBatchRow } from "../src/modules/campaigns/drain-batch";
import { acquireDrainLease, drainLeaseKey, ensureDrainLeaseRow } from "../src/modules/campaigns/drain-lease";
import { summarizeQueue } from "../src/modules/campaigns/drive-queue";
import {
  BUSY_MS,
  GAP_MS,
  HINT_TTL_MS,
  MAX_ERRORS,
  PAUSED_RECHECK_MS,
  YIELD_MS,
  readHint,
  registerPageDriver,
  pageDriverActive,
  runSendQueueDriver,
  withSendQueueLock,
  writeActiveHint,
  type DriverDeps,
  type HintStore,
  type QueueReply,
} from "../src/modules/campaigns/send-queue-client";

const USER = "user-pj";

function seed(n: number) {
  h.db = new h.FakeDb();
  h.sent.length = 0;
  h.limits.effectiveDaily = 500;
  h.beforeSend = null;
  h.signedIn = { id: USER };
  const legs = Array.from({ length: n }, (_, i) => ({
    id: `leg-${String(i).padStart(3, "0")}`,
    state: "OK", role: "state_house", district: String(i + 1), full_name: `Jordan Smith${i}`,
    party: null, email: `rep${i}@okhouse.gov`, level: "state", locality: null, body: null, title: null,
  }));
  h.db.tables = {
    profiles: [{ id: USER, full_name: "Pat Member", username: "pat", street: null, city: "Tulsa", county: null, state: "OK", zip: "74103", email_provider_tier: null, created_at: "2025-01-01T00:00:00.000Z" }],
    legislators: legs,
    campaign_send_batches: [{
      id: "batch-1", user_id: USER, campaign_id: "camp-1",
      subject_template: "Please oppose HB 1",
      body_template: "Dear {{recipient_title}} {{recipient_last_name}},\n\nPlease vote no.\n\n{{full_name}}",
      status: "sending", total_count: n, sent_count: 0, failed_count: 0, created_at: "2026-11-11T12:00:00.000Z",
    }],
    campaign_send_batch_items: legs.map((l, i) => ({
      id: `item-${String(i).padStart(3, "0")}`, batch_id: "batch-1", legislator_id: l.id, email: l.email, status: "pending", attempts: 0,
    })),
    campaign_actions: [],
    notifications: [],
    // enqueueCampaignSend seeds this (ensureDrainLeaseRow) before any drain.
    rate_limits: [{ key: drainLeaseKey(USER), window_start: "1970-01-01T00:00:00.000Z", count: 0 }],
  };
}

const call = (headers: Record<string, string> = { "x-ikratom-send-queue": "1" }) =>
  POST(new Request("http://localhost/api/campaigns/send-queue", { method: "POST", headers }));

const batchRow = () => h.db.tables.campaign_send_batches[0] as unknown as DrainBatchRow;
const uniqueRecipients = () => new Set(h.sent.map((s) => s.to)).size;

describe("server: a started send keeps going from any page", () => {
  beforeEach(() => seed(25));

  it("the app-shell route drains the member's queue with no campaign page involved", async () => {
    let last: QueueReply | null = null;
    for (let i = 0; i < 5 && last?.status !== "idle"; i++) last = (await (await call()).json()) as QueueReply;
    expect(last).toEqual({ status: "idle", remaining: 0, busy: false });
    expect(h.sent).toHaveLength(25);
    expect(uniqueRecipients()).toBe(25);
    expect(h.sent[0].body).toMatch(/^Dear Representative Smith0,/);
    expect(batchRow().status).toBe("complete");
    expect(h.db.tables.campaign_actions).toHaveLength(25);
    // Released at the end of the slice, so the next caller can drive at once.
    const lease = h.db.tables.rate_limits.find((r) => r.key === drainLeaseKey(USER));
    expect(lease?.count).toBe(0);
  });

  it("refuses a call without the header, and anyone signed out", async () => {
    expect((await call({})).status).toBe(400);
    h.signedIn = null;
    expect((await call()).status).toBe(401);
    expect(h.sent).toHaveLength(0);
  });

  it("reports a paused queue as paused, so the browser stops asking", async () => {
    h.limits.effectiveDaily = 0;
    const reply = (await (await call()).json()) as QueueReply;
    expect(reply.status).toBe("paused");
    expect(h.sent).toHaveLength(0);
    expect(String(h.db.tables.campaign_send_batches[0].pause_reason)).toMatch(/Daily limit reached/);
  });
});

describe("two tabs can't double-send", () => {
  beforeEach(() => seed(10));

  it("two tabs at once: one drives, the other is told busy and sends nothing", async () => {
    const replies = (await Promise.all([call(), call()].map(async (p) => (await p).json()))) as QueueReply[];
    expect(replies.filter((r) => r.busy)).toHaveLength(1);
    expect(h.sent).toHaveLength(10);
    expect(uniqueRecipients()).toBe(10);
    expect(h.db.tables.campaign_send_batch_items.every((i) => i.status === "sent" && i.attempts === 1)).toBe(true);
  });

  it("two tabs at once can't go past the daily cap", async () => {
    // Without the lease each slice reads "sent today" once at its start, so
    // two at once could each send the full remaining allowance.
    h.limits.effectiveDaily = 4;
    let late = false;
    h.beforeSend = async (n) => { if (n === 2 && !late) { late = true; await call(); } };
    await Promise.all([call(), call()]);
    expect(h.sent).toHaveLength(4);
  });

  it("a tab that starts mid-slice can't re-send the letter in flight", async () => {
    // The hole the old 1-per-4s throttle left: a slice that starts while
    // another is mid-send reads that letter as still pending, with the attempt
    // already counted, so its own compare-and-swap succeeds.
    let second: QueueReply | null = null;
    // The third letter is claimed and on its way out when a second tab calls.
    h.beforeSend = async (n) => {
      if (n !== 2 || second) return;
      second = { status: "sending", remaining: -1, busy: false };
      second = (await (await call()).json()) as QueueReply;
    };
    await call();
    expect(second).toMatchObject({ busy: true });
    expect(h.sent).toHaveLength(10);
    expect(uniqueRecipients()).toBe(10);
  });

  it("drainers that start together never send a letter twice (the compare-and-swap)", async () => {
    seed(30);
    const deadline = Date.now() + 10_000;
    const results = await Promise.all([drainBatch(h.db.client() as never, batchRow(), deadline), drainBatch(h.db.client() as never, batchRow(), deadline)]);
    expect(results[0].sent + results[1].sent).toBe(30);
    expect(h.sent).toHaveLength(30);
    expect(uniqueRecipients()).toBe(30);
    expect(h.db.tables.campaign_actions).toHaveLength(30);
  });

  it("a holder that outlived its lease can't free the next holder's", async () => {
    const a = await acquireDrainLease(USER);
    expect(a).not.toBeNull();
    expect(await acquireDrainLease(USER)).toBeNull();
    // A's slice runs past the window (the host would have killed it by now).
    h.db.offsetMs += 60_000;
    const b = await acquireDrainLease(USER);
    expect(b).not.toBeNull();
    await a!.release(); // stale: must not touch B's window
    expect(await acquireDrainLease(USER)).toBeNull();
    await b!.release();
    expect(await acquireDrainLease(USER)).not.toBeNull();
  });
});

describe("a member's very first send", () => {
  it("can't hand the lease to two tabs", async () => {
    seed(1);
    h.db.tables.rate_limits = []; // a member who has never sent
    const raced = await Promise.all([acquireDrainLease(USER), acquireDrainLease(USER)]);
    expect(raced.filter(Boolean)).toHaveLength(2); // check_rate_limit's insert race
    h.db.tables.rate_limits = [];
    await ensureDrainLeaseRow(USER); // what queueing a send now does first
    const after = await Promise.all([acquireDrainLease(USER), acquireDrainLease(USER)]);
    expect(after.filter(Boolean)).toHaveLength(1);
    await ensureDrainLeaseRow(USER); // and it never resets a lease someone holds
    expect(await acquireDrainLease(USER)).toBeNull();
  });

  it("queueing a send seeds the lease row before anything can drain it", () => {
    const enqueue = readFileSync(new URL("../src/modules/campaigns/send-batch-actions.ts", import.meta.url), "utf8");
    const fn = enqueue.slice(enqueue.indexOf("export async function enqueueCampaignSend"), enqueue.indexOf("export type BatchProgress"));
    expect(fn).toMatch(/await ensureDrainLeaseRow\(user\.id\);\s*return \{\s*ok: true/);
  });
});

// ── Browser side ───────────────────────────────────────────────────────────

function memoryStore(initial: string | null = null): HintStore & { value: string | null } {
  return {
    value: initial,
    get() { return this.value; },
    set(v) { this.value = v; },
    remove() { this.value = null; },
  };
}

function fakeBrowser(store: HintStore, replies: (QueueReply | null)[], opts: { pageDriving?: () => boolean; onSleep?: (ms: number) => void } = {}) {
  let clock = Date.parse("2026-11-11T18:00:00Z");
  const ticks: number[] = [];
  const sleeps: number[] = [];
  const deps: DriverDeps = {
    store,
    now: () => clock,
    tick: async () => { ticks.push(clock); return replies.length ? replies.shift()! : { status: "idle", remaining: 0, busy: false }; },
    sleep: async (ms) => { sleeps.push(ms); clock += ms; opts.onSleep?.(ms); await Promise.resolve(); },
    pageDriving: opts.pageDriving ?? (() => false),
  };
  return { deps, ticks, sleeps, now: () => clock };
}

const sending = (remaining: number, busy = false): QueueReply => ({ status: "sending", remaining, busy });

describe("browser: the shell driver takes over when the member leaves the campaign page", () => {
  it("makes no request at all when this browser has no send in flight", async () => {
    const b = fakeBrowser(memoryStore(), [sending(5)]);
    expect(await runSendQueueDriver(b.deps, new AbortController().signal)).toBe("idle");
    expect(b.ticks).toHaveLength(0);
  });

  it("stays out of the way while the panel drives, then drives until the queue is empty", async () => {
    const store = memoryStore();
    writeActiveHint(store, Date.parse("2026-11-11T18:00:00Z"));
    const release = registerPageDriver(); // the campaign panel is mounted and driving
    let yields = 0;
    const b = fakeBrowser(store, [sending(95), sending(80), sending(65)], {
      pageDriving: pageDriverActive,
      // After three check-ins the member opens the group discussion page.
      onSleep: () => { if (++yields === 3) release(); },
    });
    expect(await runSendQueueDriver(b.deps, new AbortController().signal)).toBe("idle");
    expect(pageDriverActive()).toBe(false);
    expect(b.sleeps.slice(0, 3)).toEqual([YIELD_MS, YIELD_MS, YIELD_MS]);
    expect(b.ticks).toHaveLength(4); // three slices, then "idle"
    expect(b.sleeps.slice(3)).toEqual([GAP_MS, GAP_MS, GAP_MS]);
    expect(store.value).toBeNull(); // done: no more requests from this browser
  });

  it("backs off while another tab or device holds the mailbox", async () => {
    const store = memoryStore();
    writeActiveHint(store, Date.parse("2026-11-11T18:00:00Z"));
    const b = fakeBrowser(store, [sending(10, true), sending(10)]);
    await runSendQueueDriver(b.deps, new AbortController().signal);
    expect(b.sleeps).toEqual([BUSY_MS, GAP_MS]);
  });

  it("a paused queue is re-checked every half hour, not hammered", async () => {
    const store = memoryStore();
    writeActiveHint(store, Date.parse("2026-11-11T18:00:00Z"));
    const b = fakeBrowser(store, [{ status: "paused", remaining: 60, busy: false }, sending(60)]);
    await runSendQueueDriver(b.deps, new AbortController().signal);
    expect(b.ticks).toHaveLength(3);
    expect(b.ticks[1] - b.ticks[0]).toBe(PAUSED_RECHECK_MS);
  });

  it("gives up to the cron after repeated network errors", async () => {
    const store = memoryStore();
    writeActiveHint(store, Date.parse("2026-11-11T18:00:00Z"));
    const b = fakeBrowser(store, Array(MAX_ERRORS).fill(null));
    expect(await runSendQueueDriver(b.deps, new AbortController().signal)).toBe("gave-up");
    expect(b.ticks).toHaveLength(MAX_ERRORS);
    expect(readHint(store, b.now())?.notBefore).toBe(b.now() + PAUSED_RECHECK_MS);
  });

  it("an expired hint is dropped", () => {
    const store = memoryStore();
    writeActiveHint(store, 0);
    expect(readHint(store, HINT_TTL_MS + 1)).toBeNull();
    expect(store.value).toBeNull();
  });
});

describe("browser: two tabs, one driver", () => {
  /** A FIFO LockManager, the part of navigator.locks the driver uses. */
  function fakeLocks() {
    let held = false;
    const waiting: (() => void)[] = [];
    return {
      async request(_n: string, o: { signal?: AbortSignal }, cb: () => Promise<unknown>) {
        if (held) {
          await new Promise<void>((resolve, reject) => {
            waiting.push(resolve);
            o.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          });
        }
        held = true;
        try { return await cb(); } finally { held = false; waiting.shift()?.(); }
      },
    };
  }

  it("only the tab holding the lock sends; the other takes over when it closes", async () => {
    const store = memoryStore();
    writeActiveHint(store, Date.now());
    const locks = fakeLocks();
    let inFlight = 0;
    let maxInFlight = 0;
    let remaining = 6;
    const perTab = [0, 0];
    const tab1 = new AbortController();
    const deps = (tab: number): DriverDeps => ({
      store,
      now: Date.now,
      tick: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight--;
        perTab[tab]++;
        remaining--;
        if (tab === 0 && perTab[0] === 2) tab1.abort(); // the member closes the first tab
        return remaining > 0 ? sending(remaining) : { status: "idle", remaining: 0, busy: false };
      },
      sleep: () => new Promise((r) => setImmediate(r)),
      pageDriving: () => false,
    });
    await Promise.all([
      withSendQueueLock(() => runSendQueueDriver(deps(0), tab1.signal), tab1.signal, locks),
      withSendQueueLock(() => runSendQueueDriver(deps(1), new AbortController().signal), new AbortController().signal, locks),
    ]);
    expect(maxInFlight).toBe(1);
    expect(perTab).toEqual([2, 4]);
    expect(store.value).toBeNull();
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  it("the app shell mounts the driver for signed-in members with a mailbox", () => {
    expect(read("src/app/layout.tsx")).toMatch(/<SendQueueDriverGate \/>/);
    const gates = read("src/components/chrome/ChromeGates.tsx");
    expect(gates).toMatch(/if \(!me\?\.userId \|\| !me\.emailConnected\) return null;\s*return <SendQueueDriver \/>/);
  });

  it("the driver uses a plain fetch, never a server action", () => {
    // Next runs server actions one at a time per tab: a 15 s drain held as an
    // action would make the member's forum post wait behind it.
    const client = read("src/modules/campaigns/send-queue-client.ts");
    expect(client).toMatch(/fetch\("\/api\/campaigns\/send-queue"/);
    expect(client).not.toMatch(/send-batch-actions/);
    expect(read("src/app/api/campaigns/send-queue/route.ts")).not.toMatch(/"use server"/);
  });

  it("the panel hands over: it marks the send and registers while it drives", () => {
    const panel = read("src/modules/campaigns/components/SendBatchPanel.tsx");
    expect(panel).toMatch(/registerPageDriver\(\)/);
    expect(panel).toMatch(/markSendQueueActive\(\)/);
    expect(panel).toMatch(/release\?\.\(\)/);
  });

  it("page, route and cron all take the same lease", () => {
    expect(read("src/modules/campaigns/send-batch-actions.ts")).toMatch(/driveMemberQueue\(serviceClient\(\), user\.id, \{ deadline: Date\.now\(\) \+ 15_000, prefer: mine \}\)/);
    expect(read("src/modules/campaigns/drive-queue.ts")).toMatch(/const lease = await acquireDrainLease\(userId\);\s*if \(!lease\) return \{ busy: true/);
    expect(read("src/app/api/cron/drain-send-batches/route.ts")).toMatch(/const lease = await acquireDrainLease\(batch\.user_id\);\s*if \(!lease\) \{ more = true; continue; \}/);
  });

  it("summarizeQueue: anything that can move now is 'sending'", () => {
    expect(summarizeQueue([])).toEqual({ status: "idle", remaining: 0 });
    expect(summarizeQueue([{ status: "paused", total_count: 10, sent_count: 4, failed_count: 1 }])).toEqual({ status: "paused", remaining: 5 });
    expect(summarizeQueue([
      { status: "paused", total_count: 10, sent_count: 4, failed_count: 1 },
      { status: "queued", total_count: 3, sent_count: 0, failed_count: 0 },
      { status: "complete", total_count: 9, sent_count: 9, failed_count: 0 },
    ])).toEqual({ status: "sending", remaining: 8 });
  });
});
