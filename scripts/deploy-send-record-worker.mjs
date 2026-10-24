#!/usr/bin/env node
// Deploy the send-record Email Worker (B9, migration 0276) and point the
// ikratom.org catch-all rule at it.
//
//   node --env-file=.env.local scripts/deploy-send-record-worker.mjs            # deploy
//   node --env-file=.env.local scripts/deploy-send-record-worker.mjs --dry-run  # show the plan
//   node --env-file=.env.local scripts/deploy-send-record-worker.mjs --rollback # catch-all back to "drop"
//
// Every run mints a fresh ingest key: its SHA-256 goes into
// internal.ingest_keys (Management API), the key itself into the Worker as a
// secret binding. Nothing to store or copy, so re-running is the rotation.
//
// Needs: CLOUDFLARE_EMAIL_TOKEN (Workers Scripts + Email Routing Rules edit),
// CLOUDFLARE_ACCOUNT_ID, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_ACCESS_TOKEN (+ SUPABASE_PROJECT_REF, or derived from the URL).

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "ikratom-send-record";
const ZONE_NAME = "ikratom.org";
const CF = "https://api.cloudflare.com/client/v4";
const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};

async function cf(path, init = {}) {
  const res = await fetch(`${CF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env("CLOUDFLARE_EMAIL_TOKEN")}`, ...(init.headers || {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!j.success) throw new Error(`${init.method || "GET"} ${path}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  return j.result;
}

async function sql(query) {
  const supaUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const ref = process.env.SUPABASE_PROJECT_REF || new URL(supaUrl).hostname.split(".")[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`sql ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function zoneId() {
  const zones = await cf(`/zones?name=${ZONE_NAME}`);
  if (!zones?.[0]?.id) throw new Error(`zone ${ZONE_NAME} not visible to this token`);
  return zones[0].id;
}

async function setCatchAll(zone, actions, name) {
  return cf(`/zones/${zone}/email/routing/rules/catch_all`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, enabled: true, matchers: [{ type: "all" }], actions }),
  });
}

async function main() {
  const zone = await zoneId();
  const before = await cf(`/zones/${zone}/email/routing/rules/catch_all`);
  console.log("catch-all now:", JSON.stringify(before.actions));

  if (args.has("--rollback")) {
    if (DRY) return console.log("[dry-run] would set catch-all → drop");
    await setCatchAll(zone, [{ type: "drop" }], "catch-all → drop");
    return console.log("catch-all → drop (the Worker stays deployed but receives nothing)");
  }

  const key = randomBytes(32).toString("base64url");
  const keyHash = createHash("sha256").update(key, "utf8").digest("hex");
  if (DRY) {
    console.log(`[dry-run] would upload ${SCRIPT_NAME}, rotate internal.ingest_keys('send_record'), set catch-all → worker`);
    return;
  }

  // 1. Key hash first: until the Worker below is live, the old Worker (if any)
  //    gets "forbidden" for a few seconds, and nothing is stored meanwhile.
  await sql(
    `insert into internal.ingest_keys (name, key_sha256, rotated_at) values ('send_record', '${keyHash}', now())
     on conflict (name) do update set key_sha256 = excluded.key_sha256, rotated_at = now();`,
  );
  console.log("ingest key rotated (hash stored)");

  // 2. The Worker: two ES modules, bindings in the metadata.
  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          main_module: "worker.js",
          compatibility_date: "2026-10-01",
          bindings: [
            { type: "plain_text", name: "SUPABASE_URL", text: env("NEXT_PUBLIC_SUPABASE_URL") },
            { type: "plain_text", name: "SUPABASE_ANON_KEY", text: env("NEXT_PUBLIC_SUPABASE_ANON_KEY") },
            { type: "secret_text", name: "INGEST_KEY", text: key },
          ],
        }),
      ],
      { type: "application/json" },
    ),
  );
  const mod = (file) => new Blob([readFileSync(file, "utf8")], { type: "application/javascript+module" });
  form.append("worker.js", mod(join(here, "cloudflare", "send-record-worker.js")), "worker.js");
  form.append("mime-text.mjs", mod(join(here, "lib", "mime-text.mjs")), "mime-text.mjs");
  await cf(`/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/workers/scripts/${SCRIPT_NAME}`, { method: "PUT", body: form });
  console.log(`worker ${SCRIPT_NAME} uploaded`);

  // 3. Route the catch-all to it. Literal rules (hello@, info@, support@) still
  //    match first; everything else used to be dropped, and the Worker drops it too.
  await setCatchAll(zone, [{ type: "worker", value: [SCRIPT_NAME] }], `catch-all → ${SCRIPT_NAME} (drops all but r-<nonce>)`);
  console.log("catch-all → worker. Done.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
