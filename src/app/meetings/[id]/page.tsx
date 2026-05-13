import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ id: string }> };

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";

// Per-meeting metadata so the page has rich Open Graph + Twitter
// cards for Facebook Messenger / iMessage / SMS / Slack / Twitter
// link previews. The og-image is dynamically generated at /meetings/[id]/opengraph-image.
export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const sb = await createClient();
  const { data: m } = await sb
    .from("municipal_meetings")
    .select("state, locality, body_name, meeting_at, agenda_text")
    .eq("id", id)
    .maybeSingle();

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
  const sb = await createClient();
  const { data: m } = await sb
    .from("municipal_meetings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!m || m.moderation_status !== "approved") notFound();

  const when = new Date(m.meeting_at);
  const now = Date.now();
  const sinceStartMs = now - when.getTime();
  const isLive = sinceStartMs >= 0 && sinceStartMs < 6 * 60 * 60 * 1000; // last 6h = "live"
  const minsAgo = Math.floor(sinceStartMs / 60_000);
  const daysFromNow = Math.ceil((when.getTime() - now) / 86_400_000);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
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
        <p className="mt-2 text-sm text-zinc-400">
          {when.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
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
