import Link from "next/link";
import { getTrustTier } from "@/modules/auth/trust-tier";

/**
 * "Your access level" card for /account. Shows the signed-in user's tier and,
 * for a not-yet-verified free account, the exact remaining steps to reach the
 * Verified tier that unlocks the full intel layer (stance memos + dossier) —
 * delivering on the promise the /membership page makes. Reuses getTrustTier so
 * the criteria stay in one place. Server component; renders nothing for anon.
 */
const TIER_BADGE: Record<string, { label: string; tone: string }> = {
  new: { label: "Free account", tone: "bg-zinc-800 text-zinc-300" },
  verified: { label: "Verified", tone: "bg-emerald-500 text-zinc-950" },
  leader: { label: "Advocate Leader", tone: "bg-emerald-500 text-zinc-950" },
  admin: { label: "Admin", tone: "bg-emerald-500 text-zinc-950" },
  owner: { label: "Owner", tone: "bg-emerald-500 text-zinc-950" },
};

export async function AccessLevelCard() {
  const t = await getTrustTier();
  if (t.tier === "anon") return null;
  const fullAccess = t.verified || t.role !== "user";
  const badge = TIER_BADGE[t.tier] ?? TIER_BADGE.new;

  const steps = [
    { ok: t.emailConfirmed, label: "Confirm your email", hint: "Check your inbox for the confirmation link.", href: null as string | null },
    { ok: t.profileComplete, label: "Complete your profile", hint: "Your name + full mailing address.", href: "#identity" },
    { ok: t.mfaEnrolled, label: "Enable two-factor (2FA)", hint: "A second step at sign-in.", href: "/account/security" },
    { ok: t.ageOk, label: "Account age ≥ 48h", hint: `About ${Math.max(0, Math.ceil(48 - t.ageHours))}h to go — automatic.`, href: null as string | null },
  ];
  const remaining = steps.filter((s) => !s.ok).length;

  return (
    <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">Your access level</h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.tone}`}>{badge.label}</span>
        <Link href="/membership" className="ml-auto text-xs text-zinc-500 hover:text-emerald-400">Account levels →</Link>
      </div>
      {fullAccess ? (
        <p className="mt-3 text-sm text-emerald-300">
          ✓ Full intel access — stance memos, dossiers, and the Pressure Index are all available to you.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-zinc-300">
            You have a free account.{" "}
            {remaining === 0
              ? "You're all set — your Verified status is finalizing."
              : `Complete ${remaining} more step${remaining === 1 ? "" : "s"}`}{" "}
            to become <strong className="text-zinc-100">Verified</strong> and unlock the full intel layer —
            per-official stance memos, rationale, and the complete dossier. (The Pressure Index is already yours.)
          </p>
          <ul className="mt-3 space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={s.ok ? "text-emerald-400" : "text-zinc-600"}>{s.ok ? "✓" : "○"}</span>
                <span className="flex-1">
                  {s.href && !s.ok ? (
                    <Link href={s.href} className="text-emerald-400 hover:underline">{s.label}</Link>
                  ) : (
                    <span className={s.ok ? "text-zinc-500 line-through" : "text-zinc-200"}>{s.label}</span>
                  )}
                  {s.hint && !s.ok && <span className="ml-2 text-[11px] text-zinc-500">{s.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
