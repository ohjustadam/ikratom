/**
 * The backup path had NO tests at all until 2026-10-08 — not one, on the code
 * that is the only thing standing between a bad day and losing every account.
 *
 * Two halves, both of which had a real hole:
 *
 *   1. backup-crypto.mjs. Its `inspect()` — the only way to check a sealed file
 *      WITHOUT the private key, and therefore the only check that can ever run
 *      in CI — was called from exactly one place, the owner's local
 *      pull-backups.mjs. `generateKeyPair()` was dead code. Nothing proved a
 *      sealed file round-trips, or that tampering is detected.
 *
 *   2. The snapshot guard. db-snapshot-api.mjs wrote
 *      `scraper_runs.status = "success"` unconditionally the moment encryption
 *      resolved. If the Management API had returned `[]` for every table — an
 *      expired token, a permissions change, a renamed schema — the job would
 *      have produced a small well-formed .enc file, printed a tick, uploaded it
 *      as the day's backup and recorded a clean run. The workflow's
 *      `if-no-files-found: error` cannot catch that: the file exists, it is just
 *      empty. The guard is now a pure function so every branch is reachable
 *      here, because a guard nobody has watched go red is decoration.
 *
 * These tests use an EPHEMERAL keypair, never private/backup-private-key.pem,
 * so they prove the crypto works without the real key existing anywhere near
 * CI — which is the same reason the production guard never decrypts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  generateKeyPair, encryptStream, decryptFile, inspect,
} from "../scripts/lib/backup-crypto.mjs";
import {
  assessSnapshot, countsFromStats, MUST_HAVE_TABLES, DEFAULT_MIN_ROWS,
} from "../scripts/lib/snapshot-guard.mjs";

let dir: string;
let keys: { publicKey: string; privateKey: string };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ikbk-"));
  keys = generateKeyPair();
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** The shape db-snapshot-api.mjs actually writes: one {"table","row"} per line. */
const SAMPLE = [
  JSON.stringify({ table: "auth.users", row: { id: "u1", email: "a@example.test" } }) + "\n",
  JSON.stringify({ table: "public.profiles", row: { id: "u1", username: "advocate" } }) + "\n",
];

async function seal(name: string, lines: string[] = SAMPLE) {
  const out = path.join(dir, name);
  await encryptStream(Readable.from(lines), out, keys.publicKey);
  return out;
}

describe("backup-crypto: a sealed backup actually opens again", () => {
  it("round-trips byte-for-byte with the matching private key", async () => {
    const sealed = await seal("roundtrip.enc");
    const plain = path.join(dir, "roundtrip.jsonl");
    decryptFile(sealed, plain, keys.privateKey);
    expect(fs.readFileSync(plain, "utf8")).toBe(SAMPLE.join(""));
  });

  it("refuses a DIFFERENT private key — a backup is only openable by its owner", async () => {
    const sealed = await seal("wrongkey.enc");
    const other = generateKeyPair();
    expect(() => decryptFile(sealed, path.join(dir, "wrongkey.jsonl"), other.privateKey)).toThrow();
  });

  it("detects tampering — a flipped ciphertext byte must not decrypt silently", async () => {
    const sealed = await seal("tampered.enc");
    const buf = fs.readFileSync(sealed);
    // Flip a byte inside the ciphertext body, past the header and IV and well
    // clear of the trailing 16-byte auth tag.
    const at = Math.floor((buf.length - 16 + 600) / 2);
    buf[at] = buf[at] ^ 0xff;
    fs.writeFileSync(sealed, buf);
    // AES-GCM authenticates: this is the property that makes storing backups on
    // someone else's disk safe, so it must fail loudly, not return garbage.
    expect(() => decryptFile(sealed, path.join(dir, "tampered.jsonl"), keys.privateKey)).toThrow();
  });

  it("rejects a file that is not a backup at all", () => {
    const notABackup = path.join(dir, "random.bin");
    fs.writeFileSync(notABackup, Buffer.from("this is just some bytes, not IKBK1"));
    expect(() => decryptFile(notABackup, path.join(dir, "x.jsonl"), keys.privateKey)).toThrow(/not an iKratom backup/);
  });
});

describe("backup-crypto: inspect() — the only check CI can run (no private key)", () => {
  it("accepts a real sealed file", async () => {
    expect(inspect(await seal("good.enc"))).toMatchObject({ ok: true });
  });

  it("rejects wrong magic", () => {
    const f = path.join(dir, "badmagic.enc");
    fs.writeFileSync(f, Buffer.alloc(4096, 7));
    const r = inspect(f);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/magic/i);
  });

  it("rejects a truncated file — an interrupted upload is not a backup", async () => {
    const sealed = await seal("truncated.enc");
    const buf = fs.readFileSync(sealed);
    // Keep the header (so magic still matches) and almost nothing else.
    fs.writeFileSync(sealed, buf.subarray(0, 12));
    const r = inspect(sealed);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/truncated/i);
  });
});

describe("snapshot guard: an empty backup must not report success", () => {
  const healthy = { "auth.users": 46, "public.profiles": 46, "public.campaign_actions": 1393 };
  const sealedOk = { ok: true as const };

  it("passes a healthy snapshot", () => {
    const r = assessSnapshot({ counts: healthy, sealed: sealedOk });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.rowsTotal).toBe(1485);
  });

  it("FAILS when the accounts table came back empty", () => {
    const r = assessSnapshot({ counts: { ...healthy, "auth.users": 0 }, sealed: sealedOk });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/auth\.users captured 0 rows/);
  });

  it("FAILS when a required table is missing entirely, not just zero", () => {
    const counts: Record<string, number> = { ...healthy };
    delete counts["public.profiles"];
    const r = assessSnapshot({ counts, sealed: sealedOk });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/public\.profiles captured 0 rows/);
  });

  it("FAILS the total-rows floor — the every-table-returned-[] scenario", () => {
    // This is the exact shape of the failure the guard was written for: the API
    // answers, encryption succeeds, the seal is valid, and nothing is inside.
    const r = assessSnapshot({ counts: {}, sealed: sealedOk });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/captured 0 rows total/);
    // ...and it names the missing accounts too, so the log says what was lost.
    for (const t of MUST_HAVE_TABLES) expect(r.problems.join(" ")).toContain(t);
  });

  it("FAILS a damaged seal even when the counts are perfect", () => {
    const r = assessSnapshot({ counts: healthy, sealed: { ok: false, reason: "truncated" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/failed inspection: truncated/);
  });

  it("treats a missing inspection result as a failure, not a pass", () => {
    // Guarding the guard: if inspect() ever returns undefined, the old inline
    // `!sealed.ok` would have thrown and been swallowed by the job's catch.
    const r = assessSnapshot({ counts: healthy, sealed: undefined as never });
    expect(r.ok).toBe(false);
  });

  it("reports the real floor and the critical-table summary for the log", () => {
    const r = assessSnapshot({ counts: healthy, sealed: sealedOk, minRows: DEFAULT_MIN_ROWS });
    expect(r.critical).toBe("auth.users=46 public.profiles=46");
  });

  it("parses the table=count stats the snapshot accumulates while streaming", () => {
    expect(countsFromStats(["auth.users=46", "public.profiles=46", "public.empty=0"]))
      .toEqual({ "auth.users": 46, "public.profiles": 46, "public.empty": 0 });
  });
});
