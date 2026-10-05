#!/usr/bin/env node
/**
 * stage-announcement.mjs — put an announcement's site page into patch_notes as
 * a DRAFT, from the same content file the email uses.
 *
 * One source for both surfaces: scripts/announcements/<slug>.json carries the
 * email blocks AND `page_md`. The email's "See the full update" button opens
 * /whats-new/<slug>, and so does the in-app notification, so the two can never
 * disagree. Publishing stays a human step at /admin/whats-new.
 *
 *   node --env-file=.env.local scripts/stage-announcement.mjs scripts/announcements/2026-10-05-update.json
 *
 * Refuses to touch a row that is already published (a live slug is a permanent
 * link; AGENTS.md pitfall 8).
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const file = process.argv[2];
if (!file) { console.error("usage: stage-announcement.mjs <content.json>"); process.exit(2); }
const c = JSON.parse(fs.readFileSync(file, "utf8"));
for (const k of ["slug", "title", "page_md"]) if (!c[k]) { console.error(`content file is missing "${k}"`); process.exit(2); }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: existing } = await sb.from("patch_notes").select("id, status").eq("slug", c.slug).maybeSingle();
if (existing?.status === "published") { console.error(`✗ ${c.slug} is already published — edit it in /admin/whats-new instead`); process.exit(1); }

const row = { slug: c.slug, title: c.title, summary: c.preheader ?? null, body_md: c.page_md, published_on: c.slug.slice(0, 10), status: "draft", updated_at: new Date().toISOString() };
const { error } = existing
  ? await sb.from("patch_notes").update(row).eq("id", existing.id)
  : await sb.from("patch_notes").insert(row);
if (error) { console.error(`✗ ${error.message}`); process.exit(1); }
console.log(`✓ ${existing ? "updated" : "staged"} DRAFT /whats-new/${c.slug} — publish it at /admin/whats-new when the features are live`);
