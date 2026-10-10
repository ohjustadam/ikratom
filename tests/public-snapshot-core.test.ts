import { describe, it, expect, vi } from "vitest";
import { snapshotThroughStore, type SnapshotStore } from "../src/lib/public-snapshot-core";

function memStore(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  const store: SnapshotStore & { m: Map<string, string> } = {
    m,
    get: vi.fn(async (k: string) => m.get(k) ?? null),
    put: vi.fn(async (k: string, b: string) => { m.set(k, b); }),
  };
  return store;
}
const env = (data: unknown, at: string) => JSON.stringify({ v: 1, generated_at: at, data });
const T0 = Date.parse("2026-10-10T00:00:00Z");
const HOUR = 3600 * 1000;

describe("snapshotThroughStore", () => {
  it("serves a fresh snapshot without calling the loader", async () => {
    const store = memStore({ k: env({ a: 1 }, new Date(T0 - HOUR).toISOString()) });
    const load = vi.fn();
    expect(await snapshotThroughStore(store, "k", 6 * 3600, load, () => T0)).toEqual({ a: 1 });
    expect(load).not.toHaveBeenCalled();
  });

  it("on a miss, loads once and stores a complete result for next time", async () => {
    const store = memStore();
    const load = vi.fn(async () => ({ data: { a: 2 }, cacheable: true }));
    expect(await snapshotThroughStore(store, "k", 3600, load, () => T0)).toEqual({ a: 2 });
    expect(JSON.parse(store.m.get("k")!)).toEqual({ v: 1, generated_at: new Date(T0).toISOString(), data: { a: 2 } });
    expect(await snapshotThroughStore(store, "k", 3600, load, () => T0 + 1000)).toEqual({ a: 2 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads a stale snapshot and overwrites it", async () => {
    const store = memStore({ k: env({ a: "old" }, new Date(T0 - 7 * HOUR).toISOString()) });
    const load = vi.fn(async () => ({ data: { a: "new" }, cacheable: true }));
    expect(await snapshotThroughStore(store, "k", 6 * 3600, load, () => T0)).toEqual({ a: "new" });
    expect(JSON.parse(store.m.get("k")!).data).toEqual({ a: "new" });
  });

  it("serves the last good snapshot, however old, when the loader throws (Supabase down)", async () => {
    const store = memStore({ k: env({ a: "last good" }, new Date(T0 - 300 * HOUR).toISOString()) });
    const load = vi.fn(async () => { throw new Error("restricted"); });
    expect(await snapshotThroughStore(store, "k", 3600, load, () => T0)).toEqual({ a: "last good" });
  });

  it("rethrows when the loader throws and there is nothing stored", async () => {
    await expect(snapshotThroughStore(memStore(), "k", 3600, async () => { throw new Error("down"); })).rejects.toThrow("down");
  });

  it("never stores a partial result, and prefers a stale complete copy over it", async () => {
    const empty = memStore();
    expect(await snapshotThroughStore(empty, "k", 3600, async () => ({ data: { votes: [] }, cacheable: false }))).toEqual({ votes: [] });
    expect(empty.put).not.toHaveBeenCalled();

    const stale = memStore({ k: env({ votes: [1, 2] }, new Date(T0 - 7 * HOUR).toISOString()) });
    expect(await snapshotThroughStore(stale, "k", 3600, async () => ({ data: { votes: [] }, cacheable: false }), () => T0)).toEqual({ votes: [1, 2] });
  });

  it("returns null for a missing entity and does not store it", async () => {
    const store = memStore();
    expect(await snapshotThroughStore(store, "k", 3600, async () => ({ data: null, cacheable: false }))).toBeNull();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("treats a broken store as a miss and a failed write as harmless", async () => {
    const broken: SnapshotStore = { get: async () => { throw new Error("timeout"); }, put: async () => { throw new Error("nope"); } };
    expect(await snapshotThroughStore(broken, "k", 3600, async () => ({ data: { ok: 1 }, cacheable: true }))).toEqual({ ok: 1 });
    const junk = memStore({ k: "{not json" });
    expect(await snapshotThroughStore(junk, "k", 3600, async () => ({ data: { ok: 2 }, cacheable: true }))).toEqual({ ok: 2 });
  });

  it("with no store (switched off) just runs the loader", async () => {
    const load = vi.fn(async () => ({ data: { off: true }, cacheable: true }));
    expect(await snapshotThroughStore(null, "k", 3600, load)).toEqual({ off: true });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
