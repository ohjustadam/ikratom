"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelGroupEvent, createGroupEvent, rsvpGroupEvent } from "@/modules/coalitions/event-actions";
import { EVENT_KINDS, EVENT_KIND_LABEL, type EventKind } from "@/modules/coalitions/events";

/** Group events, interactive half (migration 0283). Big tap targets: most members are on a phone. */

export type RsvpStatus = "going" | "maybe" | "no";

const input = "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-base text-zinc-100 focus:border-emerald-500 focus:outline-none sm:text-sm";
const OPTIONS: { status: RsvpStatus; label: string }[] = [
  { status: "going", label: "✓ Going" },
  { status: "maybe", label: "Maybe" },
  { status: "no", label: "Can't" },
];

export function RsvpButtons({ slug, eventId, current, compact = false }: {
  slug: string; eventId: string; current: RsvpStatus | null; compact?: boolean;
}) {
  const router = useRouter();
  const [mine, setMine] = useState<RsvpStatus | null>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className={compact ? "mt-2" : "mt-4"}>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="RSVP">
        {OPTIONS.map((o) => {
          const on = mine === o.status;
          return (
            <button key={o.status} type="button" disabled={pending} aria-pressed={on}
              onClick={() => start(async () => {
                setError(null);
                const next = on ? null : o.status;
                const r = await rsvpGroupEvent(slug, eventId, next);
                if (!r.ok) { setError(r.error); return; }
                setMine(next);
                router.refresh();
              })}
              className={`min-h-11 rounded-md border px-2 text-sm font-semibold disabled:opacity-50 ${
                on
                  ? o.status === "going" ? "border-emerald-500 bg-emerald-500 text-zinc-950" : "border-zinc-400 bg-zinc-200 text-zinc-950"
                  : "border-zinc-700 text-zinc-300 hover:border-emerald-500"
              }`}>
              {o.label}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1 text-xs text-amber-300">{error}</p>}
    </div>
  );
}

export function NewEventForm({ slug, featured, initialOpen = false }: {
  slug: string; featured: { slug: string; title: string } | null; initialOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [kind, setKind] = useState<EventKind>("call_in");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [minutes, setMinutes] = useState(60);
  const [location, setLocation] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [details, setDetails] = useState("");
  const [useAction, setUseAction] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-11 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
        + Plan an event
      </button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date || !time) { setError("Pick a date and time."); return; }
    // datetime-local semantics: the organizer's own clock, sent as an instant plus their zone.
    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) { setError("Pick a date and time."); return; }
    start(async () => {
      const r = await createGroupEvent(slug, {
        kind, title, details, location, linkUrl,
        startsAt: startsAt.toISOString(),
        durationMinutes: minutes,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        campaignSlug: featured && useAction ? featured.slug : null,
      });
      if (!r.ok) { setError(r.error); return; }
      router.push(`/coalitions/${slug}/events/${r.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <h3 className="text-sm font-bold text-zinc-200">Plan an event</h3>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of event">
        {EVENT_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`min-h-10 rounded-full border px-3 text-xs ${kind === k ? "border-emerald-500 bg-emerald-500/15 text-emerald-200" : "border-zinc-700 text-zinc-400"}`}>
            {EVENT_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required aria-label="Event title"
        placeholder={kind === "call_in" ? "Call-in day: tell the committee to vote no" : "Title"} className={input} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-zinc-500">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={`${input} mt-1`} />
        </label>
        <label className="text-[11px] text-zinc-500">Start time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required className={`${input} mt-1`} />
        </label>
      </div>
      <label className="block text-[11px] text-zinc-500">How long
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={`${input} mt-1`}>
          {[30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`}</option>)}
        </select>
      </label>
      <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} aria-label="Where"
        placeholder={kind === "call_in" ? "Where: from home, by phone" : "Where (address, or Online)"} className={input} />
      <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} maxLength={500} type="url" inputMode="url" aria-label="Link"
        placeholder="Link (optional): Zoom, livestream, sign-up sheet" className={input} />
      <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={3} aria-label="Details"
        placeholder="What should people do or bring?" className={input} />
      {featured && (
        <label className="flex items-start gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={useAction} onChange={(e) => setUseAction(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>Link this week&apos;s group action, <strong>{featured.title}</strong>, so members can act from the event in one tap.</span>
        </label>
      )}
      <p className="text-[11px] text-zinc-500">Every member gets a notice. Anyone who RSVPs gets a reminder the day before and again shortly before it starts.</p>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="min-h-11 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40">
          {pending ? "Posting…" : "Post event"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
      </div>
    </form>
  );
}

export function CancelEventButton({ slug, eventId }: { slug: string; eventId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirming) {
    return <button type="button" onClick={() => setConfirming(true)} className="text-xs text-zinc-500 hover:text-red-300">Cancel this event</button>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="text-zinc-300">Cancel it and tell everyone who RSVP&apos;d?</span>
      <button type="button" disabled={pending} className="rounded border border-red-700 px-2 py-1 text-red-300 hover:bg-red-950/40"
        onClick={() => start(async () => {
          const r = await cancelGroupEvent(slug, eventId);
          if (!r.ok) { setError(r.error); return; }
          router.push(`/coalitions/${slug}#events`);
        })}>
        {pending ? "Cancelling…" : "Yes, cancel"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-zinc-500">Keep it</button>
      {error && <span className="text-amber-300">{error}</span>}
    </span>
  );
}
