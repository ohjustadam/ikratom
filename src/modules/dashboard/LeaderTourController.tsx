"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
// driver.js is lazy-imported inside the effect (below) so its ~30KB never ships
// in the initial client bundle — this component mounts in the ROOT layout, so a
// static import would load driver.js on every page for every visitor. `Driver`
// is a type-only import (erased at build), so it adds no runtime weight.
import type { Driver } from "driver.js";
import { acknowledgeLeaderRules } from "@/modules/admin/user-actions";

/**
 * LeaderTourController — multi-page tour that persists across
 * navigation via localStorage. Mounts in root layout so it fires
 * on the first page any leader visits after promotion.
 *
 * Flow:
 *   1. /dashboard — welcome + intro
 *   2. Click "Continue: Author campaigns →" → router.push("/admin/campaigns")
 *      + persist {pageKey: 'campaigns', completedPages: ['dashboard']} to LS
 *   3. On arrival at /admin/campaigns the controller re-runs the
 *      effect (pathname dep), finds the page in TOUR_PAGES, fires
 *      the campaigns steps
 *   4. Same for /admin/forum, /admin/locals, /leader
 *   5. Final step: required-checkbox acknowledgment
 *
 * Bug fix vs prior version: `onDestroyed` was firing for BOTH user-
 * completion AND React useEffect-cleanup (when pathname changes).
 * The cleanup-fired onDestroyed was re-saving state + re-routing,
 * which raced the new page's tour-fire and skipped past it. Now
 * we use a `finishedRef` set ONLY when the user actually completes
 * the last step; cleanup destroys see finishedRef=false and no-op.
 */

const LS_KEY = "ikratom:leader-tour:v4";

type TourState = {
  pageKey: string;
  completedPages: string[];
  /** Started from "Replay a tutorial": runs even after the rules were signed. */
  replay?: boolean;
};

/**
 * Start the walkthrough again from the dashboard. The tour normally runs only
 * while leader_tour_pending is set and the rules are unsigned, so a leader who
 * finished it had no way back in; the old ?replay=leader link did nothing.
 */
export function startLeaderTourReplay() {
  saveState({ pageKey: "dashboard", completedPages: [], replay: true });
  window.location.assign("/dashboard");
}

type PageSteps = {
  pageKey: string;
  matchesPath: (p: string) => boolean;
  navigateTo: string;
  label: string;
  steps: Array<{ title: string; description: string }>;
};

