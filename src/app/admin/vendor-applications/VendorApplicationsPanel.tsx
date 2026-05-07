"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveVendor, rejectVendor } from "@/modules/auth/actions-vendor";

type Application = {
  id: string;
  full_name: string | null;
  vendor_status: string;
  vendor_business_name: string | null;
  vendor_business_role: string | null;
  vendor_business_city: string | null;
  vendor_business_state: string | null;
  vendor_business_website: string | null;
  vendor_application_at: string | null;
};

export function VendorApplicationsPanel({ applications }: { applications: Application[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve(userId: string, name: string) {
    if (!confirm(`Approve ${name} as a verified vendor?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await approveVendor(userId);
      if ("error" in r) setError(r.error ?? "Failed");
      else { setInfo(`Approved ${name}.`); router.refresh(); }
    });
  }

  function reject(userId: string, name: string) {
    const reason = prompt(`Reject ${name}'s vendor application. Enter the reason (will be shown to them):`);
    if (!reason) return;
    setError(null);
    startTransition(async () => {
      const r = await rejectVendor({ userId, reason });
      if ("error" in r) setError(r.error ?? "Failed");
      else { setInfo(`Rejected ${name}.`); router.refresh(); }
    });
  }

  if (applications.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
        <p className="text-3xl">✓</p>
        <p className="mt-2">All caught up. New applications will appear here.</p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p className="mb-3 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>
      )}
      {info && (
        <p className="mb-3 rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">{info}</p>
      )}

      <ul className="space-y-3">
        {applications.map((a) => {
          const submitted = a.vendor_application_at ? new Date(a.vendor_application_at) : null;
          const ageDays = submitted ? Math.floor((Date.now() - submitted.getTime()) / 86400_000) : 0;
          return (
            <li key={a.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <a
                  href={`/profile/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-base font-semibold text-zinc-100 hover:text-emerald-400"
                >
                  {a.full_name ?? "(no name)"}
                </a>
                <span className="text-xs text-zinc-500">
                  applying for: <span className="font-semibold text-zinc-300">{a.vendor_business_name}</span>
                </span>
                <span className={`ml-auto text-xs ${ageDays > 2 ? "text-amber-400" : "text-zinc-500"}`}>
                  {submitted ? submitted.toLocaleString() : "—"} ({ageDays}d)
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div><dt className="text-zinc-500">Role</dt><dd className="text-zinc-200">{a.vendor_business_role}</dd></div>
                <div><dt className="text-zinc-500">Location</dt><dd className="text-zinc-200">{a.vendor_business_city}, {a.vendor_business_state}</dd></div>
                <div className="break-all">
                  <dt className="text-zinc-500">Website</dt>
                  <dd>
                    {a.vendor_business_website ? (
                      <a href={a.vendor_business_website} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                        {a.vendor_business_website}
                      </a>
                    ) : <span className="text-zinc-600">—</span>}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent((a.vendor_business_name ?? "") + " " + (a.vendor_business_city ?? "") + " " + (a.vendor_business_state ?? ""))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
                >
                  Google verify ↗
                </a>
                <button
                  onClick={() => approve(a.id, a.full_name ?? a.id)}
                  disabled={pending}
                  className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  onClick={() => reject(a.id, a.full_name ?? a.id)}
                  disabled={pending}
                  className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
