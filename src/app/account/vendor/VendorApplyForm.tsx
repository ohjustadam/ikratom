"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyForVendorStatus } from "@/modules/auth/actions-vendor";

export function VendorApplyForm({
  initial,
}: {
  initial?: {
    vendor_business_name?: string | null;
    vendor_business_role?: string | null;
    vendor_business_city?: string | null;
    vendor_business_state?: string | null;
    vendor_business_website?: string | null;
  } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await applyForVendorStatus({
        shopName: String(fd.get("shop_name") ?? ""),
        role: String(fd.get("role") ?? ""),
        city: String(fd.get("city") ?? ""),
        state: String(fd.get("state") ?? ""),
        website: String(fd.get("website") ?? ""),
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <Field name="shop_name" label="Business name" required defaultValue={initial?.vendor_business_name ?? ""} hint="The legal or DBA name of the business." />
      <Field name="role" label="Your role" required defaultValue={initial?.vendor_business_role ?? ""} hint="Owner, Manager, Director of Advocacy, etc." />
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2"><Field name="city" label="City" required defaultValue={initial?.vendor_business_city ?? ""} /></div>
        <Field name="state" label="State" required defaultValue={initial?.vendor_business_state ?? ""} hint="2-letter (e.g. OK)" />
      </div>
      <Field name="website" label="Website (optional)" defaultValue={initial?.vendor_business_website ?? ""} hint="Helps verification if it shows the business + your name." />

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit application"}
      </button>
      <p className="text-xs text-zinc-500">
        We&apos;ll email you when your application is reviewed (usually within 2 business days).
      </p>
    </form>
  );
}

function Field({
  name, label, required, defaultValue, hint,
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="text"
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
