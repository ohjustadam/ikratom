import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/modules/auth/components/SignOutButton";

export const metadata = { title: "Account suspended" };
export const dynamic = "force-dynamic";

/**
 * /locked — destination for owner-locked accounts (migration 0082).
 * proxy.ts bounces any authenticated user with profiles.account_locked_at != null
 * here. They can sign out but can't reach any other page.
 *
 * If they aren't actually locked (someone hit /locked directly), redirect to /dashboard.
 */
export default async function LockedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: prof } = await supabase
    .from("profiles")
    .select("account_locked_at, account_locked_reason, full_name")
    .eq("id", user.id)
    .single();

  if (!(prof as { account_locked_at?: string | null } | null)?.account_locked_at) {
    redirect("/dashboard");
  }

  const lockedAt = (prof as { account_locked_at: string }).account_locked_at;
  const reason = (prof as { account_locked_reason?: string | null } | null)?.account_locked_reason;
  const name = (prof as { full_name?: string | null } | null)?.full_name;

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <p className="text-5xl">🔒</p>
      <h1 className="mt-4 text-2xl font-bold">Account suspended</h1>
      <p className="mt-3 text-sm text-zinc-400">
        {name ? `Hi ${name}, your` : "Your"} iKratom account has been temporarily
        suspended by an owner. You can sign out, but you can&apos;t access other
        pages while suspended.
      </p>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-left">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Suspended on</p>
        <p className="mt-1 font-mono text-sm text-zinc-300">
          {new Date(lockedAt).toLocaleString()}
        </p>
        {reason && (
          <>
            <p className="mt-4 text-[10px] uppercase tracking-wider text-zinc-500">Reason</p>
            <p className="mt-1 text-sm text-zinc-300">{reason}</p>
          </>
        )}
      </div>

      <p className="mt-6 text-xs text-zinc-500">
        Think this is a mistake?{" "}
        <a href="mailto:ohjustadam@proton.me" className="text-emerald-400 hover:underline">
          Email support
        </a>
        {" "}with your username and what you were doing when this happened.
      </p>

      <div className="mt-8">
        <SignOutButton />
      </div>
    </div>
  );
}
