import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaChallengeForm } from "@/modules/auth/components/MfaChallengeForm";
import { safeRelativePath } from "@/lib/safe-redirect";

export const metadata = { title: "Two-factor sign-in" };

export default async function MfaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const sp = await searchParams;
  // Open-redirect guard (pen-test oauth-01): sanitize before it reaches a
  // server redirect() OR the client window.location in MfaChallengeForm.
  const dest = safeRelativePath(sp.redirect) ?? "/dashboard";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Must be signed in (aal1) to reach the MFA step
  if (!user) redirect("/login");

  // If they're already at aal2, no second factor needed — go straight through.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect(dest);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totp = (factors?.totp ?? []).filter((f) => f.status === "verified");
  if (totp.length === 0) {
    // User has no verified factor — nothing to challenge. Send them home.
    redirect(dest);
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-16">
      <div className="w-full">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Two-factor sign-in
        </p>
        <h1 className="mt-3 text-center text-3xl font-bold">Enter your code</h1>
        <p className="mt-2 text-center text-sm text-zinc-400">
          Open your authenticator app and enter the 6-digit code for iKratom.
        </p>

        <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
          <MfaChallengeForm
            factorId={totp[0].id}
            redirectTo={dest}
          />
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Lost your authenticator? Contact the platform owner — they can clear your
          2FA factor from the admin console so you can re-enroll.
        </p>
      </div>
    </div>
  );
}
