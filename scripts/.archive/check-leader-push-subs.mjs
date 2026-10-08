#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: leaders } = await supabase
  .from("profiles")
  .select("id, full_name")
  .eq("is_advocate_leader", true);
const ids = (leaders ?? []).map((l) => l.id);
const { data: subs } = await supabase
  .from("push_subscriptions")
  .select("id, user_id, created_at")
  .in("user_id", ids);
console.log(`Leaders: ${leaders?.length}, with push subs: ${new Set((subs ?? []).map((s) => s.user_id)).size}`);
const subsByUser = new Map();
for (const s of subs ?? []) {
  subsByUser.set(s.user_id, (subsByUser.get(s.user_id) ?? 0) + 1);
}
for (const l of leaders ?? []) {
  const n = subsByUser.get(l.id) ?? 0;
  console.log(`  ${l.id} ${l.full_name ?? "(no name)"} — ${n} subscription(s)`);
}
