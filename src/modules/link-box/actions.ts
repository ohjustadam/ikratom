"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { decideLink, isOwnSite } from "@/lib/link-box";
import { billDisplayStatus } from "@/lib/bill-status";
import { liveCampaignsFor, type LiveCampaign } from "@/modules/news/story-campaigns";
import { inspectLink } from "./inspect";
import { findBillFor, findExisting, type FullBill } from "./lookup";
import { readLink } from "./classify";
import { addNewLink } from "./create";

/**
 * The smart link box (owner ask 2026-11-25): a member pastes or shares a
 * link, and the site says either "we already have this, here it is" or
 * "thanks, it's new, we're adding it". Builds on #1194 (the share target and
 * the tip form's "We already have this story").
 *
 * checkLink only looks. shareLink looks again (never trusting the client) and
 * adds the link only when nothing matched. Signed-in members only; every
 * write is the member's own tip under RLS, plus at most one held campaign
 * draft (see create.ts). Limits: 30 looks an hour per member and 60 a day per
 * network, because each look fetches an outside page; 6 new links an hour
 * and 20 a day per member.
 */
type BillCard = { id: string; label: string; status: string | null };
export type LinkBoxResult =
  | { status: "invalid" | "signin" | "busy" | "error"; message: string }
  | { status: "existing"; what: "story"; story: { id: string; title: string; source: string | null }; campaigns: LiveCampaign[] }
  | { status: "existing"; what: "alert"; alert: { id: string; title: string }; campaigns: LiveCampaign[] }
  | { status: "existing"; what: "pending" }
  | { status: "existing"; what: "seen" }
  | { status: "existing"; what: "bill"; bill: BillCard; campaigns: LiveCampaign[] }
  | { status: "existing"; what: "ours"; path: string }
  | { status: "new"; bill: BillCard | null; campaigns: LiveCampaign[] }
  | { status: "not_kratom" }
  | { status: "added"; bill: BillCard | null; campaigns: LiveCampaign[]; draft: boolean };

const INVALID = "That doesn't look like a web link. Copy the link from the address bar and paste it here.";
const BUSY = "You've shared a lot today. Thank you! Please try again a little later.";

const card = (b: FullBill): BillCard => ({ id: b.id, label: `${b.state} ${b.bill_number}`, status: billDisplayStatus(b) });

async function look(raw: string, mode: "check" | "share"): Promise<LinkBoxResult> {
  const input = String(raw ?? "").slice(0, 2000).trim();
  if (!/https?:\/\/\S+\.\S+/i.test(input)) return { status: "invalid", message: INVALID };

  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { status: "signin", message: "Sign in to share a link. It's free." };

  if (!(await checkRateLimit(`link-box:look:user:${user.id}`, 30, 3_600))) return { status: "busy", message: BUSY };
  if (!(await checkRateLimit(`link-box:look:ip:${await getClientIp()}`, 60, 86_400))) return { status: "busy", message: BUSY };

  const ownUrl = input.match(/https?:\/\/\S+/i)?.[0] ?? "";
  if (isOwnSite(ownUrl)) {
    try { return { status: "existing", what: "ours", path: new URL(ownUrl).pathname.slice(0, 300) || "/" }; } catch { /* fall through */ }
  }

  const ins = await inspectLink(input);
  if (!ins) return { status: "invalid", message: INVALID };

  const sb = createServiceRoleClient();
  const verdict = decideLink(await findExisting(sb, ins));
  if (verdict.kind === "story") {
    const s = verdict.story;
    return { status: "existing", what: "story", story: { id: s.id, title: s.title, source: s.source_name },
      campaigns: await liveCampaignsFor(sb, { billId: s.bill_id, state: s.state }) };
  }
  if (verdict.kind === "alert") {
    const a = verdict.alert;
    if (a.moderation_status !== "approved") return { status: "existing", what: "pending" };
    return { status: "existing", what: "alert", alert: { id: a.id, title: a.title },
      campaigns: await liveCampaignsFor(sb, { billId: a.bill_id, state: a.locality }) };
  }
  if (verdict.kind === "seen") return { status: "existing", what: "seen" };
  if (verdict.kind === "bill") {
    const b = verdict.bill as FullBill;
    return { status: "existing", what: "bill", bill: card(b), campaigns: await liveCampaignsFor(sb, { billId: b.id, state: b.state }) };
  }

  // Nothing matched: the link is new.
  const { data: profile } = await userClient.from("profiles").select("username, state").eq("id", user.id).maybeSingle();
  const p = (profile ?? { username: null, state: null }) as { username: string | null; state: string | null };

  if (mode === "check") {
    const bill = await findBillFor(sb, ins);
    return { status: "new", bill: bill ? card(bill) : null, campaigns: bill ? await liveCampaignsFor(sb, { billId: bill.id }) : [] };
  }

  const ro = await assertNotReadOnly();
  if (ro) return { status: "error", message: ro };
  const reading = await readLink({ url: ins.publisherUrl, ...ins.meta });
  // Only turn a link away when we could read the page and it isn't about kratom.
  if (!reading.kratom && ins.meta.title) return { status: "not_kratom" };

  if (!(await checkRateLimit(`link-box:new:user:${user.id}`, 6, 3_600))) return { status: "busy", message: BUSY };
  if (!(await checkRateLimit(`link-box:new:day:${user.id}`, 20, 86_400))) return { status: "busy", message: BUSY };

  const bill = await findBillFor(sb, ins, reading.locality);
  const r = await addNewLink({ userClient, userId: user.id, profile: p, ins, reading, bill });
  if (!r.ok) return { status: "error", message: r.error };

  revalidatePath("/admin/intel-queue");
  if (r.added.draft) revalidatePath("/admin/campaigns/pending");
  return { status: "added", bill: bill ? card(bill) : null, draft: r.added.draft,
    campaigns: bill ? await liveCampaignsFor(sb, { billId: bill.id }) : [] };
}

/** Look only: is this link already on iKratom? Used when a link arrives from the share sheet. */
export async function checkLink(raw: string): Promise<LinkBoxResult> {
  return look(raw, "check");
}

/** The "Share it" button: look, and add the link only if it is new. */
export async function shareLink(raw: string): Promise<LinkBoxResult> {
  return look(raw, "share");
}
