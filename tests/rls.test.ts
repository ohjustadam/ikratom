/**
 * RLS verification tests. Most critical safety guarantee in the platform —
 * users must NEVER read other users' profile addresses or campaign actions.
 *
 * Strategy: create two test users via service role, then use anon-key clients
 * authed as each user to verify they can only see their own data.
 *
 * It creates REAL auth users, so it is opt-in: set RLS_TEST_DB=1 and point the
 * env at a throwaway project. `.env.local` points at production, and every
 * run against it that died before cleanup left "User A / User B, Sandbox, OK"
 * in /admin/users: 10 of them from 7 runs by 2026-11-26. Production sign-in
 * also needs a CAPTCHA token since 2026-11-25, so the sign-in step fails
 * there anyway. Use scripts/rls-pentest.mjs (rolled back) against production.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_DB = !!(URL && ANON && SERVICE) && process.env.RLS_TEST_DB === "1";

const TEST_PASSWORD = "test-password-1234567890";
const TEST_EMAIL = /^test-rls-[ab]-(\d+)@example\.com$/;
const HOUR = 3_600_000;

/** Delete users a crashed earlier run left behind (older than an hour, so a parallel run keeps its pair). */
async function sweepLeftovers(admin: SupabaseClient) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      const stamp = Number(TEST_EMAIL.exec(u.email ?? "")?.[1]);
      if (stamp && Date.now() - stamp > HOUR) await admin.auth.admin.deleteUser(u.id);
    }
    if (data.users.length < 200) break;
  }
}

async function signIn(email: string) {
  const client = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  // Without this, a failed sign-in makes the "cannot update" test pass vacuously.
  if (error) throw new Error(`test sign-in failed: ${error.message}`);
  return client;
}

describe.skipIf(!HAS_DB)("RLS — profiles isolation", () => {
  let userA: { id: string; email: string } | undefined;
  let userB: { id: string; email: string } | undefined;
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });

  beforeAll(async () => {
    await sweepLeftovers(admin);
    const stamp = Date.now();
    const create = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
      if (error) throw error;
      return { id: data.user!.id, email };
    };
    // Assigned one at a time, so a failure creating B still cleans up A.
    userA = await create(`test-rls-a-${stamp}@example.com`);
    userB = await create(`test-rls-b-${stamp}@example.com`);

    // Each user updates their own profile with sensitive data
    await admin.from("profiles").update({
      full_name: "User A",
      street: "1 Secret St",
      city: "Sandbox",
      state: "OK",
    }).eq("id", userA.id);
    await admin.from("profiles").update({
      full_name: "User B",
      street: "2 Private Ave",
      city: "Sandbox",
      state: "OK",
    }).eq("id", userB.id);
  }, 60_000);

  afterAll(async () => {
    const left: string[] = [];
    for (const u of [userA, userB]) {
      if (!u) continue;
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) left.push(`${u.email}: ${error.message}`);
    }
    if (left.length) throw new Error(`RLS test users left behind: ${left.join("; ")}`);
  }, 60_000);

  it("anon client cannot read any profile", async () => {
    const anon = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { data } = await anon.from("profiles").select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("user A signed in cannot read user B's profile address", async () => {
    const clientA = await signIn(userA!.email);

    // Reading own profile should work
    const { data: own } = await clientA.from("profiles").select("street").eq("id", userA!.id).single();
    expect(own?.street).toBe("1 Secret St");

    // Reading B's profile should yield no rows (RLS hides it)
    const { data: other } = await clientA.from("profiles").select("street").eq("id", userB!.id);
    expect(other ?? []).toHaveLength(0);
  });

  it("user A cannot UPDATE user B's profile", async () => {
    const clientA = await signIn(userA!.email);

    const { error } = await clientA
      .from("profiles")
      .update({ full_name: "Hacked" })
      .eq("id", userB!.id);

    // Either RLS rejects or the update affects 0 rows. Verify nothing changed.
    const { data: bAfter } = await admin.from("profiles").select("full_name").eq("id", userB!.id).single();
    expect(bAfter?.full_name).toBe("User B");
    // error may be null if 0 rows matched — that's also OK for RLS
    void error;
  });
});