const TOUR_PAGES: PageSteps[] = [
  {
    pageKey: "dashboard",
    matchesPath: (p) => p === "/dashboard" || p === "/",
    navigateTo: "/dashboard",
    label: "Dashboard",
    steps: [
      {
        title: "🎖 Welcome, leader",
        description:
          "Thank you for stepping up. This walkthrough takes about two minutes and visits each leader tool. It ends with a short promise to sign, which unlocks Field signup. Use Next to move on.",
      },
      {
        title: "Your dashboard",
        description:
          "Your dashboard stays the same as every member's. The Share it box at the top is the fastest way to bring in news: paste a link and we tell you if we already have it. Your leader tools live on the Leader workshop, linked from the menu. Next: campaigns.",
      },
    ],
  },
  {
    pageKey: "campaigns",
    matchesPath: (p) => p === "/admin/campaigns" || p.startsWith("/admin/campaigns/"),
    navigateTo: "/admin/campaigns",
    label: "Write campaigns",
    steps: [
      {
        title: "📣 Writing campaigns",
        description:
          "Write a call to action for any state: who should get the letter, and the letter itself. Placeholders like {{full_name}}, {{city}} and {{legislator_name}} fill in for each member who sends it. When you submit, an admin checks it before it goes live. You can't publish on your own, and that's on purpose. Want it slower? Step-by-step help is linked at the top of each campaign screen.",
      },
      {
        title: "What you can target",
        description:
          "State senators and representatives, members of Congress, and city or county officials. Pick by role, state and town. Once your campaign is live you can schedule a wave on it: a set time when everyone who signs up sends together.",
      },
      {
        title: "Rules for campaigns",
        description:
          "1. Nonpartisan. Never endorse a candidate or a party.<br/>2. No personal attacks on any official.<br/>3. Keep natural-leaf kratom separate from 7-OH products. That's platform policy.<br/>4. Point to a real bill or alert. Never invent urgency.<br/>5. Members send from their own email and sign their own name, so write something they're proud to sign.",
      },
    ],
  },
  {
    pageKey: "forum",
    matchesPath: (p) => p === "/admin/forum",
    navigateTo: "/admin/forum",
    label: "Keep the forum safe",
    steps: [
      {
        title: "💬 The forum queue",
        description:
          "Posts the filters held back (links, phone numbers, spam patterns, a new account's first posts) and posts members reported. Approve the ones that are fine and hide the ones that aren't. Reports from groups and photos come in at Moderation.",
      },
      {
        title: "What you can do",
        description:
          "✓ Approve a held post<br/>✓ Hide a post or thread (it isn't deleted, and an admin can bring it back)<br/>✓ Lock or pin a thread<br/>✓ Escalate to an admin when you're unsure",
      },
      {
        title: "What only admins do",
        description:
          "✗ Change someone's words. We don't put words in people's mouths; when an admin corrects a post it says so.<br/>✗ Act on an admin's or the owner's posts<br/>✗ Lock or ban accounts",
      },
      {
        title: "Moderation rules",
        description:
          "1. The same standard for everyone, whatever their view.<br/>2. Hide personal attacks, spam, doxxing and undisclosed selling.<br/>3. Leave strong disagreement, blunt words and anger at policy alone. Free speech tilts the scale.<br/>4. When in doubt, escalate. Don't decide hard cases alone.<br/>5. Every action is logged to your account.",
      },
    ],
  },
  {
    pageKey: "locals",
    matchesPath: (p) => p === "/admin/locals" || p.startsWith("/admin/locals/"),
    navigateTo: "/admin/locals",
    label: "Add local officials",
    steps: [
      {
        title: "🏛 Local officials",
        description:
          "When a city or county takes up kratom, add its mayor and council here so campaigns can reach them. AI suggest pulls the roster from the city's own public records when it can, and you check it before anything is saved. Your local knowledge still beats any search.",
      },
      {
        title: "Rules for local contacts",
        description:
          "1. Only contact details the official published (city website, agenda).<br/>2. Never a personal cell or home address, even if you know it.<br/>3. Prefer the official city or county email address.<br/>4. If an official's website is dead or parked, leave it blank.",
      },
    ],
  },
  {
    pageKey: "workshop",
    matchesPath: (p) => p === "/leader",
    navigateTo: "/leader",
    label: "Leader workshop",
    steps: [
      {
        title: "🛠 Leader workshop",
        description:
          "Your home base: Field signup for booths and events, your campaigns, local officials and the moderation queues, all in one place. Bookmark it.",
      },
      {
        title: "Your recruits",
        description:
          "People you sign up with Field signup show here by @username, with whether they've taken action yet. You only see your own recruits, never another leader's.",
      },
    ],
  },
  // Final acknowledgment — opens a custom modal with required checkbox
  {
    pageKey: "acknowledge",
    matchesPath: (p) => p === "/account",
    navigateTo: "/account",
    label: "Agree to the leader rules",
    steps: [
      {
        title: "📋 Last step",
        description:
          "Click Next to see the leader rules once more and agree with a checkbox. That unlocks Field signup.",
      },
    ],
  },
];

function loadState(): TourState {
  if (typeof window === "undefined") return { pageKey: "dashboard", completedPages: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { pageKey: "dashboard", completedPages: [] };
    return JSON.parse(raw) as TourState;
  } catch {
    return { pageKey: "dashboard", completedPages: [] };
  }
}

function saveState(s: TourState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* no-op */ }
}

function clearState() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(LS_KEY); } catch { /* no-op */ }
}

