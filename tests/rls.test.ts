/**
 * RLS verification tests. Most critical safety guarantee in the platform —
 * users must NEVER read other users' profile addresses or campaign actions.
 *
 * Strategy: create two test users via service role, then use anon-key clients
 * authed as each user to verify they can only see their own data.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_DB = !!(URL && ANON && SERVICE);

const TEST_PASSWORD = "test-password-1234567890";

describe.skipIf(!HAS_DB)("RLS — profiles isolation", () => {
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });

  beforeAll(async () => {
    const stamp = Date.now();
    const emailA = `test-rls-a-${stamp}@example.com`;
    const emailB = `test-rls-b-${stamp}@example.com`;

    const { data: a, error: errA } = await admin.auth.admin.createUser({
      email: emailA,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (errA) throw errA;
    const { data: b, error: errB } = await admin.auth.admin.createUser({
      email: emailB,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (errB) throw errB;

    userA = { id: a.user!.id, email: emailA };
    userB = { id: b.user!.id, email: emailB };

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
  });

  afterAll(async () => {
    if (userA?.id) await admin.auth.admin.deleteUser(userA.id);
    if (userB?.id) await admin.auth.admin.deleteUser(userB.id);
  });

  it("anon client cannot read any profile", async () => {
    const anon = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { data } = await anon.from("profiles").select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("user A signed in cannot read user B's profile address", async () => {
    const clientA = createClient(URL!, ANON!, { auth: { persistSession: false } });
    await clientA.auth.signInWithPassword({ email: userA.email, password: TEST_PASSWORD });

    // Reading own profile should work
    const { data: own } = await clientA.from("profiles").select("street").eq("id", userA.id).single();
    expect(own?.street).toBe("1 Secret St");

    // Reading B's profile should yield no rows (RLS hides it)
    const { data: other } = await clientA.from("profiles").select("street").eq("id", userB.id);
    expect(other ?? []).toHaveLength(0);
  });

  it("user A cannot UPDATE user B's profile", async () => {
    const clientA = createClient(URL!, ANON!, { auth: { persistSession: false } });
    await clientA.auth.signInWithPassword({ email: userA.email, password: TEST_PASSWORD });

    const { error } = await clientA
      .from("profiles")
      .update({ full_name: "Hacked" })
      .eq("id", userB.id);

    // Either RLS rejects or the update affects 0 rows. Verify nothing changed.
    const { data: bAfter } = await admin.from("profiles").select("full_name").eq("id", userB.id).single();
    expect(bAfter?.full_name).toBe("User B");
    // error may be null if 0 rows matched — that's also OK for RLS
    void error;
  });
});
