import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators, type Legislator } from "@/lib/legislators";
import { buildVars, renderTemplate } from "@/modules/campaigns/templates";
import { getMyCampaignProgress } from "@/modules/campaigns/actions";
import { getMyWaveStatus } from "@/modules/waves/actions";
import { CampaignAction } from "@/modules/campaigns/components/CampaignAction";
import { LocalActionPlaybook, type LocalMeta } from "@/modules/campaigns/components/LocalActionPlaybook";
import { ShareButtons } from "@/components/ShareButtons";
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
    .select("title")
    .eq("slug", slug)
    .single();
  return { title: data?.title ?? "Campaign" };
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ story?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, slug, title, blurb, body_md, state, bill_id, target_locality, target_roles, target_legislator_ids, subject_template, body_template, active, ends_at, allow_non_residents")
    .eq("slug", slug)
    .single();

  if (!campaign) notFound();

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

  // Check if user has Gmail connected for one-click send
  const { data: gmailIntegration } = await supabase
    .from("email_integrations")
    .select("account_email")
    .eq("user_id", user.id)
    .eq("provider", "gmail")
    .maybeSingle();
  const gmailConnected = !!gmailIntegration;

  // Resolve recipients — three modes:
  // 1. Explicit `target_legislator_ids` (campaign creator picked specific officials)
  // 2. `target_locality` (only users in that locality can act; recipients = officials there matching roles)
  // 3. Role-based (user's specific reps matching target_roles + state)
  let targets: Legislator[] = [];

  if (campaign.target_legislator_ids && campaign.target_legislator_ids.length > 0) {
    // Mode 1: Fetch the exact legislators by ID. Filter to ones with email/contact.
    const { data: explicitTargets } = await supabase
      .from("legislators")
      .select("id,state,role,district,full_name,party,email,phone,office_address,website,level,locality,body,title")
      .in("id", campaign.target_legislator_ids)
      .eq("active", true);
    targets = (explicitTargets ?? []) as Legislator[];
  } else {
    // Mode 2 + 3: Use user's matched reps filtered by target_roles
    const myReps: Legislator[] = profile
      ? await getUserLegislators(supabase, profile)
      : [];
    targets = myReps.filter((r) => campaign.target_roles.includes(r.role));
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
      <div className="mb-6">
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

      {/* Action card — the killer feature */}
      <CampaignAction
        campaignId={campaign.id}
        targets={targets}
        targetRoles={campaign.target_roles}
        userState={profile?.state ?? null}
        campaignState={campaign.state}
        userCity={profile?.city ?? null}
        userCounty={profile?.county ?? null}
        campaignLocality={campaign.target_locality}
        allowNonResidents={!!campaign.allow_non_residents}
        bodyTemplate={campaign.body_template}
        gmailConnected={gmailConnected}
        gmailEmail={gmailIntegration?.account_email ?? null}
        alreadySentLegislatorIds={myProgress.sentLegislatorIds}
        lastSentAt={myProgress.lastSentAt}
        initialSubject={subject}
        initialBody={body}
      />

      {/* Share to your network — distributed organic mobilization */}
      <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          📣 Share with your people
        </p>
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
      </section>

      {/* The ask / context */}
      {campaign.body_md && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Why this matters
          </h2>
          <div className="prose prose-invert max-w-none whitespace-pre-line rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm leading-relaxed text-zinc-300">
            {campaign.body_md}
          </div>
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
          <strong className="text-emerald-400">Coming soon:</strong> connect your Gmail
          or Outlook account once and iKratom sends personalized emails to every
          legislator with a single click — no client switching, full Sent-folder record,
          one-tap action across 50 states.
        </p>
      </section>
    </div>
  );
}
