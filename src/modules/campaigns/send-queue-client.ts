import type { SendQueueResponse } from "@/app/api/campaigns/send-queue/route";

/**
 * Browser half of "a started send keeps going on any page" (PJ, 2026-11-11).
 *
 * The campaign page's SendBatchPanel drives a send while it is open. When the
 * member leaves for another page, SendQueueDriver (mounted in the app shell for
 * signed-in members with a connected mailbox) takes over and keeps calling
 * /api/campaigns/send-queue until the queue is empty.
 *
 * It costs nothing for everyone else: the driver makes no request unless this
 * browser holds a hint that a send is in flight. The panel writes the hint when
 * it sees a live batch; the driver clears it once the server says the queue is
 * empty.
 *
 * Who drives, so nothing doubles up:
 *   - in one tab, the campaign panel when it is mounted, otherwise the driver;
 *   - across tabs, only the tab holding the Web Lock (the rest wait in line and
 *     take over if that tab closes);
 *   - across devices and the cron, the server's drain lease.
 * None of these is what stops a double send. That is the per-recipient
 * compare-and-swap in drainBatch, which holds even if all of them fail.
 */

export const SEND_QUEUE_HINT_KEY = "ikratom-send-queue";
export const SEND_QUEUE_WAKE_EVENT = "ikratom:send-queue";
export const SEND_QUEUE_LOCK = "ikratom-send-queue";

/** Pause between slices; the same gap the campaign panel uses. */
export const GAP_MS = 3_000;
/** Another tab, device or the cron holds the mailbox: look again in a while. */
export const BUSY_MS = 15_000;
/** While the panel in this tab drives, just check back. Makes no request. */
export const YIELD_MS = 5_000;
/** Paused (daily limit, disconnected mailbox): the cron resumes it; we only re-check now and then. */
export const PAUSED_RECHECK_MS = 30 * 60_000;
/** A hint nobody refreshes stops mattering after a week. */
export const HINT_TTL_MS = 7 * 86_400_000;
/** Network trouble: back off, and after this many failures in a row leave it to the cron. */
export const MAX_ERRORS = 5;

export type QueueReply = SendQueueResponse;

export interface HintStore {
  get(): string | null;
  set(value: string): void;
  remove(): void;
}

type Hint = { until: number; notBefore?: number };

export function readHint(store: HintStore, now: number): Hint | null {
  let raw: string | null = null;
  try { raw = store.get(); } catch { return null; }
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Hint;
    if (typeof h?.until === "number" && h.until > now) return h;
  } catch { /* fall through and drop it */ }
  try { store.remove(); } catch { /* ignore */ }
  return null;
}

export function writeActiveHint(store: HintStore, now: number) {
  try { store.set(JSON.stringify({ until: now + HINT_TTL_MS })); } catch { /* private mode etc. */ }
}

export function deferHint(store: HintStore, now: number, ms: number) {
  const h = readHint(store, now);
  if (!h) return;
  try { store.set(JSON.stringify({ until: h.until, notBefore: now + ms })); } catch { /* ignore */ }
}

export function clearHint(store: HintStore) {
  try { store.remove(); } catch { /* ignore */ }
}

// ── Which component in THIS tab is driving ─────────────────────────────────

let pageDrivers = 0;

/** The campaign panel calls this while it drives its own batch; the shell driver steps aside. */
export function registerPageDriver(): () => void {
  pageDrivers++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pageDrivers = Math.max(0, pageDrivers - 1);
    wakeSendQueueDriver();
  };
}

export function pageDriverActive(): boolean {
  return pageDrivers > 0;
}

// ── The loop ───────────────────────────────────────────────────────────────