export function LeaderTourController({
  pending,
  alreadyAcknowledged,
}: {
  pending: boolean;
  alreadyAcknowledged: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const driverRef = useRef<Driver | null>(null);
  // True only when the user clicks Next on the last step of a page.
  // Cleanup-triggered destroys (pathname change) see this as false
  // and skip navigation, which fixes the "Open Campaigns doesn't
  // continue walkthrough" bug.
  const finishedRef = useRef(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [ackSubmitting, setAckSubmitting] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const state = loadState();
    const replaying = !!state.replay;
    if (!replaying && (alreadyAcknowledged || !pending)) {
      clearState();
      return;
    }

    const currentPage = TOUR_PAGES.find((p) => p.matchesPath(pathname));
    if (!currentPage) return;
    if (state.completedPages.includes(currentPage.pageKey)) return;

    const pageIdx = TOUR_PAGES.findIndex((p) => p.pageKey === currentPage.pageKey);
    const isLastPage = pageIdx === TOUR_PAGES.length - 1;
    const nextPage = TOUR_PAGES[pageIdx + 1];

    finishedRef.current = false;

    let cancelled = false;
    void (async () => {
    const { driver } = await import("driver.js");
    await import("driver.js/dist/driver.css");
    if (cancelled) return;
    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: false,
      overlayOpacity: 0.6,
      stagePadding: 4,
      stageRadius: 8,
      nextBtnText: "Next →",
      prevBtnText: "Back",
      doneBtnText: isLastPage ? "Open acknowledgment →" : `Continue: ${nextPage?.label ?? "Done"} →`,
      onDestroyed: () => {
        // ONLY navigate if the user finished this page's steps via the
        // Next/Done button. The useEffect cleanup also calls destroy()
        // when pathname changes — that path leaves finishedRef=false
        // so we no-op (preventing the original double-navigation bug
        // that broke the multi-page flow).
        if (!finishedRef.current) return;
        finishedRef.current = false;

        const newState: TourState = {
          ...state,
          completedPages: [...new Set([...state.completedPages, currentPage.pageKey])],
          pageKey: nextPage?.pageKey ?? "acknowledge",
        };
        saveState(newState);

        if (isLastPage) {
          // A replay by someone who already signed ends here, no form.
          if (replaying && alreadyAcknowledged) {
            clearState();
            return;
          }
          setAckOpen(true);
          return;
        }
        if (nextPage) router.push(nextPage.navigateTo);
      },
      // Hook the Next button click directly (driver.js v1 callback).
      // Previous attempt patched d.moveNext after init — but driver.js
      // doesn't always route the Done button click through moveNext
      // (it can destroy directly on the last step). onNextClick fires
      // for EVERY Next button click reliably.
      onNextClick: (_el, _step, opts) => {
        const total = currentPage.steps.length;
        const activeIdx = opts.state?.activeIndex ?? 0;
        if (activeIdx >= total - 1) {
          // User clicked the Done button on the last step
          finishedRef.current = true;
          opts.driver.destroy();
        } else {
          opts.driver.moveNext();
        }
      },
      onPrevClick: (_el, _step, opts) => {
        opts.driver.movePrevious();
      },
      steps: currentPage.steps.map((s) => ({
        popover: { title: s.title, description: s.description },
      })),
    });

    driverRef.current = d;
    d.drive();
    })();

    return () => {
      // Cleanup destroy. finishedRef intentionally NOT set here so
      // onDestroyed no-ops — that's the bug fix. `cancelled` guards the
      // async driver.js import resolving after this effect already tore down.
      cancelled = true;
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, [pathname, pending, alreadyAcknowledged, router]);

  async function submitAcknowledgment() {
    if (!ackChecked) {
      setAckError("You must check the box to acknowledge.");
      return;
    }
    setAckError(null);
    setAckSubmitting(true);
    startTransition(async () => {
      const r = await acknowledgeLeaderRules();
      if ("error" in r && r.error) {
        setAckError(r.error);
        setAckSubmitting(false);
        return;
      }
      clearState();
      setAckOpen(false);
      setAckSubmitting(false);
      router.refresh();
    });
  }

  if (!ackOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-lg border border-emerald-700/60 bg-zinc-950 p-6 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">📋 Final step</p>
        <h2 className="mt-2 text-2xl font-bold">Acknowledge leader rules</h2>
        <div className="mt-4 space-y-2 text-sm text-zinc-300">
          <p>By clicking I AGREE below, you confirm you&apos;ve read the walkthrough and agree to:</p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li>Nonpartisan messaging in all campaigns you author</li>
            <li>Apply moderation standards uniformly regardless of stance</li>
            <li>Escalate uncertainty to an admin instead of deciding hard cases solo</li>
            <li>Use only publicly-available contact info for local officials</li>
            <li>Treat your recruits&apos; information as confidential</li>
            <li>Every leader action is logged to your account</li>
          </ul>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <input
            type="checkbox"
            checked={ackChecked}
            onChange={(e) => setAckChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          <span className="text-sm text-zinc-200">
            I have read the leader walkthrough and I agree to follow these rules. I understand
            that my actions as a leader are logged and that the owner may review them or
            remove this role at any time.
          </span>
        </label>

        {ackError && (
          <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">
            {ackError}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={submitAcknowledgment}
            disabled={!ackChecked || ackSubmitting}
            className="rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ackSubmitting ? "Submitting…" : "I AGREE — complete tour"}
          </button>
          <button
            onClick={() => setAckOpen(false)}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
          >
            Not yet
          </button>
        </div>

        <p className="mt-4 text-[11px] text-zinc-500">
          Field signup stays locked until you agree. Closing this keeps the reminder at the top
          of each page.
        </p>
      </div>
    </div>
  );
}
