/**
 * Read-through snapshot logic, storage-agnostic (pure, unit-tested).
 * The R2 store and the on/off switch live in ./public-snapshots.ts.
 *
 * Rules:
 * - A fresh snapshot (younger than maxAgeSec) is served without calling the loader.
 * - Otherwise the loader runs once; a complete result is stored for next time.
 * - If the loader THROWS (Supabase failing or restricted), the last good
 *   snapshot is served however old it is. Pages stay up.
 * - A loader result marked not-cacheable (a sub-query failed, so the data may
 *   be partial) is returned but never stored; a stale complete copy is
 *   preferred over it.
 * - A store that fails (timeout, network) is treated as a miss / skipped write;
 *   it never breaks the page.
 */

export type SnapshotStore = {
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
};

export type SnapshotLoad<T> = { data: T | null; cacheable: boolean };

type Envelope<T> = { v: 1; generated_at: string; data: T };

async function read<T>(store: SnapshotStore, key: string): Promise<Envelope<T> | null> {
  try {
    const body = await store.get(key);
    if (!body) return null;
    const env = JSON.parse(body) as Envelope<T>;
    return env && env.v === 1 && typeof env.generated_at === "string" ? env : null;
  } catch {
    return null;
  }
}

export async function snapshotThroughStore<T>(
  store: SnapshotStore | null,
  key: string,
  maxAgeSec: number,
  load: () => Promise<SnapshotLoad<T>>,
  now: () => number = Date.now,
): Promise<T | null> {
  if (!store) return (await load()).data;

  const hit = await read<T>(store, key);
  if (hit && now() - Date.parse(hit.generated_at) < maxAgeSec * 1000) return hit.data;

  let res: SnapshotLoad<T>;
  try {
    res = await load();
  } catch (e) {
    if (hit) return hit.data;
    throw e;
  }

  if (res.data !== null && res.data !== undefined) {
    if (res.cacheable) {
      const env: Envelope<T> = { v: 1, generated_at: new Date(now()).toISOString(), data: res.data };
      try {
        await store.put(key, JSON.stringify(env));
      } catch {
        /* a failed write only means the next miss reloads */
      }
    } else if (hit) {
      return hit.data;
    }
  }
  return res.data;
}
