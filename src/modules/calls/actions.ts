"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aiSummarizeCall } from "./ai-summarize";

// States requiring TWO-PARTY consent to record a call.
// Source: well-established list. Updated 2026.
export const TWO_PARTY_CONSENT_STATES = new Set([
  "CA", "CT", "DE", "FL", "IL", "MD", "MA", "MI", "MT", "NV",
  "NH", "PA", "WA",
  // NY: technically one-party (NY Penal Law § 250.05) but we treat
  // it as two-party here because the legislative records being captured
  // are sensitive and the consumer-facing UI errs on the safer side.
  "NY",
]);

export type StartSessionInput = {
  legislatorId?: string | null;
  campaignId?: string | null;
  billId?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientRole?: string | null;
  recipientOffice?: string | null;
  state?: string | null;
  recordingConsent: boolean;
  twoPartyDisclosureRecited?: boolean | null;
};

export async function startCallSession(input: StartSessionInput) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Sign in required." };

  // For 2-party states, require both consent flags
  const stateUpper = (input.state ?? "").toUpperCase();
  if (input.recordingConsent && TWO_PARTY_CONSENT_STATES.has(stateUpper) && !input.twoPartyDisclosureRecited) {
    return { error: `${stateUpper} requires two-party consent. Please recite the disclosure line before recording.` };
  }

  const { data, error } = await sb.from("call_sessions").insert({
    user_id: user.id,
    legislator_id: input.legislatorId ?? null,
    campaign_id: input.campaignId ?? null,
    bill_id: input.billId ?? null,
    recipient_name: input.recipientName?.slice(0, 200) ?? null,
    recipient_phone: input.recipientPhone?.slice(0, 30) ?? null,
    recipient_role: input.recipientRole?.slice(0, 50) ?? null,
    recipient_office: input.recipientOffice?.slice(0, 200) ?? null,
    state: stateUpper || null,
    recording_consent_given: !!input.recordingConsent,
    recording_consent_at: input.recordingConsent ? new Date().toISOString() : null,
    two_party_disclosure_recited: input.twoPartyDisclosureRecited ?? null,
  }).select("id").single();

  if (error) return { error: error.message };
  return { ok: true, sessionId: data.id };
}

export type UpdateTranscriptInput = {
  sessionId: string;
  transcript_md?: string;
  user_notes_md?: string;
};

export async function updateCallTranscript(input: UpdateTranscriptInput) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Sign in required." };

  const { error } = await sb.from("call_sessions").update({
    transcript_md: input.transcript_md?.slice(0, 50000) ?? null,
    user_notes_md: input.user_notes_md?.slice(0, 10000) ?? null,
  }).eq("id", input.sessionId).eq("user_id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}

export type EndSessionInput = {
  sessionId: string;
  outcome: "reached" | "voicemail" | "busy" | "declined" | "no_answer";
  transcript_md?: string;
  user_notes_md?: string;
  submitForReview?: boolean;        // user opts to submit transcript for admin review → public corpus
};

export async function endCallSession(input: EndSessionInput) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Sign in required." };

  // Fetch the row to compute duration + run summary if eligible
  const { data: row, error: readErr } = await sb.from("call_sessions")
    .select("started_at, transcript_md, recipient_name, recipient_role, state")
    .eq("id", input.sessionId)
    .eq("user_id", user.id)
    .single();
  if (readErr || !row) return { error: readErr?.message ?? "Session not found." };

  const startedMs = new Date(row.started_at).getTime();
  const durationSec = Math.max(1, Math.round((Date.now() - startedMs) / 1000));

  // If outcome is "reached" + transcript exists → AI-summarize
  const transcript = (input.transcript_md ?? row.transcript_md ?? "").trim();
  let summary: { summary_md: string | null; provider: string | null } = { summary_md: null, provider: null };
  if (input.outcome === "reached" && transcript.length > 100) {
    try {
      summary = await aiSummarizeCall({
        transcript_md: transcript,
        recipient_name: row.recipient_name,
        recipient_role: row.recipient_role,
        state: row.state,
      });
    } catch (e) {
      // Don't fail the end-of-call if summary errors — just skip it
      console.error("[call summary]", e);
    }
  }

  const moderationStatus = input.submitForReview ? "pending_review" : "private";

  const { error: updateErr } = await sb.from("call_sessions").update({
    ended_at: new Date().toISOString(),
    duration_seconds: durationSec,
    outcome: input.outcome,
    transcript_md: transcript || null,
    user_notes_md: input.user_notes_md?.slice(0, 10000) ?? null,
    ai_summary_md: summary.summary_md,
    ai_summary_provider: summary.provider,
    moderation_status: moderationStatus,
  }).eq("id", input.sessionId).eq("user_id", user.id);

  if (updateErr) return { error: updateErr.message };

  revalidatePath("/calls");
  revalidatePath("/account/calls");
  return { ok: true, durationSec, summary: summary.summary_md };
}

export async function listMyCalls(limit = 30) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];
  const { data } = await sb.from("call_sessions")
    .select("id, recipient_name, recipient_role, state, started_at, ended_at, duration_seconds, outcome, moderation_status, ai_summary_md")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listMyAchievements() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];
  const { data } = await sb.from("call_achievements")
    .select("badge_code, earned_at, details")
    .eq("user_id", user.id)
    .order("earned_at", { ascending: false });
  return data ?? [];
}
