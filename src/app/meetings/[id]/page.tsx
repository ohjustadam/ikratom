import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { jsonLdSafe } from "@/lib/jsonld";
import { SignUpNudge } from "@/components/SignUpNudge";
import { EnablePushNudge } from "@/components/EnablePushNudge";
import { RemindMeButton } from "@/components/RemindMeButton";

type Props = { params: Promise<{ id: string }> };

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Everything on /meetings/[id] is PUBLIC and keyed by the meeting id — there
// are NO viewer-specific reads (RemindMe/nudges are client components). So the
// page + generateMetadata share ONE cached service-role read-set (the #827/#831
// egress pattern). RLS parity: only moderation_status='approved' meetings are
// public, so that filter is baked into the query — the fn returns null for any
// non-approved or missing id, and callers notFound()/fall back to a bare title.
const getMeeting = unstable_cache(
  async (id: string) => {
    const sb = createServiceRoleClient();
    const { data } = await sb
      .from("municipal_meetings")
      .select(
        "id, state, locality, body_name, meeting_at, zoom_url, livestream_url, agenda_url, agenda_text, public_comment_signup_url, in_person_address",
      )
      .eq("id", id)
      .eq("moderation_status", "approved")
      .maybeSingle();
    return data ?? null;
  },
  ["meeting-detail"],
  { revalidate: 600, tags: ["meeting-detail"] },
);

