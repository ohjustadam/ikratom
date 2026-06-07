#!/usr/bin/env node
/**
 * render-daily-brief-audio.mjs — Phase 2 audio brief.
 *
 * Renders today's national kratom-policy brief as an MP3 using
 * Microsoft Edge TTS (free public endpoint, no API key, neural voice).
 * Uploads the file to a public Supabase Storage bucket so /brief can
 * play it via a standard <audio> element.
 *
 * The browser-native SpeechSynthesis Listen button on /brief stays as
 * the fallback when no MP3 exists for the current day. Voice quality
 * was the gating issue — owner's Windows install didn't have neural
 * voices, so the browser-native TTS sounded robotic. Edge TTS uses
 * MS's cloud neural voices regardless of client OS.
 *
 * Storage:
 *   bucket: daily-brief-audio (public-read)
 *   path:   {YYYY-MM-DD}/national.mp3
 *
 * Voice:   en-US-ChristopherNeural  (warm male, NPR-ish timbre)
 * Quality: 24kHz / 48kbps / mono MP3 — ~360KB per minute, plenty for
 *          a 1-2 min brief. Stays well under Supabase free-tier
 *          Storage 1GB cap even with 30-day retention.
 *
 * Usage:
 *   node --env-file=.env.local scripts/render-daily-brief-audio.mjs
 *   node --env-file=.env.local scripts/render-daily-brief-audio.mjs --voice en-US-AriaNeural
 *   node --env-file=.env.local scripts/render-daily-brief-audio.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { Buffer } from "node:buffer";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const voiceIdx = args.indexOf("--voice");
const VOICE = voiceIdx >= 0 ? args[voiceIdx + 1] : "en-US-ChristopherNeural";
// --if-missing: render only when today's file is absent. Lets the hourly cron
// self-heal a skipped daily run (GitHub schedules are best-effort) cheaply.
const IF_MISSING = args.includes("--if-missing");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const BUCKET = "daily-brief-audio";
const today = new Date().toISOString().slice(0, 10);
const OBJECT_PATH = `${today}/national.mp3`;

const t0 = Date.now();
console.log(`Render-daily-brief-audio${DRY ? " [DRY]" : ""}${IF_MISSING ? " [if-missing]" : ""} — date=${today} voice=${VOICE}`);

// Self-heal guard: when --if-missing, skip if today's audio already exists.
if (IF_MISSING && !DRY) {
  try {
    const { data: existing } = await sb.storage.from(BUCKET).list(today, { search: "national.mp3" });
    if ((existing ?? []).some((f) => f.name === "national.mp3")) {
      console.log(`  ${OBJECT_PATH} already exists — skipping.`);
      await tag("empty", 0);
      process.exit(0);
    }
    console.log(`  ${OBJECT_PATH} missing — rendering now.`);
  } catch (e) {
    console.warn(`  if-missing check failed (${e.message?.slice(0, 60)}) — rendering anyway.`);
  }
}

// Locality/state fields hold 2-letter postal codes ("OK") — TTS reads those as
// letters ("oh-kay"); expand to the full state name for natural speech.
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "Washington D C", FED: "the federal level", ALL: "the national level",
};
function expandLocality(loc) {
  if (!loc) return loc;
  return STATE_NAMES[String(loc).trim().toUpperCase()] ?? loc;
}

// ── 1. Build the briefing script (national scope) ───────────────────
function isoDaysAgo(n) { return new Date(Date.now() - n * 86400 * 1000).toISOString(); }
const cutoff7 = isoDaysAgo(7);
const cutoff36h = isoDaysAgo(1.5).slice(0, 10);

const { data: critAlerts } = await sb.from("policy_alerts")
  .select("title, locality")
  .eq("severity", "critical")
  .eq("moderation_status", "approved")
  .gte("created_at", cutoff7)
  .order("created_at", { ascending: false })
  .limit(3);

const { data: warnAlerts } = await sb.from("policy_alerts")
  .select("title, locality")
  .eq("severity", "alert")
  .eq("moderation_status", "approved")
  .gte("created_at", cutoff7)
  .order("created_at", { ascending: false })
  .limit(5);

const { data: news } = await sb.from("news_items")
  .select("title, state")
  .gte("published_at", cutoff36h)
  .not("policy_classified_at", "is", null)
  .is("duplicate_of", null)
  .eq("active", true)
  .order("published_at", { ascending: false })
  .limit(6);

const dateLong = new Date().toLocaleDateString("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
});

const parts = [];
parts.push(`Welcome to the iKratom daily brief for ${dateLong}. I'm your kratom-policy correspondent.`);

const cn = (critAlerts ?? []).length;
const wn = (warnAlerts ?? []).length;
if (cn === 0 && wn === 0) {
  parts.push("It's a quiet day on the policy front. No new critical alerts and no warning-level events in the last week.");
} else {
  if (cn > 0) {
    parts.push(`Top of the brief: ${cn} critical alert${cn === 1 ? "" : "s"} this week.`);
    for (const a of critAlerts) parts.push(`From ${expandLocality(a.locality) || "the federal level"}: ${cleanForTTS(a.title)}.`);
  }
  if (wn > 0) {
    parts.push(`Also tracking ${wn} warning-level event${wn === 1 ? "" : "s"}.`);
    for (const a of warnAlerts.slice(0, 3)) parts.push(`${expandLocality(a.locality) || "Federal"}: ${cleanForTTS(a.title)}.`);
  }
}

const newsArr = (news ?? []).filter((n) => n.title);
if (newsArr.length > 0) {
  parts.push(`In headlines from the last day and a half:`);
  for (const n of newsArr.slice(0, 5)) {
    parts.push(`${n.state ? `From ${expandLocality(n.state)}` : "Federal"}: ${cleanForTTS(n.title)}.`);
  }
}

parts.push("That's your iKratom daily brief. Visit ikratom dot org slash brief for the full picture, linked legislation, and one-click actions. Stay engaged.");
const script = parts.join(" ");

console.log(`  script: ${script.length} chars, ~${Math.round(script.length / 15)}s estimated audio`);

function cleanForTTS(s) {
  // Replace em/en dashes with regular hyphens; expand common abbreviations
  // so TTS pronounces them naturally.
  return (s ?? "")
    .replace(/[—–]/g, " - ")
    .replace(/\bDEA\b/g, "D E A")
    .replace(/\bFDA\b/g, "F D A")
    .replace(/\bAG\b/g, "Attorney General")
    .replace(/\bBoP\b/g, "Board of Pharmacy")
    .replace(/\b7-OH\b/gi, "seven-hydroxy")
    .replace(/\b7-hydroxymitragynine\b/gi, "seven-hydroxy mitragynine")
    .replace(/\s+/g, " ")
    .trim();
}

if (DRY) {
  console.log("\n=== SCRIPT (dry) ===\n" + script + "\n");
  await tag("empty", 0);
  process.exit(0);
}

// ── 2. Render via Edge TTS ───────────────────────────────────────────
console.log("  rendering via Edge TTS…");
const tts = new MsEdgeTTS();
await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
const { audioStream } = tts.toStream(script);

const chunks = [];
await new Promise((resolve, reject) => {
  audioStream.on("data", (c) => chunks.push(c));
  audioStream.on("end", resolve);
  audioStream.on("close", resolve);
  audioStream.on("error", reject);
  setTimeout(() => reject(new Error("TTS timeout (60s)")), 60_000);
});
const mp3 = Buffer.concat(chunks);
console.log(`  rendered ${(mp3.length / 1024).toFixed(1)} KB`);

// ── 3. Ensure bucket exists ─────────────────────────────────────────
try {
  const { data: buckets } = await sb.storage.listBuckets();
  if (!(buckets ?? []).some((b) => b.name === BUCKET)) {
    await sb.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 1024 * 1024 * 5, // 5MB cap — plenty for a 2-3 min brief
    });
    console.log(`  bucket "${BUCKET}" created (public)`);
  }
} catch (e) {
  console.warn(`  bucket setup: ${e.message?.slice(0, 80) ?? e}`);
}

// ── 4. Upload ────────────────────────────────────────────────────────
const { error: uploadErr } = await sb.storage.from(BUCKET).upload(
  OBJECT_PATH,
  mp3,
  { contentType: "audio/mpeg", upsert: true, cacheControl: "3600" },
);
if (uploadErr) {
  console.error(`upload failed: ${uploadErr.message}`);
  await tag("fail", 0);
  process.exit(1);
}
const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(OBJECT_PATH);
console.log(`  uploaded → ${pub.publicUrl}`);

// ── 5. Telemetry ────────────────────────────────────────────────────
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s.`);
await tag("success", mp3.length);

async function tag(status, bytes) {
  try {
    await sb.from("scraper_runs").insert({
      source: "render_daily_brief_audio",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_updated: bytes,
      notes: `voice=${VOICE} date=${today} bytes=${bytes}`,
    });
  } catch { /* best-effort */ }
}
