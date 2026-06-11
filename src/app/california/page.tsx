import { redirect } from "next/navigation";

// TEMPORARY redirect — the curated /california war-room was pulled 2026-06-11
// because it asserted unverified facts (a fabricated "June 17 Senate Health
// Committee hearing / 2% cap" for AB 1088, which was actually WITHDRAWN from
// committee 2026-06-09 per Digital Democracy). The page will be rebuilt ONLY
// on verified, freshly-synced bill data. Until then, send to the data hub,
// which shows real (if stale) records without fabricated action items.
export default function CaliforniaPage() {
  redirect("/states/CA");
}
