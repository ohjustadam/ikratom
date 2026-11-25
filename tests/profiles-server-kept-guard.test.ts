import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Guards for the profile fields the server keeps (migration 0334) and for the
 * Academy exam (0333). Both are SQL, with no runtime test here (they need a
 * live session), so these assert the shape at the source level. The live proof
 * is a rolled-back attack in prod (see the PR).
 *
 * The scan is the point: every SECURITY DEFINER function that writes a
 * profiles column marks that column as kept by the server, so a member's own
 * API write must not be able to change it. A new definer writer fails here
 * until its column joins a guard or the reviewed allowlist below.
 */

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

type Fn = { name: string; header: string; body: string; file: string };

/** The LAST definition of every public function, in migration order. */
function latestFunctions(): Map<string, Fn> {
  const out = new Map<string, Fn>();
  const re =
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi;
  for (const file of files) {
    const sql = readFileSync(`${DIR}/${file}`, "utf8");
    for (const m of sql.matchAll(re)) {
      out.set(m[1].toLowerCase(), { name: m[1], header: m[2], body: m[4], file });
    }
  }
  return out;
}

/** Columns a function body assigns in `update [public.]profiles set ...`. */
function profileColumnsSet(body: string): string[] {
  const cols = new Set<string>();
  const re = /update\s+(?:public\.)?profiles(?:\s+\w+)?\s+set\s+([\s\S]*?)(?:\bwhere\b|;)/gi;
  for (const m of body.matchAll(re)) {
    for (const c of m[1].matchAll(/(?:^|,)\s*(\w+)\s*=/g)) cols.add(c[1].toLowerCase());
  }
  return [...cols];
}

/** Columns a guard compares as `new.x is distinct from old.x`. */
function guardedColumns(body: string): string[] {
  return [...body.matchAll(/new\.(\w+)\s+is\s+distinct\s+from\s+old\.\1/gi)].map((m) =>
    m[1].toLowerCase(),
  );
}

const fns = latestFunctions();

// Written by a definer function, but a member may also set them directly.
const SELF_WRITABLE: Record<string, string> = {
  last_seen_at: "presence, not trust (touch_last_seen)",
  lounge_seen_at: "the member's own unread marker",
  username: "the member picks it; guard_reserved_username screens it",
  username_chosen: "set with the username",
  updated_at: "bookkeeping",
};

describe("profile fields the server keeps", () => {
  const serverKept = fns.get("guard_profiles_server_kept");
  const selfPrivilege = fns.get("guard_profiles_self_privilege");

  it("the guard exists and runs as the caller, so it can tell a definer write from a direct one", () => {
    expect(serverKept, "guard_profiles_server_kept not found").toBeDefined();
    expect(serverKept!.header).toMatch(/security\s+invoker/i);
    expect(serverKept!.header).not.toMatch(/security\s+definer/i);
    expect(serverKept!.body).toMatch(/current_user\s+not\s+in\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)/i);
  });

  it("guards the fields moderation and the checkmark trust", () => {
    const g = new Set(guardedColumns(serverKept!.body));
    for (const c of [
      "power_user_at", "points_total", "forum_post_count", "created_at",
      "chat_muted_until", "intel_approved_count", "intel_rejected_count",
      "action_streak_days", "longest_streak_days", "last_action_date",
    ]) {
      expect(g.has(c), `${c} must be guarded`).toBe(true);
    }
  });

  it("every column a definer function writes is guarded or reviewed as self-writable", () => {
    const guarded = new Set([
      ...guardedColumns(serverKept!.body),
      ...guardedColumns(selfPrivilege?.body ?? ""),
    ]);
    const writers: string[] = [];
    const unguarded: string[] = [];
    for (const fn of fns.values()) {
      if (!/security\s+definer/i.test(fn.header)) continue;
      for (const col of profileColumnsSet(fn.body)) {
        writers.push(`${fn.name}.${col}`);
        if (!guarded.has(col) && !(col in SELF_WRITABLE)) unguarded.push(`${fn.name} sets ${col} (${fn.file})`);
      }
    }
    // Non-vacuity: the scan must see the writers we know exist.
    expect(writers.length).toBeGreaterThanOrEqual(6);
    expect(writers.some((w) => w.endsWith(".forum_post_count"))).toBe(true);
    expect(writers.some((w) => w.endsWith(".power_user_at"))).toBe(true);
    expect(unguarded, `server-kept columns a member could forge:\n${unguarded.join("\n")}`).toEqual([]);
  });
});

describe("the Academy exam grades only the sitting it issued", () => {
  it("start records a sitting and caps sittings issued, not exams finished", () => {
    const body = fns.get("academy_start_exam")!.body;
    expect(body).toMatch(/insert\s+into\s+public\.academy_exam_sittings/i);
    expect(body).toMatch(/from\s+public\.academy_exam_sittings[\s\S]*?exam_cooldown_hours/i);
  });

  it("submit claims the sitting once and grades only its questions through the shuffle", () => {
    const body = fns.get("academy_submit_exam")!.body;
    expect(body).toMatch(/update\s+public\.academy_exam_sittings\s+set\s+submitted_at/i);
    expect(body).toMatch(/q\.id\s*=\s*any\(\s*s\.question_ids\s*\)/i);
    expect(body).toMatch(/s\.perms\s*->/i);
  });

  it("quick checks grade published lessons only", () => {
    const body = fns.get("academy_grade_answer")!.body;
    expect(body).toMatch(/status\s*=\s*'published'/i);
  });
});
