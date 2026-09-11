"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useChrome } from "@/components/chrome/ChromeProvider";
import { SignUpNudge } from "@/components/SignUpNudge";
import { buildEvents } from "./build-events";
import { CalendarFilters } from "./CalendarFilters";
import { CalendarHeader } from "./CalendarHeader";
import { EventList } from "./EventList";
import { MonthGrid } from "./MonthGrid";
import { etYmd, type CalendarEvent, type CalendarSnapshot, type MkHrefOpts } from "./types";

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
const KINDS = ["election", "townhall", "municipal", "alert", "bill_action",
  "bill_effective", "bill_sunset", "local_vote", "state_session"] as const;

/**
 * Everything about /calendar that varies per viewer or per URL.
 *
 * WHY (2026-09-10 egress work). The page was force-dynamic and read BOTH
 * cookies (getCachedAuthProfile + a profiles row, purely to geofence elections
 * to the viewer's home state) and searchParams (state/kind/view/month/day).
 * Either one alone forces a per-request render, so every crawler hit re-ran
 * the whole calendar — and the traffic on this class of page is ~99.97% bots.
 *
 * The home state now comes from the single /api/me chrome read real browsers
 * already make; crawlers never run it. Search params are read here. The event
 * snapshot itself is public and identical for everyone, so it stays in the
 * cached page. Nothing per-user is baked into the HTML: the geofence is a
 * convenience filter over public election rows, not an access control.
 */
