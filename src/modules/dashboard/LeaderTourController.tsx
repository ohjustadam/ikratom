"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { acknowledgeLeaderRules, clearLeaderTourPending } from "@/modules/admin/user-actions";

/**
 * LeaderTourController — multi-page tour that persists across
 * navigation via localStorage. Fires for anyone with
 * leader_tour_pending=true on any page they visit.
 *
 * Flow:
 *   1. Step 0 on /dashboard (or wherever they land) — welcome
 *   2. Click "Go to Campaigns" → router.push("/admin/campaigns")
 *      + persist {pendingPage: '/admin/campaigns', stepIdx: next} to LS
 *   3. On arrival at /admin/campaigns the controller resumes from
 *      stepIdx, runs the page-specific tour, then advances
 *   4. Same for /admin/forum, /admin/locals, /leader
 *   5. Final step: required-checkbox acknowledgment → server action
 *      sets leader_acknowledged_at, banner disappears
 *
 * If the user clicks an external link or escapes the tour, the
 * leader_tour_pending flag stays true so the next time they visit
 * any page the tour resumes from where they left off.
 *
 * Replay: any leader can hit /account?replay-leader-tour to reset.
 */

const LS_KEY = "ikratom:leader-tour:v2";

type TourState = {
  // Page-relative step index. Each page in the flow has its own
  // step set; the controller advances through the global sequence.
  pageKey: string;
  stepIdx: number;
  // Track which pages have been completed so we don't replay them
  completedPages: string[];
};

type PageSteps = {
  pageKey: string;
  matchesPath: (p: string) => boolean;
  navigateTo: string;
  label: string;
  steps: Array<{
    element?: string;
    title: string;
    description: string;
    side?: "top" | "right" | "bottom" | "left";
  }>;
};

// The page-by-page tour. Each `element` is a CSS selector; if null,
// the popover floats center-screen for that step.
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
          "An admin promoted you. This walkthrough takes 90 seconds and ends with a rules acknowledgment you'll need to sign before unlocking the rest of the leader tools. Use the buttons below — don't click links inside descriptions; they'll break the tour.",
      },
      {
        title: "Your dashboard",
        description:
          "This is the same dashboard every user sees, plus a few leader-only cards. The tour will jump you to each new surface — Campaign authoring, Forum moderation, the Leader workshop — in order. Stay with me.",
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
        title: "Authoring campaigns",
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
          "1. Nonpartisan tone — never endorse candidates or parties.<br/>2. No personal attacks on legislators.<br/>3. Distinguish natural-leaf kratom from 7-OH-enriched products in your messaging — this is platform policy.<br/>4. Cite a real bill or alert — don't make up urgency.<br/>5. Templates are CC'd via the user's own email; remember they sign their real name.",
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
        title: "Forum moderation queue",
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
        title: "Local officials",
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
        title: "Leader workshop",
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
  // Final acknowledgment step — special-cased, no element selector, has the form
  {
    pageKey: "acknowledge",
    matchesPath: (p) => p === "/account",
    navigateTo: "/account",
    label: "Acknowledge the rules",
    steps: [
      {
        title: "📋 Acknowledge leader rules",
        description:
          "By clicking the checkbox below, you confirm you've read this walkthrough and agree to:<br/><br/>" +
          "• Nonpartisan messaging in all campaigns you author<br/>" +
          "• Apply moderation standards uniformly regardless of stance<br/>" +
          "• Escalate uncertainty to an admin<br/>" +
          "• Use only publicly-available contact info for local officials<br/>" +
          "• Treat your recruits' info as confidential<br/><br/>" +
          "Click the I AGREE button below to complete the tour and unlock all leader functions.",
      },
    ],
  },
];

function loadState(): TourState {
  if (typeof window === "undefined") return { pageKey: "dashboard", stepIdx: 0, completedPages: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { pageKey: "dashboard", stepIdx: 0, completedPages: [] };
    return JSON.parse(raw) as TourState;
  } catch {
    return { pageKey: "dashboard", stepIdx: 0, completedPages: [] };
  }
}

function saveState(s: TourState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch { /* quota / disabled */ }
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
  const [ackOpen, setAckOpen] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [ackSubmitting, setAckSubmitting] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  useEffect(() => {
    // Don't fire if user already acknowledged OR there's no pending flag
    if (alreadyAcknowledged || !pending) {
      // Clean up any stale LS state
      clearState();
      return;
    }
    if (typeof window === "undefined") return;

    const state = loadState();
    // Figure out which page-set we're on right now
    const currentPage = TOUR_PAGES.find((p) => p.matchesPath(pathname));

    if (!currentPage) {
      // User is on a page not in the tour. Don't auto-navigate (could be
      // confusing); just sit quiet until they hit a tour page. The
      // banner (rendered separately) nudges them.
      return;
    }

    // If they're on a page we already completed in this LS state, skip
    if (state.completedPages.includes(currentPage.pageKey) && state.pageKey !== currentPage.pageKey) {
      return;
    }

    // Run this page's tour
    const isLastPage = TOUR_PAGES[TOUR_PAGES.length - 1].pageKey === currentPage.pageKey;
    const nextPage = TOUR_PAGES[TOUR_PAGES.findIndex((p) => p.pageKey === currentPage.pageKey) + 1];

    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: false,            // can't close — must finish or escape via Skip
      overlayOpacity: 0.6,
      stagePadding: 4,
      stageRadius: 8,
      nextBtnText: isLastPage ? "Continue →" : "Next →",
      prevBtnText: "Back",
      doneBtnText: isLastPage ? "Sign acknowledgment →" : `Continue: ${nextPage?.label ?? "Done"} →`,
      onDestroyed: () => {
        // Mark this page complete + advance to next page
        const newState: TourState = {
          ...state,
          completedPages: [...new Set([...state.completedPages, currentPage.pageKey])],
          pageKey: nextPage?.pageKey ?? "acknowledge",
          stepIdx: 0,
        };
        saveState(newState);

        // If this was the last page → open the ack modal
        if (isLastPage) {
          setAckOpen(true);
          return;
        }

        // Navigate to next page in tour
        if (nextPage) {
          router.push(nextPage.navigateTo);
        }
      },
      steps: currentPage.steps.map((s) => ({
        element: s.element,
        popover: {
          title: s.title,
          description: s.description,
          side: s.side,
        },
      })),
    });

    driverRef.current = d;
    d.drive();

    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, pending, alreadyAcknowledged]);

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
      // Clean up LS, also clear pending flag in DB (acknowledgeLeaderRules does both)
      clearState();
      setAckOpen(false);
      setAckSubmitting(false);
      // Force a fresh load so the layout banner disappears + cached prof refreshes
      router.refresh();
    });
  }

  if (!ackOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-lg border border-emerald-700/60 bg-zinc-950 p-6 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
          📋 Final step
        </p>
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
            onClick={() => {
              setAckOpen(false);
              // Reopen via banner; don't clear LS so tour stays mid-flight
            }}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
          >
            Not yet
          </button>
        </div>

        <p className="mt-4 text-[11px] text-zinc-500">
          You can&apos;t exercise leader functions until you complete this. Closing this without
          agreeing will leave the reminder banner active on every page.
        </p>
      </div>
    </div>
  );
}
