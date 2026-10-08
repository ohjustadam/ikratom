#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log("=== Searching policy_alerts for Marshall ===");
const { data: alerts } = await sb.from("policy_alerts").select("id, kind, title, locality, created_at").ilike("title", "%marshall%");
console.log(alerts ?? []);

console.log("\n=== Searching bills for Marshall ===");
const { data: bills } = await sb.from("bills").select("id, state, bill_number, title, locality, scope").or("title.ilike.%marshall%,locality.ilike.%marshall%").limit(10);
console.log(bills ?? []);

console.log("\n=== Searching news for Marshall kratom ===");
const { data: news } = await sb.from("news").select("id, title, source_name, published_at, url").ilike("title", "%marshall%").ilike("title", "%kratom%").limit(10);
console.log(news ?? []);

console.log("\n=== Any IL kratom news at all in last 30 days ===");
const { data: ilnews } = await sb.from("news").select("id, title, source_name, published_at").ilike("title", "%kratom%").gte("published_at", new Date(Date.now() - 30 * 86400000).toISOString()).limit(20);
console.log(ilnews ?? []);
