/**
 * verify-stub-bills.mjs — a bill created from a news story must prove it is
 * about kratom before anyone sees it.
 *
 * Why (Paul, 2026-10-28): extract-bills-from-alerts.mjs turns a bill number it
 * finds in a news story into a public `bills` row titled "[ST] X — auto-
 * extracted from kratom-related coverage", relevance 'anti'. When the story
 * got the number wrong, members saw a real but unrelated bill presented as a
 * kratom ban: MI HB 5509 is a civil-rights bill, MN HF 4223 a housing bill,
 * KY HB 757 a tax bill. The AI summary and "For advocates" box were written
 * from the news snippet, so they claimed bans the bill text never contains.
 * Because all such rows shared one title, "Similar bills in other states"
 * matched them to each other at 83-88%.
 *
 * For each STATE-scope stub this script reads the bill's own text:
 *   - The text names kratom or an alkaloid: CONFIRMED. The stub title and
 *     news-snippet summary are replaced with the bill's own (LegiScan when
 *     linked, else the text's opening), and the AI summary, callout and
 *     embedding are cleared so the regular jobs rebuild them from real text.
 *   - The text never names them: UNRELATED. Hidden (active=false, neutral),
 *     with a note saying why.
 *   - No text yet: kept hidden while it waits. If it has no LegiScan id, one
 *     lookup by state + bill number attaches it, so fetch-bill-texts.mjs
 *     pulls the text on its next run and this script decides then.
 * Local ordinances have no LegiScan text and keep their own review path.
 *
 * Dry run by default; --apply writes. Writes scraper_runs telemetry.
 *   node --env-file=.env.local scripts/verify-stub-bills.mjs [--apply]
 */

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SOURCE = "verify_stub_bills";
const KEY = process.env.LEGISCAN_API_KEY?.trim();

export const STUB_MARK = "auto-extracted from kratom-related coverage";
export const KRATOM_TEXT = /\b(kratom|mitragyn\w*|hydroxymitragyn\w*|7-?OH\b|pseudoindoxyl|speciosa)/i;

/** "H.B. 332" and "HB332" are the same bill. */
export const normBill = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The enacting clause of a bill's text, as a readable title and summary:
 * "relating to ..." when the bill has one (the plain-language part), else the
 * "AN ACT ..." clause. All-caps text is put in sentence case.
 */
export function openingFromText(text) {
  const flat = String(text ?? "").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const m = flat.match(/\b(AN ACT|A BILL)\b[\s\S]{0,600}/i);
  const body = (m ? m[0] : flat.slice(0, 600)).replace(/\s\d{1,2}\s(?=[A-Z])/g, " ").trim();
  const relating = body.match(/\brelating to ([^;.]{8,160})/i);
  let title = relating ? `Relating to ${relating[1].trim()}` : body.split(/[.;:]\s/)[0].slice(0, 160);
  if (title === title.toUpperCase()) title = title.charAt(0) + title.slice(1).toLowerCase();
  return { title: title.replace(/,\s*$/, ""), summary: body.slice(0, 600) };
}

async function legiscan(params) {
  if (!KEY) return null;
  const r = await fetch(`https://api.legiscan.com/?key=${KEY}&${params}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.status === "OK" ? j : null;
}

async function findLegiscanBill(state, billNumber) {
  const j = await legiscan(`op=getSearch&state=${state}&bill=${encodeURIComponent(normBill(billNumber))}`);
  const hits = Object.entries(j?.searchresult ?? {})
    .filter(([k, v]) => k !== "summary" && v && normBill(v.bill_number) === normBill(billNumber))
    .map(([, v]) => v)
    .sort((a, b) => String(b.last_action_date).localeCompare(String(a.last_action_date)));
  return hits[0] ?? null;
}

function textOf(versions) {
  return (Array.isArray(versions) ? versions : []).map((v) => v?.text ?? "").join("\n");
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const t0 = new Date();
  const today = t0.toISOString().slice(0, 10);
  const { data: stubs, error } = await sb
    .from("bills")
    .select("id, state, bill_number, title, active, legiscan_bill_id, bill_text_versions, verification_status")
    .eq("scope", "state")
    .ilike("title", `%${STUB_MARK}%`)
    .limit(500);
  if (error) throw new Error(error.message);

  const tally = { confirmed: 0, unrelated: 0, waiting: 0, linked: 0 };
  for (const b of stubs ?? []) {
    const text = textOf(b.bill_text_versions);
    let patch;
    if (text.length > 200 && KRATOM_TEXT.test(text)) {
      const ls = b.legiscan_bill_id ? (await legiscan(`op=getBill&id=${b.legiscan_bill_id}`))?.bill : null;
      const own = openingFromText(text);
      patch = {
        title: ls?.title || own.title || `${b.state} ${b.bill_number}`,
        summary: ls?.description || own.summary,
        active: true,
        summary_ai: null, advocacy_callout: null, enriched_at: null,
        embedding: null, embedded_at: null,
        verification_status: "single_source",
        verification_note: `Found in a news story; the bill's own text confirms kratom provisions (checked ${today}).`,
      };
      tally.confirmed++;
    } else if (text.length > 200) {
      patch = {
        active: false, kratom_relevance: "neutral",
        summary_ai: null, advocacy_callout: null, embedding: null, embedded_at: null,
        verification_status: "unverified",
        verification_note: `The number came from a news story, but this bill's own text never mentions kratom or its alkaloids. Hidden ${today}.`,
      };
      tally.unrelated++;
    } else {
      patch = {
        active: false, advocacy_callout: null,
        verification_status: "unverified",
        verification_note: `Found in a news story; hidden until the bill's text confirms it is about kratom (checked ${today}).`,
      };
      if (!b.legiscan_bill_id) {
        const hit = await findLegiscanBill(b.state, b.bill_number);
        if (hit?.bill_id) { patch.legiscan_bill_id = hit.bill_id; tally.linked++; }
      }
      tally.waiting++;
    }
    const verdict = patch.active ? "CONFIRMED" : patch.kratom_relevance === "neutral" ? "UNRELATED" : "WAITING";
    console.log(`${verdict.padEnd(9)} ${b.state} ${b.bill_number}${patch.title ? ` → "${patch.title.slice(0, 80)}"` : ""}${patch.legiscan_bill_id ? ` (LegiScan ${patch.legiscan_bill_id})` : ""}`);
    if (APPLY) {
      const { error: upErr } = await sb.from("bills").update(patch).eq("id", b.id);
      if (upErr) console.error(`  update failed: ${upErr.message}`);
    }
  }

  const notes = `${stubs?.length ?? 0} stubs · ${tally.confirmed} confirmed · ${tally.unrelated} hidden as unrelated · ${tally.waiting} waiting for text (${tally.linked} linked to LegiScan)`;
  console.log(`\n${APPLY ? "" : "DRY RUN · "}${notes}`);
  if (APPLY) {
    await sb.from("scraper_runs").insert({
      source: SOURCE, started_at: t0.toISOString(), finished_at: new Date().toISOString(),
      status: (stubs?.length ?? 0) > 0 ? "success" : "empty", rows_updated: stubs?.length ?? 0, notes,
    });
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/verify-stub-bills.mjs")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
