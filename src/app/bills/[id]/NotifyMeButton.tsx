"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { subscribeToBill, unsubscribeFromBill } from "@/modules/bills/subscription-actions";

/**
 * "🔔 Notify me about updates" toggle on the bill detail page.
 *
 * Logged-in users: clicking subscribes / unsubscribes via server
 * action. The hourly cron then fans out notifications matching the
 * subscription preferences (meeting reminder ~24h before meeting,
 * status change, new linked alert).
 *
 * Logged-out users: the button is a "Sign in to subscribe" link to
 * /login with the current bill URL as the redirect target.
 */
export function NotifyMeButton({
  billId,
  initiallySubscribed,
  signedIn,
  hasUpcomingMeeting,
}: {
  billId: string;
  initiallySubscribed: boolean;
  signedIn: boolean;
  hasUpcomingMeeting: boolean;
}) {
  const router = useRouter();
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <a
        href={`/login?redirect=/bills/${billId}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/40 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300 hover:border-emerald-500"
      >
        🔔 Sign in to get notified about updates
      </a>
    );
  }

  function toggle() {
    setError(null);
    startTransition(async () => {
      const r = subscribed
        ? await unsubscribeFromBill(billId)
        : await subscribeToBill({ billId });
      if ("error" in r) {
        setError(r.error ?? "Failed");
        return;
      }
      setSubscribed(!subscribed);
      router.refresh();
    });
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title={
          subscribed
            ? "Click to stop receiving notifications about this bill"
            : hasUpcomingMeeting
            ? "We'll send a reminder ~24 hours before the meeting + alerts when status changes"
            : "We'll notify you when status changes or new intel lands"
        }
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
          subscribed
            ? "border-emerald-700/50 bg-emerald-950/30 text-emerald-300 hover:border-emerald-500"
            : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-emerald-500"
        }`}
      >
        {pending
          ? "…"
          : subscribed
          ? "🔔 Notifications on (click to unsubscribe)"
          : "🔔 Notify me about updates"}
      </button>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  );
}
