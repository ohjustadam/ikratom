"use client";

import { useState, useTransition } from "react";
import { createLocalOfficial, updateLocalOfficial } from "../local-actions";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const LOCAL_ROLES = [
  { v: "mayor", label: "Mayor" },
  { v: "city_council", label: "City Council Member" },
  { v: "county_executive", label: "County Executive / Judge / Mayor" },
  { v: "county_commissioner", label: "County Commissioner / Supervisor" },
  { v: "school_board", label: "School Board Member" },
  { v: "other_local", label: "Other Local Office" },
];

type Initial = {
  id?: string;
  full_name?: string;
  state?: string;
  role?: string;
  locality?: string;
  body?: string | null;
  title?: string | null;
  district?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  office_address?: string | null;
  party?: string | null;
};

export function LocalOfficialForm({ initial }: { initial?: Initial }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = initial?.id
        ? await updateLocalOfficial(initial.id, fd)
        : await createLocalOfficial(fd);
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Section title="Identity">
        <Field name="full_name" label="Full name" required defaultValue={initial?.full_name} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select name="state" label="State" required defaultValue={initial?.state ?? "OK"}>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select name="role" label="Role" required defaultValue={initial?.role ?? "city_council"}>
            {LOCAL_ROLES.map((r) => (
              <option key={r.v} value={r.v}>{r.label}</option>
            ))}
          </Select>
        </div>
      </Section>

      <Section title="Where they serve">
        <Field
          name="locality"
          label="Locality (city, county)"
          required
          defaultValue={initial?.locality}
          placeholder="Tulsa, OK  ·  or  ·  Tulsa County, OK"
        />
        <p className="text-xs text-zinc-500">
          We&apos;ll auto-add the state suffix if missing. Use the same format Census returns for matching to user addresses.
        </p>
        <Field
          name="body"
          label="Body / chamber (optional)"
          defaultValue={initial?.body ?? ""}
          placeholder="Tulsa City Council"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            name="title"
            label="Specific title (optional)"
            defaultValue={initial?.title ?? ""}
            placeholder="Council Member, District 4"
          />
          <Field
            name="district"
            label="District / seat (optional)"
            defaultValue={initial?.district ?? ""}
            placeholder="4"
          />
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="email" label="Email" defaultValue={initial?.email ?? ""} type="email" />
          <Field name="phone" label="Phone" defaultValue={initial?.phone ?? ""} />
        </div>
        <Field name="website" label="Website / contact form URL" defaultValue={initial?.website ?? ""} />
        <Field name="office_address" label="Office address" defaultValue={initial?.office_address ?? ""} />
        <Field name="party" label="Party (optional)" defaultValue={initial?.party ?? ""} placeholder="Nonpartisan / Democratic / Republican" />
      </Section>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : initial?.id ? "Save changes" : "Add official"}
        </button>
        <a href="/admin/locals" className="text-sm text-zinc-400 hover:text-emerald-400">
          Cancel
        </a>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  name, label, required, defaultValue, placeholder, type = "text",
}: { name: string; label: string; required?: boolean; defaultValue?: string; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}{required ? " *" : ""}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}

function Select({
  name, label, required, defaultValue, children,
}: { name: string; label: string; required?: boolean; defaultValue?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}{required ? " *" : ""}</label>
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      >
        {children}
      </select>
    </div>
  );
}
