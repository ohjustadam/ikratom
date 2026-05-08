#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log("=== news count by state ===");
const { data: byState } = await sb.rpc("execute_sql", {}).select(); // RPC may not exist; fallback
const { data: all } = await sb.from("news").select("state").limit(5000);
const counts = {};
for (const n of all ?? []) counts[n.state ?? "(null)"] = (counts[n.state ?? "(null)"] ?? 0) + 1;
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]));

console.log("\n=== latest news rows (any state) ===");
const { data: latest } = await sb.from("news").select("title, source_name, state, published_at, created_at").order("created_at", { ascending: false }).limit(10);
for (const n of latest ?? []) console.log(`  [${n.state ?? "?"}] ${n.published_at?.slice(0,10) ?? "?"}  ${n.source_name ?? "?"} — ${n.title?.slice(0, 80)}`);

console.log("\n=== news rows mentioning ban or ordinance in last 30d ===");
const { data: bans } = await sb.from("news").select("title, source_name, state, published_at, url")
  .or("title.ilike.%ban%,title.ilike.%ordinance%")
  .ilike("title", "%kratom%")
  .order("published_at", { ascending: false })
  .limit(20);
for (const n of bans ?? []) console.log(`  [${n.state ?? "?"}] ${n.published_at?.slice(0,10) ?? "?"}  ${n.title}\n    ${n.url}`);

console.log("\n=== max created_at (last sync time) ===");
const { data: latestRow } = await sb.from("news").select("created_at").order("created_at", { ascending: false }).limit(1);
console.log(latestRow?.[0]?.created_at);
