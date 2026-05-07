"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPartner } from "@/modules/partners/actions";

export function NewPartnerForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createPartner({
        shopName: String(fd.get("shop_name") ?? ""),
        city: String(fd.get("city") ?? ""),
        state: String(fd.get("state") ?? ""),
        tagline: String(fd.get("tagline") ?? ""),
        contactName: String(fd.get("contact_name") ?? ""),
        contactEmail: String(fd.get("contact_email") ?? ""),
        contactPhone: String(fd.get("contact_phone") ?? ""),
        notes: String(fd.get("notes") ?? ""),
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.push(`/admin/partners/${r.partner.slug}/kit`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field name="shop_name" label="Shop name" required hint="Shown on the printed materials." />
      <div className="grid grid-cols-3 gap-3">
        <Field name="city" label="City" />
        <Field name="state" label="State" hint="2-letter code (e.g. OK)" />
        <div /> {/* spacer */}
      </div>
      <Field
        name="tagline"
        label="Tagline (optional)"
        hint="Up to 200 chars. Falls back to a default if empty."
      />

      <fieldset className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Contact (admin only)
        </legend>
        <Field name="contact_name" label="Contact name" />
        <Field name="contact_email" label="Email" />
        <Field name="contact_phone" label="Phone" />
        <Field name="notes" label="Notes" multiline />
      </fieldset>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create partner + open print kit"}
        </button>
        <a
          href="/admin/partners"
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  required,
  multiline,
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="mb-3">
      <label htmlFor={name} className="block text-sm font-medium text-zinc-300">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          rows={3}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      ) : (
        <input
          id={name}
          name={name}
          type="text"
          required={required}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      )}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
