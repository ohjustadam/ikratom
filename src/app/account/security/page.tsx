import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMfa } from "@/modules/auth/actions-mfa";
import { MfaPanel } from "@/modules/auth/components/MfaPanel";

export const metadata = { title: "Security" };

export default async function SecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/security");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();

  const isPrivileged =
    !!(profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader);

  const summary = await listMfa();
  const verifiedCount = summary.factors.filter((f) => f.status === "verified").length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </a>

      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">Security</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Two-factor authentication adds a second step at sign-in: your password plus a
          6-digit code from an authenticator app on your phone.
        </p>
      </header>

      {isPrivileged && verifiedCount === 0 && (
        <div className="mb-6 rounded-lg border border-amber-700/40 bg-amber-950/30 p-4 text-sm">
          <p className="font-semibold text-amber-300">Two-factor required for admins</p>
          <p className="mt-1 text-amber-200/80">
            Your account has admin or leader privileges. Enroll a second factor below
            to keep performing admin actions. Existing privileges still work, but
            sensitive mutations will be blocked until 2FA is set up.
          </p>
        </div>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Authenticator app (TOTP)</h2>
            <p className="text-xs text-zinc-500">
              Works with Google Authenticator, 1Password, Authy, Bitwarden, etc.
            </p>
          </div>
          <span
            className={`rounded px-2 py-1 text-xs font-semibold ${
              verifiedCount > 0
                ? "bg-emerald-900/40 text-emerald-300"
                : "bg-zinc-900 text-zinc-400"
            }`}
          >
            {verifiedCount > 0 ? "Enabled" : "Not enabled"}
          </span>
        </div>

        <MfaPanel summary={summary} />
      </section>

      <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-400">
        <h3 className="mb-2 font-semibold text-zinc-200">If you lose your phone</h3>
        <p>
          Right now, the only recovery is asking the platform owner to manually
          remove your 2FA factor (which they can do from the Supabase dashboard).
          If you&apos;re the owner, save your TOTP secret in a password manager
          when you enroll, so you can re-add it on a new device.
        </p>
      </section>
    </div>
  );
}
