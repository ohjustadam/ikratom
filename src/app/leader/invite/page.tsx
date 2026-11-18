import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";
import { applyLeaderInviteIfReady } from "@/modules/admin/leader-invite";
import { ADDRESS_PRIVACY_NOTE } from "@/modules/auth/promotion-checklist";
import { CheckAgainButton } from "./CheckAgainButton";

export const metadata = { title: "Your leader invite" };
export const dynamic = "force-dynamic";

/**
 * Where a member lands from the "You're invited to be an Advocate Leader"
 * notice. Shows what is left, each step one tap away. When everything is done
 * the role applies right here and they go to the dashboard, where the leader
 * walkthrough starts.
 */
export default async function LeaderInvitePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/leader/invite");

  const r = await applyLeaderInviteIfReady(user.id);
  if (r.state === "applied") redirect("/dashboard?leader=welcome");
  if (r.state === "already") redirect("/leader");

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Advocate Leader</p>
      {r.state === "waiting" ? (
        <>
          <h1 className="mt-2 text-3xl font-bold">You&apos;re invited to lead 🎖</h1>
          <p className="mt-3 text-zinc-300">
            Thank you for stepping up. A few quick steps keep the leader tools safe, so nobody can open a
            throwaway account and use them against kratom. The role turns on by itself once they&apos;re done.
          </p>
          <ol className="mt-6 space-y-3">
            {r.items.map((i) => (
              <li
                key={i.key}
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  i.done ? "border-emerald-800/50 bg-emerald-950/20" : "border-zinc-800 bg-zinc-950/40"
                }`}
              >
                <span className={`mt-0.5 text-lg ${i.done ? "text-emerald-400" : "text-zinc-500"}`} aria-hidden>
                  {i.done ? "✓" : "○"}
                </span>
                <div className="flex-1">
                  <p className={i.done ? "text-zinc-400 line-through" : "text-zinc-100"}>{i.label}</p>
                  {!i.done && i.href && (
                    <Link href={i.href} className="mt-1 inline-block text-sm font-semibold text-emerald-400 hover:underline">
                      Do this now →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400">🔒 {ADDRESS_PRIVACY_NOTE}</p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <CheckAgainButton />
            <Link href="/roles" className="text-sm text-zinc-400 hover:text-emerald-400">
              What leaders do →
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="mt-2 text-3xl font-bold">No open invite</h1>
          <p className="mt-3 text-zinc-300">
            {r.state === "error"
              ? "Something went wrong turning your role on. Please try again in a minute."
              : "There's no leader invite waiting for you right now. Leaders are invited by the platform owner."}
          </p>
          <Link href="/roles" className="mt-4 inline-block text-sm font-semibold text-emerald-400 hover:underline">
            Roles and badges, and how to become a leader →
          </Link>
        </>
      )}
    </div>
  );
}
