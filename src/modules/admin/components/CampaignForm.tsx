"use client";

import { useState, useTransition } from "react";
import {
  createCampaign,
  updateCampaign,
} from "@/modules/admin/campaign-actions";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const ROLES = [
  { v: "state_senate", label: "State Senate" },
  { v: "state_house", label: "State House" },
  { v: "us_senate", label: "U.S. Senate" },
  { v: "us_house", label: "U.S. House" },
];

type Initial = {
  id?: string;
  title?: string;
  slug?: string;
  blurb?: string | null;
  body_md?: string | null;
  state?: string | null;
  target_roles?: string[];
  subject_template?: string;
  body_template?: string;
  active?: boolean;
  is_standing?: boolean;
};

export function CampaignForm({ initial }: { initial?: Initial }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = initial?.id
        ? await updateCampaign(initial.id, fd)
        : await createCampaign(fd);
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Section title="Identity">
        <Field name="title" label="Title" required defaultValue={initial?.title} placeholder="Tell your reps to oppose SB 1234" />
        <Field name="slug" label="URL slug (optional — auto-generated from title)" defaultValue={initial?.slug} placeholder="ok-oppose-sb-1234" />
      </Section>

      <Section title="Targeting">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select name="state" label="State (or Federal)" defaultValue={initial?.state ?? ""}>
            <option value="">Federal / multistate</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <div>
            <label className="block text-xs font-medium text-zinc-400">Target roles *</label>
            <div className="mt-2 space-y-1.5">
              {ROLES.map((r) => (
                <label key={r.v} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`role_${r.v}`}
                    defaultChecked={initial?.target_roles?.includes(r.v) ?? (r.v === "state_senate" || r.v === "state_house")}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Pitch">
        <Field name="blurb" label="Short blurb (1–2 sentences, shown on cards)" defaultValue={initial?.blurb ?? ""} maxLength={500} />
        <Textarea name="body_md" label="Why this matters (full description)" defaultValue={initial?.body_md ?? ""} rows={8} />
      </Section>

      <Section title="Email template">
        <Field name="subject_template" label="Subject *" required defaultValue={initial?.subject_template} placeholder="Constituent input on kratom policy in {{state}}" />
        <Textarea
          name="body_template"
          label="Body * — placeholders: {{full_name}}, {{city}}, {{state}}, {{zip}}, {{legislator_name}} (street is never included — privacy)"
          required
          defaultValue={initial?.body_template}
          rows={14}
        />
      </Section>

      <Section title="Status">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial?.active ?? true}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          Active (visible on /campaigns)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_standing"
            defaultChecked={initial?.is_standing ?? false}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          Standing (permanent — never auto-expired by the rotating-campaign janitor)
        </label>
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
          {pending ? "Saving…" : initial?.id ? "Save changes" : "Create campaign"}
        </button>
        <a href="/admin/campaigns" className="text-sm text-zinc-400 hover:text-emerald-400">
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
  name, label, required, defaultValue, placeholder, maxLength,
}: { name: string; label: string; required?: boolean; defaultValue?: string; placeholder?: string; maxLength?: number }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}{required ? " *" : ""}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}

function Textarea({
  name, label, required, defaultValue, rows,
}: { name: string; label: string; required?: boolean; defaultValue?: string; rows?: number }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}{required ? " *" : ""}</label>
      <textarea
        name={name}
        defaultValue={defaultValue}
        required={required}
        rows={rows ?? 6}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}

function Select({
  name, label, defaultValue, children,
}: { name: string; label: string; defaultValue?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      >
        {children}
      </select>
    </div>
  );
}