export function CalendarView({ snapshot, renderedAtIso }: {
  snapshot: CalendarSnapshot;
  renderedAtIso: string;
}) {
  const sp = useSearchParams();
  const { me, loading } = useChrome();

  // "Now" must agree between the prerendered HTML and the first client render
  // or React reports a hydration mismatch. Start from the server's render
  // instant, then correct to the reader's real clock after mount.
  const [nowMs, setNowMs] = useState(() => Date.parse(renderedAtIso));
  useEffect(() => setNowMs(Date.now()), []);

  const stateParam = (sp.get("state") ?? "").toUpperCase();
  const stateFilter = /^[A-Z]{2}$/.test(stateParam) ? stateParam : null;
  const kindFilter = sp.get("kind") || null;
  const view: "list" | "month" = sp.get("view") === "month" ? "month" : "list";
  const monthParam = sp.get("month") ?? "";
  const dayParam = sp.get("day") ?? "";

  // Geofence elections to the viewer's state: an explicit ?state= wins, else
  // the signed-in user's profile state (from the chrome read). National-scope
  // elections show to all; state elections only when they match.
  const userState = me?.state ? String(me.state).toUpperCase() : null;
  const viewerState = stateFilter ?? userState;

  const events = useMemo(
    () => buildEvents(snapshot, viewerState, nowMs),
    [snapshot, viewerState, nowMs],
  );

  // Filters + sort. Elections are pre-geofenced above; keep national elections
  // (state === null) visible even under a ?state= filter.
  const filtered = useMemo(() => {
    let f = events;
    if (stateFilter) {
      f = f.filter((e) =>
        e.kind === "election" ? e.state === null || e.state === stateFilter : e.state === stateFilter,
      );
    }
    if (kindFilter) f = f.filter((e) => e.kind === kindFilter);
    return [...f].sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events, stateFilter, kindFilter]);

  // Bucket by Eastern calendar day — drives both the list groups and the month
  // grid cells (same source of truth so the two views always agree).
  const groups = useMemo(() => {
    const g = new Map<string, CalendarEvent[]>();
    for (const e of filtered) {
      const k = etYmd(e.date);
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(e);
    }
    return g;
  }, [filtered]);

  const todayYmd = etYmd(new Date(nowMs));
  const displayMonth = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : todayYmd.slice(0, 7);
  const selectedDay =
    /^\d{4}-\d{2}-\d{2}$/.test(dayParam) && dayParam.startsWith(displayMonth) ? dayParam :
    todayYmd.startsWith(displayMonth) ? todayYmd : `${displayMonth}-01`;
  const monthBuckets = new Map([...groups].filter(([k]) => k.startsWith(displayMonth)));

  const stateOptions = [...new Set(events.map((e) => e.state).filter(Boolean) as string[])].sort();
  const counts = Object.fromEntries(
    KINDS.map((k) => [k, events.filter((e) => e.kind === k).length]),
  ) as Record<string, number>;

  // Feed (.ics) subscribe URLs — the current state/kind filter carries through
  // so a user subscribes to exactly the slice they're viewing.
  const feedQs = new URLSearchParams();
  if (viewerState) feedQs.set("state", viewerState);
  if (kindFilter) feedQs.set("kind", kindFilter);
  const feedHttps = `${SITE}/calendar/feed.ics${feedQs.toString() ? `?${feedQs}` : ""}`;
  const feedScope = [viewerState, kindFilter ? kindFilter.replace("_", " ") : null]
    .filter(Boolean).join(" · ") || "every event";

  // Build a /calendar href preserving the current state/kind/view/month, with
  // per-call overrides. Pass null to clear a param (e.g. view:null → list).
  const mkHref = (o: MkHrefOpts = {}) => {
    const v = o.view !== undefined ? o.view : (view === "month" ? "month" : null);
    const p = new URLSearchParams();
    const st = o.state !== undefined ? o.state : stateFilter;
    const k = o.kind !== undefined ? o.kind : kindFilter;
    const mo = o.month !== undefined ? o.month : (v === "month" ? displayMonth : null);
    const dy = o.day !== undefined ? o.day : null;
    if (st) p.set("state", st);
    if (k) p.set("kind", k);
    if (v) p.set("view", v);
    if (mo) p.set("month", mo);
    if (dy) p.set("day", dy);
    return `/calendar${p.toString() ? `?${p}` : ""}`;
  };

  // State-scoped elections exist but are hidden because the viewer has no
  // resolved state. Held back until the chrome read lands, so a signed-in user
  // with a state never sees it flash.
  const hasHiddenStateElections =
    !loading && !viewerState && snapshot.elections.some((el) => el.scope !== "national");

  return (
    <>
      <CalendarHeader
        feedHttps={feedHttps}
        feedWebcal={feedHttps.replace(/^https?:/, "webcal:")}
        feedGoogle={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedHttps)}`}
        feedScope={feedScope}
        eventCount={events.length}
        stateCount={stateOptions.length}
      />

      {/* Signup nudge — calendar viewers want push reminders, not just .ics */}
      <SignUpNudge context="calendar" stateCode={stateFilter ?? undefined} className="mb-6" />

      {/* Election geofence nudge — explain why only national elections show
          and point the viewer at the one setting that unlocks their primaries. */}
      {hasHiddenStateElections && (
        <div className="mb-6 rounded-md border border-violet-700/40 bg-violet-950/15 px-3 py-2 text-xs text-violet-200">
          🗳️ You&apos;re seeing national election dates.{" "}
          {me?.userId ? (
            <>Set your state in your <Link href="/account" className="font-semibold underline hover:text-violet-100">account</Link> to see your state&apos;s primary + local elections and get voting reminders.</>
          ) : (
            <>Sign in and set your state to see your primary dates and get voting reminders.</>
          )}
        </div>
      )}

      <CalendarFilters
        view={view}
        kindFilter={kindFilter}
        stateFilter={stateFilter}
        displayMonth={displayMonth}
        totalCount={events.length}
        counts={counts}
        stateOptions={stateOptions}
        mkHref={mkHref}
      />

      {view === "month" ? (
        <MonthGrid
          displayMonth={displayMonth}
          todayYmd={todayYmd}
          selectedDay={selectedDay}
          buckets={monthBuckets}
          mkHref={mkHref}
        />
      ) : (
        <EventList groups={groups} todayYmd={todayYmd} hasFilters={!!(stateFilter || kindFilter)} />
      )}
    </>
  );
}
