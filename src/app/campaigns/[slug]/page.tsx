import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators, type Legislator } from "@/lib/legislators";
import { dedupNewsByOutlet, type NewsItem } from "@/lib/news-dedup";
import { buildVars, renderTemplate } from "@/modules/campaigns/templates";
import { getMyCampaignProgress } from "@/modules/campaigns/actions";
import { getEmailIntegration } from "@/lib/email/user-send";
import { getMyWaveStatus } from "@/modules/waves/actions";
import { CampaignAction } from "@/modules/campaigns/components/CampaignAction";
import { LocalActionPlaybook, type LocalMeta } from "@/modules/campaigns/components/LocalActionPlaybook";
import { ShareButtons } from "@/components/ShareButtons";
import { Markdown } from "@/components/Markdown";
import { RemindMeButton } from "@/components/RemindMeButton";
import { ShareButtons as SocialBombButtons } from "@/modules/social/ShareButtons";
import { defaultCampaignShareText } from "@/modules/social/share";

const APP_URL = process.env.APP_URL ?? "https://www.ikratom.org";
import { WavePanel } from "@/modules/waves/components/WavePanel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("title, blurb")
    .eq("slug", slug)
    .maybeSingle();
  const title = data?.title ?? "Campaign";
  const description =
    data?.blurb ?? "Take one-click action on kratom policy — letters + calls to the right officials.";
  // og:image is auto-wired from ./opengraph-image.tsx by the App Router.
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ story?: string; manual_targets?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, slug, title, blurb, body_md, state, bill_id, target_locality, target_roles, target_legislator_ids, subject_template, body_template, active, ends_at")
    .eq("slug", slug)
    .single();

  if (!campaign) notFound();

  // Linked intel — the circulatory system. Every campaign links back to its
  // bill, the alert(s) that spawned it, and the state hub.
  //
  // IMPORTANT: the news gather below uses ALL of the campaign's alerts (any
  // moderation_status), not just approved ones. The autonomy engine auto-
  // REJECTS categorical news alerts (recall/advisory/enforcement), but the
  // news_items those alerts spawned are still real, active coverage that
  // belongs on the campaign. Tying the gather to approved-only alerts silently
  // zeroed out the news on every campaign whose alerts were auto-rejected
  // (e.g. the MI regulation campaign: 4 active articles, 0 surfaced). Only the
  // "alert behind this campaign" CHIP stays approved-only — we never deep-link
  // a rejected alert (its /alerts/[id] page won't render).
  const [{ data: linkedBill }, { data: campaignAlerts }] = await Promise.all([
    campaign.bill_id
      ? supabase.from("bills").select("id, state, bill_number, title").eq("id", campaign.bill_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("policy_alerts")
      .select("id, title, severity, bill_id, moderation_status")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false }),
  ]);
  const allAlerts = (campaignAlerts ?? []) as Array<{ id: string; title: string; severity: string; bill_id: string | null; moderation_status: string }>;
  const linkedAlert = allAlerts.find((a) => a.moderation_status === "approved") ?? null;
  const alertIds = allAlerts.map((a) => a.id);
  // Every bill the campaign OR its alerts resolve to — the story's bill(s).
  const billIds = [...new Set([campaign.bill_id, ...allAlerts.map((a) => a.bill_id)].filter(Boolean))] as string[];

  // News coverage — every internal /news article about this campaign's story,
  // gathered like /bills/[id]: union news_items.bill_id (the campaign's bill or
  // its alerts' bill) with policy_alert_id IN the campaign's alerts (regardless
  // of moderation), then dedup. Internal-first: render links to OUR /news
  // reader. Gathers dynamically, so new coverage auto-appears as the nightly
  // scrape correlates it — no manual re-linking.
  let newsCoverage: NewsItem[] = [];
  {
    const orClauses: string[] = [];
    for (const bid of billIds) orClauses.push(`bill_id.eq.${bid}`);
    if (alertIds.length > 0) orClauses.push(`policy_alert_id.in.(${alertIds.join(",")})`);
    if (orClauses.length > 0) {
      const { data: news } = await supabase
        .from("news_items")
        .select("id, title, source_name, url, published_at, summary")
        .or(orClauses.join(","))
        .eq("active", true)
        .order("published_at", { ascending: false })
        .limit(80);
      // Per owner directive: a campaign lists ALL outlets that covered the
      // story (only exact re-scrapes collapse), not one canonical — so a
      // 10-outlet story shows 10 internal /news links.
      newsCoverage = dedupNewsByOutlet((news ?? []) as NewsItem[], 25);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=/campaigns/${slug}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, username, street, city, county, state, zip, congressional_district, state_senate_district, state_house_district"
    )
    .eq("id", user.id)
    .single();

  // Check if user has ANY email provider connected for one-click send.
  // PK is user_id so there's at most one row; provider can be gmail or
  // outlook (or future: yahoo). The CampaignAction surface uses
  // `gmailConnected` as the boolean and `gmailEmail` as the
  // displayed-from address — both renamed only at the prop layer would
  // mean touching many sites, so we keep the names but populate from
  // any provider's row. Future cleanup: rename to emailConnected /
  // emailFromAddress.
  // Connected = a VALID token, not just a saved row. getEmailIntegration()
  // (service-role) returns null when the refresh token was blanked after an
  // invalid_grant revocation — the SAME check the send path uses, so we never
  // show a "Send" button that then fails with "no provider connected" (the bug
  // the owner hit: account_email persisted but the token was revoked). A row
  // with an account_email but no valid token = the connection EXPIRED → prompt a
  // reconnect rather than a first-time connect.
  const validIntegration = await getEmailIntegration(user.id);
  const { data: rawIntegration } = await supabase
    .from("email_integrations")
    .select("account_email")
    .eq("user_id", user.id)
    .maybeSingle();
  const gmailConnected = !!validIntegration;
  const gmailIntegration = validIntegration; // alias for existing prop names below
  const emailNeedsReconnect = !validIntegration && !!rawIntegration?.account_email;

  // The state this campaign acts on. Drives who an out-of-area advocate
  // contacts: a CA-bill campaign should reach CA legislators, not the OK reps
  // of an OK user who opened it. `null` = federal — every user contacts their
  // own delegation. (Owner policy 2026-06-22: every campaign is actionable by
  // every user regardless of where they live; for role-based state campaigns
  // an out-of-state advocate picks from the campaign-state officials below
  // rather than auto-blasting a whole legislature.)
  const targetState: string | null = campaign.state;

  // Resolve recipients — three modes:
  // 1. Explicit `target_legislator_ids` (campaign creator picked specific officials)
  // 2. `target_locality` (only users in that locality can act; recipients = officials there matching roles)
  // 3. Role-based (user's specific reps matching target_roles + state)
  let targets: Legislator[] = [];
  // Manual override — when district auto-detection fails (Census gap) or an
  // out-of-state advocate picks who to contact, the targets are passed
  // explicitly. Encoded as ?manual_targets=id1,id2,id3 in the URL.
  const manualTargetIds = sp.manual_targets
    ? sp.manual_targets.split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 20)
    : [];

  if (manualTargetIds.length > 0) {
    // User-picked targets. Verify they belong to the state this campaign acts
    // on (the campaign's state for state/local campaigns, else the user's own
    // state) + match the campaign's target_roles — prevents an accidental
    // ?manual_targets=… landing on the wrong state's officials.
    const { data: manualTargets } = await supabase
      .from("legislators")
      .select("id,state,role,district,full_name,party,email,phone,office_address,website,level,locality,body,title")
      .in("id", manualTargetIds)
      .eq("active", true);
    const validState = targetState ?? profile?.state ?? null;
    targets = ((manualTargets ?? []) as Legislator[]).filter((t) => {
      if (!campaign.target_roles.includes(t.role)) return false;
      if (validState && t.state !== validState) return false;
      return true;
    });
  } else if (campaign.target_legislator_ids && campaign.target_legislator_ids.length > 0) {
    // Mode 1: Fetch the exact legislators by ID. Filter to ones with email/contact.
    // Explicit-target campaigns are one-click for everyone, in or out of state.
    const { data: explicitTargets } = await supabase
      .from("legislators")
      .select("id,state,role,district,full_name,party,email,phone,office_address,website,level,locality,body,title")
      .in("id", campaign.target_legislator_ids)
      .eq("active", true);
    targets = (explicitTargets ?? []) as Legislator[];
  } else {
    // Mode 2 + 3: role-based. Start from the user's own matched reps.
    const myReps: Legislator[] = profile
      ? await getUserLegislators(supabase, profile)
      : [];
    targets = myReps.filter((r) => campaign.target_roles.includes(r.role));
    // For a state/local campaign, only the campaign-state's officials are the
    // right recipients. getUserLegislators returns the user's OWN reps, so an
    // out-of-state advocate would otherwise be handed their own (wrong) reps.
    // Drop those — the campaign-state picker (pickableStateReps below) then
    // lets the non-resident choose who to contact.
    if (targetState) {
      targets = targets.filter((r) => r.state === targetState);
    }
    // Local campaign: also require the official's locality to match the
    // campaign's. getUserLegislators matched the user's OWN city/county, so a
    // same-state user in a DIFFERENT city would otherwise be handed their own
    // local officials (wrong desk). Out-of-locality users fall through to the
    // locality picker (pickableStateReps below).
    if (campaign.target_locality) {
      const tl = campaign.target_locality.toLowerCase();
      targets = targets.filter((r) => (r.locality ?? "").toLowerCase() === tl);
    }
  }

  // Per-target intel signals — surfaced as chips next to each
  // legislator in the recipient list. Three signals cheaply joined:
  //   1. Kratom stance (champion / sympathetic / neutral / hostile / unknown)
  //   2. Count of advocate-flagged donor industries (federal only)
  //   3. Count of kratom-adjacent personal stock trades (federal only)
  // All three queries are scoped to the target id set so they stay
  // cheap regardless of how many bills a state-wide campaign covers.
  // Pre-migration deploys (before 0149 / 0150) just see empty data.
  const targetIds = targets.map((t) => t.id);
  const targetIntel: Record<string, {
    stance?: string;
    flagged_industries: Array<{ industry: string; label: string; amount: number }>;
    kratom_adjacent_trades: number;
  }> = {};
  for (const id of targetIds) {
    targetIntel[id] = { flagged_industries: [], kratom_adjacent_trades: 0 };
  }
  if (targetIds.length > 0) {
    const [stancesRes, donorsRes, tradesRes] = await Promise.all([
      supabase
        .from("legislator_stance")
        .select("legislator_id, stance")
        .eq("topic", "kratom")
        .in("legislator_id", targetIds),
      supabase
        .from("legislator_donors")
        .select("legislator_id, top_industries")
        .in("legislator_id", targetIds)
        .eq("resolved_status", "matched"),
      supabase
        .from("federal_personal_trades")
        .select("legislator_id")
        .in("legislator_id", targetIds)
        .eq("is_kratom_adjacent", true),
    ]);
    for (const s of (stancesRes.data ?? []) as Array<{ legislator_id: string; stance: string }>) {
      if (targetIntel[s.legislator_id]) targetIntel[s.legislator_id].stance = s.stance;
    }
    for (const d of (donorsRes.data ?? []) as Array<{
      legislator_id: string;
      top_industries: Array<{ industry: string; label?: string; advocate_flag?: boolean; amount: number }> | null;
    }>) {
      const intel = targetIntel[d.legislator_id];
      if (!intel || !Array.isArray(d.top_industries)) continue;
      intel.flagged_industries = d.top_industries
        .filter((i) => i.advocate_flag && i.amount >= 5_000)
        .map((i) => ({ industry: i.industry, label: i.label ?? i.industry, amount: i.amount }));
    }
    for (const t of (tradesRes.data ?? []) as Array<{ legislator_id: string }>) {
      if (targetIntel[t.legislator_id]) targetIntel[t.legislator_id].kratom_adjacent_trades += 1;
    }
  }

  // Manual-picker fallback: when we couldn't auto-resolve the user's specific
  // reps, fetch the campaign's officials so the CampaignAction card can render
  // a picker. Three scopes, in priority order:
  //   - Local campaign  → the target locality's officials matching roles.
  //   - State campaign  → the campaign-state's officials matching roles
  //                       (covers out-of-state advocates + Census-gap residents;
  //                       no role gate, so a us_senate-only state campaign works).
  //   - Federal district campaign → the user's OWN state's district reps to pick
  //                       from when Census couldn't map their district.
  // Capped at 200 (no scope has more).
  let pickableStateReps: Legislator[] = [];
  if (targets.length === 0 && !manualTargetIds.length) {
    const PICK_COLS =
      "id,state,role,district,full_name,party,email,phone,office_address,website,level,locality,body,title";
    if (campaign.target_locality) {
      const { data } = await supabase
        .from("legislators")
        .select(PICK_COLS)
        .ilike("locality", campaign.target_locality)
        .eq("active", true)
        .in("role", campaign.target_roles)
        .limit(200);
      pickableStateReps = (data ?? []) as Legislator[];
    } else if (targetState) {
      const { data } = await supabase
        .from("legislators")
        .select(PICK_COLS)
        .eq("state", targetState)
        .eq("active", true)
        .in("role", campaign.target_roles)
        .limit(200);
      pickableStateReps = (data ?? []) as Legislator[];
    } else if (
      profile?.state &&
      campaign.target_roles.some((r: string) => r === "state_senate" || r === "state_house" || r === "us_house")
    ) {
      const { data } = await supabase
        .from("legislators")
        .select(PICK_COLS)
        .eq("state", profile.state)
        .eq("active", true)
        .in("role", campaign.target_roles)
        .limit(200);
      pickableStateReps = (data ?? []) as Legislator[];
    }
  }

  // Pre-render subject/body using the user's profile + first target as
  // representative for {{legislator_name}}. The body field gets edited client-side.
  const vars = buildVars(profile, targets[0] ?? null, targets);
  const subject = renderTemplate(campaign.subject_template, vars);
  let body = renderTemplate(campaign.body_template, vars);

  // Story → Letter: if ?story=<id> is present and points to an approved
  // story, prepend it to the email body so the user can use someone's
  // first-person testimony as their letter's opener.
  let attachedStoryTitle: string | null = null;
  if (sp.story && /^[0-9a-f-]{36}$/i.test(sp.story)) {
    const { data: story } = await supabase
      .from("kratom_stories")
      .select("title, body, anonymous, display_name")
      .eq("id", sp.story)
      .eq("moderation_status", "approved")
      .is("deleted_at", null)
      .maybeSingle();
    if (story) {
      const s = story as { title: string; body: string; anonymous: boolean; display_name: string | null };
      attachedStoryTitle = s.title;
      const author = s.anonymous ? "an iKratom advocate" : (s.display_name ?? "an iKratom advocate");
      body = `Dear Senator/Representative,\n\nI'm sharing the story of ${author}, which spoke to me:\n\n"${s.body}"\n\n— Below is my own message —\n\n${body}`;
    }
  }

  // Action count for this campaign (social proof)
  const { count: totalActions } = await supabase
    .from("campaign_actions")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id);

  // For city/county-scoped campaigns, fetch the bill's local_meta so
  // the LocalActionPlaybook can render meeting time + city hall +
  // mailing address fallback. Without this, small-town campaigns where
  // officials don't publish per-member email/phone leave the page empty.
  let billLocalMeta: Record<string, unknown> | null = null;
  let billLocality: string | null = null;
  if (campaign.bill_id) {
    const { data: linkedBill } = await supabase
      .from("bills")
      .select("local_meta, locality, scope")
      .eq("id", campaign.bill_id)
      .single();
    const lb = linkedBill as { local_meta: Record<string, unknown> | null; locality: string | null; scope: string | null } | null;
    billLocalMeta = lb?.local_meta ?? null;
    billLocality = lb?.locality ?? null;
  }
  const isLocalCampaign = !!campaign.target_locality
    || (billLocality && (billLocality.includes(",") || /^\w+ County/i.test(billLocality)));
  const targetsLackContact = targets.length > 0
    && !targets.some((t) => t.email || t.phone);

  // What this user has already sent for this campaign (spam-prevention UI)
  const myProgress = await getMyCampaignProgress(campaign.id);

  // Active wave for this campaign (or most recent fired one to show summary)
  const { data: waveRaw } = await supabase
    .from("campaign_waves")
    .select("id, campaign_id, title, description, scheduled_at, fired_at, target_signups, sent_count, failed_count, active")
    .eq("campaign_id", campaign.id)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const wave = waveRaw as unknown as {
    id: string;
    campaign_id: string;
    title: string;
    description: string | null;
    scheduled_at: string;
    fired_at: string | null;
    target_signups: number | null;
    sent_count: number;
    failed_count: number;
    active: boolean;
  } | null;

  let waveCount = 0;
  let waveJoined = false;
  if (wave) {
    // SECURITY DEFINER function: bypasses RLS to expose the aggregate
    // count without leaking per-user signup identity.
    const { data: cnt } = await supabase
      .rpc("get_wave_signup_count", { p_wave_id: wave.id });
    waveCount = typeof cnt === "number" ? cnt : 0;
    const myStatus = await getMyWaveStatus(wave.id);
    waveJoined = myStatus.joined;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/campaigns" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← All campaigns
      </a>

      <header className="mt-3 mb-8">
        <div className="flex flex-wrap items-center gap-2">
          {campaign.state && (
            <span className="rounded bg-emerald-950/40 px-2 py-0.5 text-xs font-semibold text-emerald-300">
              {campaign.state}
            </span>
          )}
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-zinc-300">
            Active
          </span>
          {totalActions != null && totalActions > 0 && (
            <span className="text-xs text-zinc-500">
              · {totalActions.toLocaleString()} actions taken
            </span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{campaign.title}</h1>
        {campaign.blurb && (
          <p className="mt-3 text-lg text-zinc-300">{campaign.blurb}</p>
        )}
        {/* Custom reminder — let users set a follow-up for THIS campaign.
            Use case: "remind me to send the email Thursday morning" or
            "ping me a week before the committee hearing." */}
        <div className="mt-3">
          <RemindMeButton
            targetKind="campaign"
            targetId={campaign.id}
            defaultTitle={`Take action: ${campaign.title.slice(0, 70)}`}
            defaultMessage="Send the email, call the rep, or share — open the campaign to start."
          />
        </div>
      </header>

      {/* Social bombing — multi-network share with optional "Bomb run"
          (opens compose dialog for every network in sequence). The
          existing ShareButtons block (further down) is the per-platform
          tracked-share for in-app metrics; this one is the rapid
          amplification surface. */}
      <details open className="mb-6 rounded-lg border border-zinc-800/60 bg-zinc-950/20 p-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200">
          📣 Amplify · spread the word
        </summary>
        <div className="mt-2">
          <SocialBombButtons
            url={`${APP_URL}/campaigns/${campaign.slug}`}
            text={defaultCampaignShareText({
              title: campaign.title,
              state: campaign.state ?? null,
              // Heuristic — campaign title contains "oppose"/"ban"/"schedule" implies hostile
              isHostile: /\b(oppose|ban|schedule|prohibit|stop)\b/i.test(campaign.title),
            })}
            hashtags={["kratom", "iKratom", campaign.state ?? "advocacy"].filter(Boolean) as string[]}
          />
        </div>
      </details>

      {/* Story attached banner — when ?story=<id> auto-populated the body */}
      {attachedStoryTitle && (
        <div className="mb-6 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-4 text-sm">
          <p className="font-semibold text-emerald-300">📖 Story attached: {attachedStoryTitle}</p>
          <p className="mt-1 text-emerald-200/80">
            We&apos;ve prepended this advocate&apos;s story to your email. Edit anything you
            want before hitting Send — the more personal it gets, the more it lands.
          </p>
        </div>
      )}

      {/* Local action playbook — renders for city/county-scoped campaigns
          where targets typically lack per-member email/phone. Surfaces
          city-hall contacts, meeting info, and per-official websites
          so the page never looks empty. See LocalActionPlaybook docstring. */}
      {(isLocalCampaign && (targetsLackContact || billLocalMeta)) && (
        <LocalActionPlaybook
          campaignTitle={campaign.title}
          bodyTemplate={campaign.body_template}
          targets={targets}
          localMeta={billLocalMeta as LocalMeta | null}
          locality={campaign.target_locality ?? billLocality}
        />
      )}

      {/* Wave panel — render above the per-user action card so users see the
          coordinated option first when an active wave exists. */}
      {wave && (wave.active || wave.fired_at) && (
        <WavePanel
          wave={wave}
          initialCount={waveCount}
          initialJoined={waveJoined}
          signedIn={!!user}
          gmailConnected={gmailConnected}
        />
      )}

      {/* Linked intel strip — bill ⇄ alert ⇄ state hub, structural for
          every campaign (internal-circle rule). */}
      {(linkedBill || linkedAlert || campaign.state) && (
        <div className="mb-6 flex flex-wrap gap-2 text-xs">
          {linkedBill && (
            <Link
              href={`/bills/${linkedBill.id}`}
              className="rounded-md border border-emerald-700/40 bg-emerald-950/15 px-3 py-1.5 text-emerald-300 hover:border-emerald-500"
            >
              ⚖ {linkedBill.state} {linkedBill.bill_number} — bill page, timeline &amp; votes
            </Link>
          )}
          {linkedAlert && (
            <Link
              href={`/alerts/${linkedAlert.id}`}
              className="rounded-md border border-amber-700/40 bg-amber-950/10 px-3 py-1.5 text-amber-300 hover:border-amber-500"
            >
              📡 The alert behind this campaign
            </Link>
          )}
          {campaign.state && (
            <Link
              href={`/states/${campaign.state}`}
              className="rounded-md border border-zinc-700 bg-zinc-950/40 px-3 py-1.5 text-zinc-300 hover:border-zinc-500"
            >
              🏛 {campaign.state} war room
            </Link>
          )}
        </div>
      )}

      {/* News coverage — every internal /news story about this campaign,
          deduped across syndications. Internal-first: links our own reader. */}
      {newsCoverage.length > 0 && (
        <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            📰 In the news · {newsCoverage.length}
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            Every story we&apos;ve indexed about this campaign — read it in iKratom.
          </p>
          <ul className="mt-2 space-y-1.5">
            {newsCoverage.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/news/${n.id}`}
                  className="flex flex-wrap items-baseline gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm hover:border-emerald-500"
                >
                  {n.source_name && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      {n.source_name}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{n.title}</span>
                  {n.published_at && (
                    <span className="text-[10px] text-zinc-500">
                      {new Date(n.published_at).toLocaleDateString()}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action card — the killer feature */}
      <CampaignAction
        campaignId={campaign.id}
        targets={targets}
        targetIntel={targetIntel}
        targetRoles={campaign.target_roles}
        userState={profile?.state ?? null}
        campaignState={campaign.state}
        userCity={profile?.city ?? null}
        userCounty={profile?.county ?? null}
        campaignLocality={campaign.target_locality}
        bodyTemplate={campaign.body_template}
        gmailConnected={gmailConnected}
        gmailEmail={gmailIntegration?.account_email ?? null}
        emailNeedsReconnect={emailNeedsReconnect}
        alreadySentLegislatorIds={myProgress.sentLegislatorIds}
        lastSentAt={myProgress.lastSentAt}
        initialSubject={subject}
        initialBody={body}
        hasStreet={!!profile?.street}
        hasDistricts={!!(
          profile?.congressional_district ||
          profile?.state_senate_district ||
          profile?.state_house_district
        )}
        pickableStateReps={pickableStateReps}
        campaignSlug={campaign.slug}
      />

      {/* Share to your network — distributed organic mobilization.
          Deliberately KEPT alongside the top Amplify box: this one fires
          post-action (best conversion moment) and tracks shares in-app. */}
      <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <details open>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
            📣 Share with your people
          </summary>
          <p className="mt-1 text-sm text-zinc-300">
            Post this campaign to your FB group, X, Reddit, or send to a friend.
            Your voice on your accounts matters more than ours.
          </p>
          <div className="mt-3">
            <ShareButtons
              url={`${APP_URL}/campaigns/${campaign.slug}`}
              title={campaign.title}
              text={campaign.blurb ?? ""}
              target={{ kind: "campaign", campaignId: campaign.id }}
            />
          </div>
        </details>
      </section>

      {/* The ask / context */}
      {campaign.body_md && (
        <section className="mt-10">
          <details open>
          <summary className="mb-3 cursor-pointer text-sm font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
            Why this matters
          </summary>
          {/* body_md is MARKDOWN — render it (raw ##/** previously displayed
              as literal text; owner caught it on the AB 1088 campaign). */}
          <div className="prose prose-invert max-w-none rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm leading-relaxed text-zinc-300">
            <Markdown>{campaign.body_md}</Markdown>
          </div>
          </details>
        </section>
      )}

      {/* "What happens" footer */}
      <section className="mt-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-xs text-zinc-500">
        <p>
          <strong className="text-zinc-300">What happens when you click send?</strong>{" "}
          We open your default email app with the message pre-filled, addressed to your
          legislators. You stay in control — review, tweak, and hit send. The email
          comes from <em>your</em> address, which is what legislators actually read.
        </p>
        <p className="mt-3">
          <strong className="text-emerald-400">Faster: one-click via Gmail.</strong>{" "}
          Connect your Gmail (button up in the action card) and iKratom sends a
          personalized email to every legislator with a single click — each from your
          address, each in your Sent folder. Narrowest possible scope (gmail.send only);
          we never read your inbox or store contents. Outlook + Proton coming next.
        </p>
      </section>
    </div>
  );
}
