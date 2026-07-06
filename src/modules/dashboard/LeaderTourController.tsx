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
};

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
        title: "🎖 Welcome to Leader",
        description:
          "An admin promoted you. This walkthrough takes 90 seconds and ends with a rules acknowledgment you'll need to sign before unlocking the rest of the leader tools. Use the Next button to advance.",
      },
      {
        title: "Your dashboard",
        description:
          "This is the same dashboard every user sees, plus a few leader-only cards. The tour will jump you to each new surface in order. Click Next to head to Campaigns.",
      },
    ],
  },
  {
    pageKey: "campaigns",
    matchesPath: (p) => p === "/admin/campaigns" || p.startsWith("/admin/campaigns/"),
    navigateTo: "/admin/campaigns",
    label: "Author campaigns",
    steps: [
      {
        title: "📣 Authoring campaigns",
        description:
          "Leaders can draft call-to-action campaigns for any state. You write the email template (with placeholders like {{full_name}}, {{state}}, {{legislator_name}}). When you save, the campaign lands in pending_review — an admin approves before it goes live. You CANNOT publish directly; that's by design.",
      },
      {
        title: "What you can target",
        description:
          "State legislators (Senate + House), city + county officials, federal reps — pick combos by role + state + locality. Auto-generated campaigns from intel alerts also land here; you can review + edit those before activation.",
      },
      {
        title: "Rules for campaign authoring",
        description:
          "1. Nonpartisan tone — never endorse candidates or parties.<br/>2. No personal attacks on legislators.<br/>3. Distinguish natural-leaf kratom from 7-OH-enriched products in your messaging — this is platform policy.<br/>4. Cite a real bill or alert — don't make up urgency.<br/>5. Templates are sent via the user's own email; they sign their real name.",
      },
    ],
  },
  {
    pageKey: "forum",
    matchesPath: (p) => p === "/admin/forum",
    navigateTo: "/admin/forum",
    label: "Moderate the forum",
    steps: [
      {
        title: "💬 Forum moderation queue",
        description:
          "This shows posts auto-flagged for review (new-account spam patterns, links from low-trust accounts, keyword matches) plus user-reported content. As a leader you can: approve, hide, or escalate to an admin.",
      },
      {
        title: "What you CAN do",
        description:
          "✓ Approve a flagged post that's clean<br/>✓ Hide a post (soft delete; admin can restore)<br/>✓ Add a moderation note for context<br/>✓ Escalate to admin if you're uncertain",
      },
      {
        title: "What you CANNOT do",
        description:
          "✗ Permanently delete posts (admin only)<br/>✗ Ban users (admin only — escalate instead)<br/>✗ Edit a user's post content (we don't put words in people's mouths)<br/>✗ Override another moderator's recent decision without admin review",
      },
      {
        title: "Moderation rules",
        description:
          "1. Apply the same standard to every user regardless of stance.<br/>2. Personal attacks, spam, doxing, vendor promo without disclosure → hide.<br/>3. Strong disagreement, blunt language, anger at policy → leave alone. Free speech tilts the scale here.<br/>4. When in doubt, escalate. Don't decide hard cases solo.<br/>5. Every action is audit-logged with your name.",
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
          "When a city/county bill comes up in your area, you can add the local mayor + council members here so campaigns can target them. The platform also auto-pulls these via Gemini Search when a municipal bill is detected — but your local knowledge is more accurate than any LLM.",
      },
      {
        title: "Rules for local-rep data",
        description:
          "1. Only contact info that's PUBLICLY published (city website, official agenda).<br/>2. Never list a personal cell or home address even if you know it.<br/>3. Email format: prefer @cityof[X].gov over personal aliases.<br/>4. If a member's website is a parked domain, leave it null. The system warns advocates not to click bad URLs.",
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
          "Your home base for field-work tools (most are 'coming soon'). Field signup, booth recruitment, business outreach, hearing turnout coordination. Bookmark this page.",
      },
      {
        title: "Your recruits",
        description:
          "Once Field Signup ships, advocates you onboard at events / booths / door-to-door will appear here. You'll see their consent status, their activity, and whether they've taken any campaign actions. Privacy: leaders only see their own recruits, never other leaders'.",
      },
    ],
  },
  // Final acknowledgment — opens a custom modal with required checkbox
  {
    pageKey: "acknowledge",
    matchesPath: (p) => p === "/account",
    navigateTo: "/account",
    label: "Acknowledge the rules",
    steps: [
      {
        title: "📋 Last step — acknowledge the rules",
        description:
          "Almost done. Click Next to open the acknowledgment form. You'll review the leader rules one more time and sign with a checkbox — that unlocks the rest of your leader functions.",
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
    if (alreadyAcknowledged || !pending) {
      clearState();
      return;
    }
    if (typeof window === "undefined") return;

    const state = loadState();
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
            <li>Every leader action is audit-logged with your name</li>
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
            that my actions as a leader are logged and that admins may review or revoke this
            role at any time.
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
          You can&apos;t exercise leader functions until you complete this. Closing this without
          agreeing leaves the reminder banner active on every page.
        </p>
      </div>
    </div>
  );
}