// Per-meeting metadata so the page has rich Open Graph + Twitter
// cards for Facebook Messenger / iMessage / SMS / Slack / Twitter
// link previews. The og-image is dynamically generated at /meetings/[id]/opengraph-image.
export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Meeting · iKratom" };
  const m = await getMeeting(id);

  if (!m) {
    return { title: "Meeting · iKratom" };
  }

  const title = `🚨 LIVE: ${m.locality ?? m.state} ${m.body_name ?? "meeting"} — kratom on agenda`;
  const description = m.agenda_text
    ? `${m.agenda_text.slice(0, 200)}${m.agenda_text.length > 200 ? "…" : ""}`
    : `${m.locality ?? m.state} ${m.body_name ?? "officials"} are considering kratom policy. Watch live, sign up for public comment, or call your rep — links inside.`;
  const url = `${SITE}/meetings/${id}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "iKratom",
      type: "article",
      images: [{ url: `${SITE}/meetings/${id}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${SITE}/meetings/${id}/opengraph-image`],
    },
  };
}

export const dynamic = "force-dynamic";

// Format a Date as Google Calendar's expected URL format:
// YYYYMMDDTHHMMSSZ (UTC). Same shape as iCal but without the colon
// separators.
function formatGoogleDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

export default async function MeetingDetailPage({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const m = await getMeeting(id);

  if (!m) notFound();

  const when = new Date(m.meeting_at);
  const now = Date.now();
  const sinceStartMs = now - when.getTime();
  const isLive = sinceStartMs >= 0 && sinceStartMs < 6 * 60 * 60 * 1000; // last 6h = "live"
  const minsAgo = Math.floor(sinceStartMs / 60_000);
  const daysFromNow = Math.ceil((when.getTime() - now) / 86_400_000);

  // Schema.org Event JSON-LD — tells Google + AI summarizers + Apple
  // Spotlight that this URL describes a real-world event. Improves
  // search-citation quality + enables rich snippets on result pages.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: `${m.locality ?? m.state} ${m.body_name ?? "public meeting"} — kratom on agenda`,
    startDate: when.toISOString(),
    endDate: new Date(when.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: m.zoom_url
      ? "https://schema.org/MixedEventAttendanceMode"
      : m.in_person_address
      ? "https://schema.org/OfflineEventAttendanceMode"
      : "https://schema.org/OnlineEventAttendanceMode",
    location: m.in_person_address
      ? {
          "@type": "Place",
          name: m.body_name ?? "Public meeting venue",
          address: { "@type": "PostalAddress", streetAddress: m.in_person_address },
        }
      : {
          "@type": "VirtualLocation",
          url: m.zoom_url ?? m.livestream_url ?? `${SITE}/meetings/${m.id}`,
        },
    description: m.agenda_text
      ? m.agenda_text.slice(0, 300)
      : `${m.locality ?? m.state} ${m.body_name ?? "officials"} are considering kratom policy.`,
    organizer: { "@type": "GovernmentOrganization", name: m.body_name ?? `${m.locality ?? m.state} local government` },
    url: `${SITE}/meetings/${m.id}`,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(jsonLd) }}
      />
      <Link href="/calendar" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Calendar
      </Link>

      {/* Hero — live indicator + immediate CTAs */}
      <header className="mt-2 mb-6">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-[11px] font-mono uppercase text-zinc-400">
            {m.state}
          </span>
          {isLive ? (
            <span className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white animate-pulse">
              🔴 LIVE NOW · started {minsAgo > 60 ? `${Math.floor(minsAgo / 60)}h ${minsAgo % 60}m` : `${minsAgo}m`} ago
            </span>
          ) : daysFromNow > 0 ? (
            <span className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-bold uppercase text-zinc-950">
              In {daysFromNow} day{daysFromNow === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="rounded bg-zinc-700 px-2 py-0.5 text-[11px] font-bold uppercase text-zinc-300">
              ENDED
            </span>
          )}
        </div>
        <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
          {m.locality ?? m.state}
          {m.body_name && <span className="block text-xl text-zinc-400 mt-1">{m.body_name}</span>}
        </h1>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-400">
            {when.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
          {/* Custom reminder — let users set their OWN reminder on top of
              the system 7d/3d/1d windows. Especially useful for "remind me
              30 min before so I can join Zoom" type personal reminders. */}
          <RemindMeButton
            targetKind="meeting"
            targetId={id}
            defaultTitle={`${m.locality ?? m.state} ${m.body_name ?? "meeting"} — kratom on agenda`}
            defaultMessage={m.zoom_url ? `Join Zoom: ${m.zoom_url}` : (m.livestream_url ? `Watch live: ${m.livestream_url}` : "Public hearing — show up or sign up to speak")}
          />
        </div>
      </header>

      {/* Primary CTAs — large + thumby */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        {m.livestream_url && (
          <a href={m.livestream_url} target="_blank" rel="noopener noreferrer"
            className="block rounded-lg border border-red-700/50 bg-red-950/20 p-5 hover:border-red-500">
            <p className="text-2xl">📺</p>
            <p className="mt-2 text-lg font-bold text-red-200">Watch livestream</p>
            <p className="mt-1 text-xs text-red-300/80 break-all">{m.livestream_url.slice(0, 60)}…</p>
          </a>
        )}
        {m.zoom_url && (
          <a href={m.zoom_url} target="_blank" rel="noopener noreferrer"
            className="block rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-5 hover:border-emerald-500">
            <p className="text-2xl">📹</p>
            <p className="mt-2 text-lg font-bold text-emerald-200">Join Zoom</p>
            <p className="mt-1 text-xs text-emerald-300/80 break-all">{m.zoom_url.slice(0, 60)}…</p>
          </a>
        )}
        {m.agenda_url && (
          <a href={m.agenda_url} target="_blank" rel="noopener noreferrer"
            className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 hover:border-emerald-500">
            <p className="text-2xl">📄</p>
            <p className="mt-2 text-lg font-bold text-zinc-200">View agenda</p>
          </a>
        )}
        {m.public_comment_signup_url && (
          <a href={m.public_comment_signup_url} target="_blank" rel="noopener noreferrer"
            className="block rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 hover:border-amber-500">
            <p className="text-2xl">🎤</p>
            <p className="mt-2 text-lg font-bold text-amber-200">Sign up to speak</p>
          </a>
        )}
        {m.in_person_address && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(m.in_person_address)}`}
            target="_blank" rel="noopener noreferrer"
            className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 hover:border-emerald-500"
          >
            <p className="text-2xl">📍</p>
            <p className="mt-2 text-lg font-bold text-zinc-200">In person · get directions</p>
            <p className="mt-1 text-xs text-zinc-400">{m.in_person_address}</p>
          </a>
        )}
      </section>

      {/* Add-to-calendar button — single-event .ics download lets the
          user one-tap add this meeting to their phone's native
          calendar so they get a reminder before it starts. */}
      <section className="mb-6 flex flex-wrap gap-2 text-xs">
        <a href={`/meetings/${m.id}/event.ics`} download={`ikratom-${m.id}.ics`}
          className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-500">
          📅 Add to my calendar
        </a>
        <a href={`webcal://${(process.env.NEXT_PUBLIC_APP_URL ?? "www.ikratom.org").replace(/^https?:\/\//, "")}/meetings/${m.id}/event.ics`}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 hover:border-emerald-500">
          📲 Apple Calendar
        </a>
        <a href={`https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${m.locality ?? m.state} ${m.body_name ?? "meeting"} — kratom on agenda`)}&dates=${formatGoogleDate(when)}/${formatGoogleDate(new Date(when.getTime() + 2 * 60 * 60 * 1000))}&details=${encodeURIComponent(`Detail: ${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ikratom.org"}/meetings/${m.id}\n\n${m.agenda_text ?? ""}`.slice(0, 800))}${m.in_person_address ? `&location=${encodeURIComponent(m.in_person_address)}` : ""}`}
          target="_blank" rel="noopener noreferrer"
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 hover:border-emerald-500">
          📲 Google Calendar
        </a>
      </section>

      {/* What's on the agenda */}
      {m.agenda_text && (
        <section className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            On the agenda
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
            {m.agenda_text}
          </p>
        </section>
      )}

      {/* Cross-actions */}
      <section className="mb-6 rounded-md border border-emerald-700/30 bg-emerald-950/10 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
          What advocates can do RIGHT NOW
        </h2>
        <ul className="mt-2 space-y-1 text-sm text-zinc-300">
          <li>👂 <strong>Watch</strong> the livestream so you know what's said in your name</li>
          <li>📞 <strong>Call</strong> a county legislator — <Link href={`/calls?state=${m.state}`} className="text-emerald-400 hover:underline">your in-state targets</Link></li>
          <li>🎤 <strong>Sign up to give public comment</strong> if a comment window exists (linked above)</li>
          <li>📨 <strong>Share this page</strong> on social so more advocates show up to the next one</li>
        </ul>
      </section>

      {/* Signup nudge — meeting pages convert well: visitor already
          intends to attend or follow this specific meeting. Reminder
          push is a concrete value-add. */}
      <SignUpNudge context="meeting" stateCode={m.state} className="mb-6" />
      <EnablePushNudge context="meeting" stateCode={m.state} className="mb-6" />

      {/* Cross-links */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Link href={`/calendar?state=${m.state}`} className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">
          📅 {m.state} calendar
        </Link>
        <Link href={`/briefings/state/${m.state}`} className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">
          📋 {m.state} briefing
        </Link>
        <Link href={`/pulse`} className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">
          🚨 Live pulse feed
        </Link>
      </div>
    </div>
  );
}
