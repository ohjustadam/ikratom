"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePartner, deletePartner, type Partner } from "@/modules/partners/actions";

export function EditPartnerForm({ initial }: { initial: Partner }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updatePartner({
        id: initial.id,
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
      else {
        setInfo("Saved.");
        router.refresh();
      }
    });
  }

  function onDelete() {
    if (!confirm(`Delete ${initial.shop_name}? Existing referral data is preserved (slug stays in old action rows), but the partner record is removed.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deletePartner(initial.id);
      if ("error" in r) setError(r.error ?? "Failed");
      else router.push("/admin/partners");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field name="shop_name" label="Shop name" defaultValue={initial.shop_name} required />
      <div className="grid grid-cols-3 gap-3">
        <Field name="city" label="City" defaultValue={initial.city ?? ""} />
        <Field name="state" label="State" defaultValue={initial.state ?? ""} />
        <div />
      </div>
      <Field name="tagline" label="Tagline" defaultValue={initial.tagline ?? ""} />

      <fieldset className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Contact (admin only)
        </legend>
        <Field name="contact_name" label="Contact name" defaultValue={initial.contact_name ?? ""} />
        <Field name="contact_email" label="Email" defaultValue={initial.contact_email ?? ""} />
        <Field name="contact_phone" label="Phone" defaultValue={initial.contact_phone ?? ""} />
        <Field name="notes" label="Notes" defaultValue={initial.notes ?? ""} multiline />
      </fieldset>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {info}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <a
          href={`/admin/partners/${initial.slug}/kit`}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
        >
          Print kit →
        </a>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="ml-auto rounded-md border border-red-900/50 px-4 py-2 text-sm text-red-300 hover:border-red-700 disabled:opacity-50"
        >
          Delete partner
        </button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  required,
  multiline,
}: {
  name: string;
  label: string;
  defaultValue?: string;
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
          defaultValue={defaultValue}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      ) : (
        <input
          id={name}
          name={name}
          type="text"
          required={required}
          defaultValue={defaultValue}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      )}
    </div>
  );
}