export type DriverDeps = {
  store: HintStore;
  now: () => number;
  /** One slice on the server. null means the request failed. */
  tick: () => Promise<QueueReply | null>;
  /** Resolves after ms, on abort, or early when something wakes the driver. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  pageDriving: () => boolean;
};

export type DriverExit = "idle" | "aborted" | "gave-up";

export async function runSendQueueDriver(deps: DriverDeps, signal: AbortSignal): Promise<DriverExit> {
  let errors = 0;
  while (!signal.aborted) {
    const hint = readHint(deps.store, deps.now());
    if (!hint) return "idle";

    const wait = (hint.notBefore ?? 0) - deps.now();
    if (wait > 0) { await deps.sleep(wait, signal); continue; }
    if (deps.pageDriving()) { await deps.sleep(YIELD_MS, signal); continue; }

    const reply = await deps.tick();
    if (signal.aborted) return "aborted";
    if (!reply) {
      errors++;
      if (errors >= MAX_ERRORS) {
        // Leave it to the cron (and the next page load) rather than hammer a
        // failing endpoint from every open tab.
        deferHint(deps.store, deps.now(), PAUSED_RECHECK_MS);
        return "gave-up";
      }
      await deps.sleep(Math.min(60_000, GAP_MS * 2 ** errors), signal);
      continue;
    }
    errors = 0;

    if (reply.status === "idle") { clearHint(deps.store); return "idle"; }
    if (reply.status === "paused") { deferHint(deps.store, deps.now(), PAUSED_RECHECK_MS); continue; }
    await deps.sleep(reply.busy ? BUSY_MS : GAP_MS, signal);
  }
  return "aborted";
}

// ── Cross-tab: one driving tab per browser ──────────────────────────────────

type LockManagerLike = {
  request(name: string, options: { signal?: AbortSignal }, cb: () => Promise<unknown>): Promise<unknown>;
};

/**
 * Run `fn` while holding the browser-wide send-queue lock. Other tabs wait in
 * line and take over if this one closes. Browsers without Web Locks just run
 * it; the server lease still keeps it to one slice per mailbox.
 */
export async function withSendQueueLock(
  fn: () => Promise<unknown>,
  signal: AbortSignal,
  locks: LockManagerLike | undefined = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks,
): Promise<void> {
  if (!locks || typeof locks.request !== "function") { await fn(); return; }
  try {
    await locks.request(SEND_QUEUE_LOCK, { signal }, async () => { await fn(); });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    throw e;
  }
}

// ── Browser bindings ────────────────────────────────────────────────────────

export function browserHintStore(): HintStore {
  return {
    get: () => window.localStorage.getItem(SEND_QUEUE_HINT_KEY),
    set: (v) => window.localStorage.setItem(SEND_QUEUE_HINT_KEY, v),
    remove: () => window.localStorage.removeItem(SEND_QUEUE_HINT_KEY),
  };
}

export function wakeSendQueueDriver() {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new Event(SEND_QUEUE_WAKE_EVENT)); } catch { /* ignore */ }
}

/**
 * Called by the campaign panel whenever it sees a live batch. Writes only when
 * the hint is missing, deferred or half-expired: every write fires a `storage`
 * event in the member's other tabs, and their drivers would wake for nothing.
 */
export function markSendQueueActive() {
  if (typeof window === "undefined") return;
  const store = browserHintStore();
  const now = Date.now();
  const h = readHint(store, now);
  if (h && !h.notBefore && h.until - now > HINT_TTL_MS / 2) return;
  writeActiveHint(store, now);
  wakeSendQueueDriver();
}

export function browserSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      window.removeEventListener(SEND_QUEUE_WAKE_EVENT, done);
      window.removeEventListener("storage", onStorage);
      resolve();
    };
    const onStorage = (e: StorageEvent) => { if (e.key === SEND_QUEUE_HINT_KEY) done(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
    window.addEventListener(SEND_QUEUE_WAKE_EVENT, done);
    window.addEventListener("storage", onStorage);
  });
}

export async function postSendQueueTick(): Promise<QueueReply | null> {
  try {
    const res = await fetch("/api/campaigns/send-queue", {
      method: "POST",
      headers: { "x-ikratom-send-queue": "1" },
      credentials: "same-origin",
      cache: "no-store",
    });
    // Signed out in another tab: nothing this browser may drive.
    if (res.status === 401) return { status: "idle", remaining: 0, busy: false };
    if (!res.ok) return null;
    return (await res.json()) as QueueReply;
  } catch {
    return null;
  }
}
