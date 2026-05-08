"use client";

import { useEffect, useTransition } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { clearLeaderTourPending } from "@/modules/admin/user-actions";

/**
 * Triggered automatically the first /dashboard visit after an admin
 * grants the user is_advocate_leader = true. Walks them through the
 * leader tools they just unlocked: campaign authoring, forum
 * moderation queue, leader workshop page.
 *
 * Realtime: works because `leader_tour_pending` is set by the
 * setUserRoles server action (PR #40) which also fires a bell-icon
 * notification via Realtime publication on notifications. So the
 * user sees both: a "🎖 You're now a Leader" alert + this tour the
 * next time they hit /dashboard.
 */
export function LeaderTour({
  shouldShow,
  forceShow = false,
}: {
  shouldShow: boolean;
  forceShow?: boolean;
}) {
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!shouldShow && !forceShow) return;
    if (typeof window === "undefined") return;

    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayOpacity: 0.6,
      stagePadding: 4,
      stageRadius: 8,
      onDestroyed: () => {
        // Only clear the pending flag for the auto-fired tour. A replay
        // click (forceShow=true) shouldn't touch the flag — it's already
        // false in that case, and we don't want to mask a future grant.
        if (shouldShow) {
          startTransition(async () => {
            await clearLeaderTourPending().catch(() => {});
          });
        }
      },
      steps: [
        {
          popover: {
            title: "🎖 Welcome to Leader",
            description:
              "An admin just promoted you. You can now author campaigns, moderate the forum, and access the leader workshop. Take 30 seconds to see what's new.",
          },
        },
        {
          popover: {
            title: "Author campaigns",
            description:
              `Create call-to-action campaigns at /admin/campaigns. Pick a state + scope, write a prefilled email template with placeholders like {{full_name}}, set targeted legislator roles. Saved campaigns go through admin review unless you're an admin already.<br/><br/><a href="/admin/campaigns" class="ikratom-tour-link">Open Campaigns →</a>`,
          },
        },
        {
          popover: {
            title: "Forum moderation queue",
            description:
              `/admin/forum shows posts auto-flagged for review (new accounts, links, keyword hits) plus user-reported content. Approve, remove, or escalate. Bulk actions speed it up when a wave of spam hits.<br/><br/><a href="/admin/forum" class="ikratom-tour-link">Open Forum mod →</a>`,
          },
        },
        {
          popover: {
            title: "Leader workshop",
            description:
              `/how-it-works/for-leaders is your reference for what leader privileges DO and DON'T grant. Bookmark it. The split between leader/admin/owner roles is by design.<br/><br/><a href="/how-it-works/for-leaders" class="ikratom-tour-link">Open Workshop →</a>`,
          },
        },
        {
          popover: {
            title: "You're set.",
            description:
              "The platform is built so individual leaders can act fast without permission. Use it. Replay this tour anytime via /account/security → Cockpit tour controls.",
          },
        },
      ],
    });
    d.drive();

    return () => {
      d.destroy();
    };
  }, [shouldShow, forceShow, startTransition]);

  return null;
}
