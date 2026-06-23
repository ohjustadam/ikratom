// One-time backfill: encrypt existing PLAINTEXT refresh tokens in
// email_integrations at rest (pen-test oauth-02). Idempotent — skips rows
// already encrypted ("v1:" prefix) or blanked (""). Dry-run by default;
// pass --apply to write.
//
// CRYPTO MUST MATCH src/lib/token-crypto.ts exactly (HKDF-SHA256 from CRON_SECRET,
// info "ikratom-oauth-token-v1", AES-256-GCM, format "v1:"+b64(iv|tag|ct)) so the
// prod app can decrypt what this writes. The local CRON_SECRET equals Vercel's
// (the GHA/Vercel cron auth proves it), so prod decryption will succeed.
//
//   node --env-file=.env.local scripts/backfill-encrypt-email-tokens.mjs           # dry-run
//   node --env-file=.env.local scripts/backfill-encrypt-email-tokens.mjs --apply   # write
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "crypto";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PREFIX = "v1:";
const KEY = Buffer.from(hkdfSync("sha256", Buffer.from(process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "", "utf8"), Buffer.alloc(0), Buffer.from("ikratom-oauth-token-v1"), 32));

function enc(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function dec(stored) {
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", KEY, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

const { data, error } = await sb.from("email_integrations").select("user_id, provider, refresh_token");
if (error) { console.error("query failed:", error.message); process.exit(1); }
console.log(`${data.length} integration rows total.`);

let toEncrypt = 0, already = 0, blank = 0, done = 0, failed = 0;
for (const r of data) {
  const t = r.refresh_token;
  if (!t) { blank++; continue; }
  if (t.startsWith(PREFIX)) { already++; continue; }
  toEncrypt++;
  if (!APPLY) continue;
  const ciphertext = enc(t);
  // SAFETY: verify round-trip before writing — never persist an undecryptable token.
  if (dec(ciphertext) !== t) { console.error(`  round-trip FAILED for ${r.user_id} (${r.provider}); skipping`); failed++; continue; }
  const { error: upErr } = await sb.from("email_integrations").update({ refresh_token: ciphertext }).eq("user_id", r.user_id);
  if (upErr) { console.error(`  update failed ${r.user_id}:`, upErr.message); failed++; } else { done++; }
}

console.log(`\nplaintext needing encryption: ${toEncrypt} | already encrypted: ${already} | blank: ${blank}`);
if (APPLY) console.log(`encrypted+written: ${done} | failed: ${failed}`);
else console.log(`(dry-run — re-run with --apply to write)`);
