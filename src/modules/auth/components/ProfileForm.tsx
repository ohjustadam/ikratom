"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "../actions";
import type { Profile } from "../types";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export function ProfileForm({ profile, email }: { profile: Profile | null; email: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [isShop, setIsShop] = useState(profile?.is_shop_owner ?? false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProfile(fd);
      if (result?.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Section title="Account">
        <Row>
          <Field label="Email (read-only)" name="_email" defaultValue={email ?? ""} disabled />
          <Field
            label="Username (required)"
            name="username"
            defaultValue={(profile as { username?: string | null } | null)?.username ?? ""}
            hint="3–30 chars: lowercase letters, digits, underscore. Public handle other users see."
          />
        </Row>
        <Row>
          <Field
            label="Full name (optional)"
            name="full_name"
            defaultValue={profile?.full_name ?? ""}
            hint="Optional — used to autofill the signature on legislator emails."
          />
          <Field label="Phone" name="phone" defaultValue={profile?.phone ?? ""} />
        </Row>
      </Section>

      <Section
        title="Civic info"
        subtitle="We use this to autofill emails to your legislators. Address stays private — never shown publicly."
      >
        <Field label="Street" name="street" defaultValue={profile?.street ?? ""} />
        <Row>
          <Field label="City" name="city" defaultValue={profile?.city ?? ""} />
          <Select label="State" name="state" defaultValue={profile?.state ?? ""} options={STATES} />
          <Field label="ZIP" name="zip" defaultValue={profile?.zip ?? ""} />
        </Row>
      </Section>

      <Section title="Recruitment (optional)" subtitle="Helps us tag the community. Boxes can stay unchecked.">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="is_shop_owner"
            checked={isShop}
            onChange={(e) => setIsShop(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          I own or manage a kratom shop
        </label>
        {isShop && (
          <Field label="Shop name" name="shop_name" defaultValue={profile?.shop_name ?? ""} />
        )}
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="is_medical_professional"
            defaultChecked={profile?.is_medical_professional ?? false}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          I am a medical professional (doctor, nurse, pharmacist, etc.)
        </label>
      </Section>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Field({
  label, name, defaultValue, disabled, hint,
}: { label: string; name: string; defaultValue?: string; disabled?: boolean; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 disabled:opacity-50 focus:border-emerald-500 focus:outline-none"
      />
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function Select({
  label, name, defaultValue, options,
}: { label: string; name: string; defaultValue?: string; options: string[] }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      >
        <option value="">—</option>
        {options.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
