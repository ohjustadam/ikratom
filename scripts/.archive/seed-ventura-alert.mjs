#!/usr/bin/env node
/**
 * One-shot insert of the May 12, 2026 City of San Buenaventura
 * (Ventura, CA) city council kratom-ban ordinance hearing as a
 * policy_alert.
 *
 * This is the first real-world test of the alert pipeline. Source
 * was an advocate Facebook-group post relayed via owner. Future
 * intel of this kind will flow through /alerts/submit (Phase 3 of
 * the newsroom roadmap).
 *
 * The ordinance proposes to repeal Chapter 8.420 of the San
 * Buenaventura Municipal Code and replace it with a "Prohibition on
 * Sale of Kratom" — a complete city-wide retail ban (no carve-outs
 * for natural leaf vs synthetic in the agenda language we have).
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Idempotent — won't double-insert if already there.
const { data: existing } = await sb
  .from("policy_alerts")
  .select("id")
  .eq("kind", "bill_event")
  .eq("locality", "CA")
  .ilike("title", "%San Buenaventura%kratom%")
  .limit(1);

if (existing && existing.length > 0) {
  console.log("Alert already exists:", existing[0].id);
  process.exit(0);
}

const body = `**WHAT:** Introduction and first reading of an ordinance to repeal Chapter 8.420 of the San Buenaventura Municipal Code and replace it with a complete city-wide ban on kratom sales.

**WHEN:** Monday May 12, 2026 at 5:00 pm PST (Closed Session/Regular Meeting)

**WHERE:** San Buenaventura (Ventura), California — City Council
- In person: City Hall
- Live broadcast: Cable TV Channel 15, https://www.cityofventura.ca.gov/718/Videos, or YouTube https://www.YouTube.com/cityofventura/live
- Remote (Zoom): https://us02web.zoom.us/j/84095569075 — Meeting ID 840 9556 9075
- Phone: 1-669-900-6833 or 1-833-568-8864 (toll free), enter Meeting ID

**HOW TO COMMENT:**
- During the meeting via Zoom: press *9 (raise hand), wait for City Clerk
- Written comment by 3:00 pm PST on May 12: email cityclerk@cityofventura.ca.gov (up to 1,000 characters), include the Agenda Item Number in the subject
- Public comment form: https://www.cityofventura.ca.gov/publicinput

**AGENDA TEXT:** "Introduce and waive the first reading of an Ordinance repealing Chapter 8.420, 'Reserved,' of the San Buenaventura Municipal Code, and replacing it in its entirety with Chapter 8.420, 'Prohibition on Sale of Kratom,' in order to ban sales of Kratom within the City."

**WHAT MAKES THIS DIFFERENT FROM A STATE BILL:** This is a city-level ordinance — far less reported, far less covered by legislative trackers. The May 12 vote is a "first reading" — if introduced and waived, it advances. Local ordinances often pass with single-digit attendance and minimal public comment, which is why solidarity attendance and written comments matter disproportionately here.

**ADVOCATE ACTION:**
1. Attend the meeting (in person, Zoom, or call-in)
2. Submit a written public comment by 3pm May 12 to cityclerk@cityofventura.ca.gov
3. Phone the meeting and use *9 during public comment
4. Spread the word to anyone in Ventura County

**Source:** advocate intel via private Facebook group; corroborated by City of Ventura agenda PDF.`;

const { data, error } = await sb
  .from("policy_alerts")
  .insert({
    kind: "bill_event",
    severity: "critical",
    title: "San Buenaventura, CA — city council vote to BAN kratom sales (May 12)",
    body,
    locality: "CA",
    source_url: "https://www.cityofventura.ca.gov/AgendaCenter/ViewFile/Agenda/_05122026-3631",
    action_required: true,
    occurs_at: "2026-05-12T17:00:00-07:00", // 5pm PST = 12am UTC May 13
    expires_at: "2026-05-13T08:00:00-07:00", // morning after the vote
    moderation_status: "approved",
    is_anonymous: false,
  })
  .select("id")
  .single();

if (error) {
  console.error("Insert failed:", error.message);
  process.exit(1);
}
console.log("✓ Inserted policy_alert:", data.id);
console.log("  When prod /pulse ships (Phase 1), this alert renders at the top under 'Today's Breaking'.");
