/**
 * Wave firing — runs from /api/cron/fire-waves on a schedule.
 *
 * For each due wave (active, scheduled_at <= now, not yet fired):
 *   1. Load all 'pending' signups
 *   2. For each signup: load user's profile + Gmail integration + targets
 *   3. Render the campaign template with their info
 *   4. Send via their Gmail OAuth refresh token
 *   5. Mark signup row 'sent' or 'failed' with error
 *   6. Insert campaign_actions row so impact stats reflect it
 *   7. Mark wave fired_at + counts when done
 *
 * Failure isolation: one user's failure doesn't break others. Errors are
 * recorded per row and the wave is still marked fired with partial counts.
 *
 * Concurrency: we fire users sequentially per wave to stay polite with
 * Gmail's rate limits. Multiple waves in the same cron tick run in series.
 *
 * Time budget: each Gmail send takes ~1-2s. A wave of 50 users is ~75s,
 * which fits the Vercel Pro 300s cap but exceeds Hobby's 60s. For Hobby
 * we cap each cron tick at MAX_USERS_PER_TICK and pick up the rest next
 * tick — eventual consistency.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getEmailIntegration,
  sendOnUserBehalf,
  EmailTokenRevokedError,
  markEmailIntegrationRevoked,
} from "@/lib/email/user-send";
import { renderTemplate, buildVars } from "@/modules/campaigns/templates";
import type { Legislator } from "@/lib/legislators";

const MAX_USERS_PER_TICK = 30; // ≈ 60s budget at 2s/send
const MAX_WAVES_PER_TICK = 10;

export type FireResult = {
  wavesProcessed: number;
  sentTotal: number;
  failedTotal: number;
  carryOver: number; // signups left for next tick
  errors: { wave_id: string; reason: string }[];
};

export async function fireDueWaves(supabase: SupabaseClient): Promise<FireResult> {
  const out: FireResult = { wavesProcessed: 0, sentTotal: 0, failedTotal: 0, carryOver: 0, errors: [] };
  const nowIso = new Date().toISOString();

  // Pull due, unfired waves
  const { data: waves, error: wavesErr } = await supabase
    .from("campaign_waves")
    .select("id, campaign_id, title, scheduled_at, fired_at, active, subject_template_snapshot, body_template_snapshot, target_legislator_ids_snapshot, target_roles_snapshot")
    .eq("active", true)
    .is("fired_at", null)
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(MAX_WAVES_PER_TICK);
  if (wavesErr) {
    out.errors.push({ wave_id: "(query)", reason: wavesErr.message });
    return out;
  }
  if (!waves || waves.length === 0) return out;

  let usersThisTick = 0;

  for (const wave of waves) {
    if (usersThisTick >= MAX_USERS_PER_TICK) break;

    // Load campaign + targets once per wave
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, slug, state, target_locality, target_roles, target_legislator_ids, subject_template, body_template, active")
      .eq("id", wave.campaign_id)
      .maybeSingle();
    if (!campaign || !campaign.active) {
      // Campaign gone or deactivated — mark all pending signups skipped, mark wave fired
      await supabase
        .from("campaign_wave_signups")
        .update({ send_status: "skipped", send_error: "campaign_inactive", sent_at: new Date().toISOString() })
        .eq("wave_id", wave.id)
        .eq("send_status", "pending");
      await supabase
        .from("campaign_waves")
        .update({ fired_at: new Date().toISOString() })
        .eq("id", wave.id);
      out.wavesProcessed++;
      continue;
    }

    // Anti-tamper (mig 0204): fire from the wave's snapshot, frozen at
    // creation. Fall back to the live campaign only for pre-0204 waves whose
    // snapshot columns are null. A post-signup template/target swap can no
    // longer change what joiners send.
    const effSubject = wave.subject_template_snapshot ?? campaign.subject_template;
    const effBody = wave.body_template_snapshot ?? campaign.body_template;
    const effLegislatorIds = wave.target_legislator_ids_snapshot ?? campaign.target_legislator_ids;
    const effRoles = wave.target_roles_snapshot ?? campaign.target_roles;

    // Resolve targets — explicit IDs take precedence over role-based
    let waveTargets: Legislator[] = [];
    if (effLegislatorIds && effLegislatorIds.length > 0) {
      const { data: t } = await supabase
        .from("legislators")
        .select("id,state,role,district,full_name,party,email,phone,office_address,website,level,locality,body,title")
        .in("id", effLegislatorIds)
        .eq("active", true);
      waveTargets = (t ?? []) as Legislator[];
    }
    // role-based targets are per-user (different reps per advocate); we
    // resolve those inside the user loop below.

    // Pull pending signups
    const remaining = MAX_USERS_PER_TICK - usersThisTick;
    const { data: signups } = await supabase
      .from("campaign_wave_signups")
      .select("id, user_id")
      .eq("wave_id", wave.id)
      .eq("send_status", "pending")
      .order("joined_at", { ascending: true })
      .limit(remaining);

    if (!signups || signups.length === 0) {
      // Nothing pending — mark fired
      await supabase
        .from("campaign_waves")
        .update({ fired_at: new Date().toISOString() })
        .eq("id", wave.id);
      out.wavesProcessed++;
      continue;
    }

    // Are there more pending after this batch? Decides whether to set
    // fired_at on this tick or wait until next.
    const { count: leftoverCount } = await supabase
      .from("campaign_wave_signups")
      .select("id", { count: "exact", head: true })
      .eq("wave_id", wave.id)
      .eq("send_status", "pending");
    const willCarryOver = (leftoverCount ?? 0) > signups.length;
    out.carryOver += Math.max(0, (leftoverCount ?? 0) - signups.length);

    let waveSent = 0;
    let waveFailed = 0;

    for (const signup of signups) {
      usersThisTick++;
      try {
        // User profile + targets
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, street, city, state, zip, congressional_district, state_senate_district, state_house_district")
          .eq("id", signup.user_id)
          .single();

        // Provider-agnostic: returns the user's connected gmail OR
        // outlook row, whichever is set. Skips them if they revoked.
        const integration = await getEmailIntegration(signup.user_id);
        if (!integration) {
          await markSignup(supabase, signup.id, "failed", "email_disconnected");
          waveFailed++;
          continue;
        }

        // Resolve user-specific targets if no explicit list
        let userTargets = waveTargets;
        if (userTargets.length === 0) {
          // Role-based resolution against this user's reps
          const { getUserLegislators } = await import("@/lib/legislators");
          const myReps = profile ? await getUserLegislators(supabase, profile) : [];
          userTargets = myReps.filter((r) => effRoles?.includes(r.role));
          // Scope to the campaign's state/locality. getUserLegislators returns
          // the joiner's OWN reps, so an out-of-state (or out-of-locality)
          // advocate who joined the wave would otherwise be sent the campaign's
          // message addressed to their own wrong-state officials. Out-of-area
          // joiners resolve to zero targets here and are skipped below — waves
          // fire unattended, so there's no interactive campaign-state picker
          // like the per-user action card offers. (Mirrors campaigns/[slug].)
          if (campaign.state) {
            userTargets = userTargets.filter((r) => r.state === campaign.state);
          }
          if (campaign.target_locality) {
            const tl = campaign.target_locality.toLowerCase();
            userTargets = userTargets.filter((r) => (r.locality ?? "").toLowerCase() === tl);
          }
        }

        const sendable = userTargets.filter((t) => !!t.email && !t.email.startsWith("http"));
        if (sendable.length === 0) {
          await markSignup(supabase, signup.id, "skipped", "no_sendable_targets");
          continue;
        }

        // Send to each target
        let userSent = 0;
        let userFailed = 0;
        let lastError: string | null = null;
        for (const target of sendable) {
          try {
            const vars = buildVars(profile ?? null, target, sendable);
            const subject = renderTemplate(effSubject, vars);
            const body = renderTemplate(effBody, vars);
            await sendOnUserBehalf({
              integration,
              fromName: profile?.full_name ?? null,
              to: target.email!,
              subject,
              body,
            });
            // Log to campaign_actions for impact stats
            await supabase.from("campaign_actions").insert({
              user_id: signup.user_id,
              campaign_id: campaign.id,
              legislator_id: target.id,
              method: "platform_email",
              subject: subject.slice(0, 200),
              body: body.slice(0, 5000),
            });
            userSent++;
          } catch (e) {
            userFailed++;
            lastError = String(e).slice(0, 500);
            // Self-healing: if the user's token was revoked (either
            // provider), mark the integration stale + bail out of this
            // user's batch. Every remaining send would fail identically.
            if (e instanceof EmailTokenRevokedError) {
              await markEmailIntegrationRevoked(signup.user_id, e.provider);
              break;
            }
          }
        }

        if (userSent > 0) {
          await markSignup(supabase, signup.id, "sent", userFailed > 0 ? `partial: ${userFailed}_failed` : null);
          waveSent++;
        } else {
          await markSignup(supabase, signup.id, "failed", lastError || "all_targets_failed");
          waveFailed++;
        }
      } catch (e) {
        await markSignup(supabase, signup.id, "failed", String(e).slice(0, 500));
        waveFailed++;
      }
    }

    // Increment wave totals (additive — supports multi-tick fires).
    // Read-modify-write is fine here because the cron is the only writer
    // for these columns.
    if (waveSent > 0 || waveFailed > 0) {
      const { data: current } = await supabase
        .from("campaign_waves")
        .select("sent_count, failed_count")
        .eq("id", wave.id)
        .single();
      await supabase
        .from("campaign_waves")
        .update({
          sent_count: (current?.sent_count ?? 0) + waveSent,
          failed_count: (current?.failed_count ?? 0) + waveFailed,
        })
        .eq("id", wave.id);
    }

    if (!willCarryOver) {
      await supabase
        .from("campaign_waves")
        .update({ fired_at: new Date().toISOString() })
        .eq("id", wave.id);
    }

    out.wavesProcessed++;
    out.sentTotal += waveSent;
    out.failedTotal += waveFailed;
  }

  return out;
}

async function markSignup(
  supabase: SupabaseClient,
  id: string,
  status: "sent" | "failed" | "skipped",
  err: string | null,
) {
  await supabase
    .from("campaign_wave_signups")
    .update({
      send_status: status,
      send_error: err,
      sent_at: new Date().toISOString(),
    })
    .eq("id", id);
}
