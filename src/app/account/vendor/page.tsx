import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyVendorState } from "@/modules/auth/actions-vendor";
import { VendorApplyForm } from "./VendorApplyForm";

/**
 * /account/vendor — apply to become a verified vendor + see status.
 *
 * Three states the page handles:
 *   - none / rejected (>30 days): show application form
 *   - pending: show "under review" message + submitted info
 *   - approved: show "verified" badge + business info + business action benefits
 *   - rejected (within 30 days): show rejection reason + cooldown countdown
 */
export const metadata = { title: "Verified vendor" };

export default async function VendorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/vendor");

  const r = await getMyVendorState();
  if (!("ok" in r)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-red-300">Failed to load vendor state.</p>
      </div>
    );
  }
  const v = r.vendor;
  const status = v?.vendor_status ?? "none";

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </a>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">Verified vendor</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Verified vendors can take advocacy action <em>as their business</em> in addition
          to as themselves. Useful for shops, distributors, and brands speaking publicly
          about kratom policy.
        </p>
      </header>

      {status === "approved" && v && (
        <section className="mb-8 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-emerald-500 px-2 py-0.5 text-xs font-bold text-zinc-950">
              ✓ VERIFIED
            </span>
            <h2 className="text-lg font-semibold">{v.vendor_business_name}</h2>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-zinc-500">Role</dt><dd className="text-zinc-200">{v.vendor_business_role}</dd></div>
            <div><dt className="text-zinc-500">Location</dt><dd className="text-zinc-200">{v.vendor_business_city}, {v.vendor_business_state}</dd></div>
            {v.vendor_business_website && (
              <div className="sm:col-span-2"><dt className="text-zinc-500">Website</dt><dd><a href={v.vendor_business_website} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">{v.vendor_business_website}</a></dd></div>
            )}
            <div className="sm:col-span-2"><dt className="text-zinc-500">Approved</dt><dd className="text-zinc-200">{v.vendor_approved_at ? new Date(v.vendor_approved_at).toLocaleString() : "—"}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-zinc-400">
            When you take a campaign action, you&apos;ll see a choice between sending as
            yourself or as your business. Your profile shows a verified badge to other
            advocates.
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            Need to update your business info or step down as vendor?{" "}
            <a href="mailto:ohjustadam@proton.me" className="text-emerald-400 hover:underline">
              Email the owner
            </a>
            .
          </p>
        </section>
      )}

      {status === "pending" && v && (
        <section className="mb-8 rounded-lg border border-amber-700/40 bg-amber-950/20 p-5">
          <p className="text-sm font-semibold text-amber-300">Under review</p>
          <p className="mt-1 text-xs text-zinc-300">
            Submitted {v.vendor_application_at ? new Date(v.vendor_application_at).toLocaleString() : ""}.
            We typically respond within 2 business days. We&apos;ll verify the business is
            real and your role is plausible — most applications get approved.
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div><dt className="text-zinc-500">Business</dt><dd className="text-zinc-200">{v.vendor_business_name}</dd></div>
            <div><dt className="text-zinc-500">Role</dt><dd className="text-zinc-200">{v.vendor_business_role}</dd></div>
            <div><dt className="text-zinc-500">Location</dt><dd className="text-zinc-200">{v.vendor_business_city}, {v.vendor_business_state}</dd></div>
            {v.vendor_business_website && (
              <div className="sm:col-span-2"><dt className="text-zinc-500">Website</dt><dd className="text-zinc-200">{v.vendor_business_website}</dd></div>
            )}
          </dl>
        </section>
      )}

      {status === "rejected" && v && (
        <section className="mb-8 rounded-lg border border-red-900/50 bg-red-950/20 p-5">
          <p className="text-sm font-semibold text-red-300">Application rejected</p>
          {v.vendor_rejection_reason && (
            <p className="mt-1 text-xs text-zinc-300">
              <span className="text-zinc-500">Reason:</span> {v.vendor_rejection_reason}
            </p>
          )}
          <p className="mt-2 text-xs text-zinc-400">
            You can submit a new application 30 days after the rejection date. Update
            your business info if anything was wrong, or reach out to clarify.
          </p>
          <RejectedReapplyHint applicationAt={v.vendor_application_at} />
        </section>
      )}

      {(status === "none" || (status === "rejected" && canReapply(v?.vendor_application_at))) && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Apply</h2>
          <p className="mb-4 text-xs text-zinc-500">
            We do a light verification: confirming the business exists, that you&apos;re
            plausibly its representative. No documents required for most applicants.
            Lying = permanent rejection + reporting to the org.
          </p>
          <VendorApplyForm initial={v} />
        </section>
      )}

      <section className="mt-12 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-400">
        <h3 className="mb-2 font-semibold text-zinc-200">Why verify?</h3>
        <ul className="list-inside list-disc space-y-1 text-xs">
          <li>Send advocacy emails as the business, signed with the company name</li>
          <li>Verified badge on your profile + adjacent to forum posts</li>
          <li>Counted in &ldquo;X businesses opposing this bill&rdquo; tallies on bill pages</li>
          <li>Eligibility to host community giveaways (when that ships)</li>
        </ul>
        <h3 className="mb-2 mt-4 font-semibold text-zinc-200">What we DON&apos;T do</h3>
        <ul className="list-inside list-disc space-y-1 text-xs">
          <li>Take a cut. iKratom is free for vendors and customers.</li>
          <li>Sell vendor data. Verified status is shown on your profile only.</li>
          <li>Advertise vendors. We&apos;re not a marketplace.</li>
        </ul>
      </section>
    </div>
  );
}

function canReapply(applicationAt: string | null | undefined): boolean {
  if (!applicationAt) return true;
  const last = new Date(applicationAt).getTime();
  return Date.now() >= last + 30 * 86400_000;
}

function RejectedReapplyHint({ applicationAt }: { applicationAt: string | null | undefined }) {
  if (!applicationAt) return null;
  const last = new Date(applicationAt).getTime();
  const cooldownEnds = last + 30 * 86400_000;
  if (Date.now() >= cooldownEnds) {
    return <p className="mt-2 text-xs text-emerald-400">You&apos;re eligible to re-apply now — see the form below.</p>;
  }
  const days = Math.ceil((cooldownEnds - Date.now()) / 86400_000);
  return <p className="mt-2 text-xs text-zinc-500">You can re-apply in {days} day{days === 1 ? "" : "s"}.</p>;
}
