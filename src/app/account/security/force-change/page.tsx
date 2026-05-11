import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ForceChangePasswordForm } from "@/modules/auth/components/ForceChangePasswordForm";

export const metadata = { title: "Set your new password" };

/**
 * Forced password-change page. The proxy routes any signed-in user
 * whose profiles.password_must_change_at is set here on every request
 * (except sign-out and a few escape hatches). Until they pick a new
 * password they cannot reach any other page.
 *
 * On successful change the existing changePassword action clears the
 * flag and ForceChangePasswordForm hard-navigates to /dashboard.
 */
export default async function ForceChangePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("password_must_change_at")
    .eq("id", user.id)
    .single();

  // If they're here but not flagged, bounce to normal security page.
  if (!profile?.password_must_change_at) redirect("/account/security");

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-emerald-300">Set your new password</h1>
        <p className="mt-2 text-sm text-zinc-400">
          An admin gave you a temporary password to recover your account. Set
          your own password below before you continue — you won&apos;t be able to
          use the rest of the site until you do.
        </p>
      </header>

      <ForceChangePasswordForm />

      <p className="mt-6 text-center text-xs text-zinc-500">
        Didn&apos;t ask for this? Email{" "}
        <a href="mailto:support@ikratom.org" className="text-emerald-400 hover:underline">
          support@ikratom.org
        </a>{" "}
        right away.
      </p>
    </div>
  );
}
