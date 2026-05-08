"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  type SavedSearch,
} from "@/modules/saved-searches/actions";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export function SavedSearchesPanel({ initial }: { initial: SavedSearch[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(initial.length === 0);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const formEl = e.currentTarget;
    startTransition(async () => {
      const r = await createSavedSearch({
        name: String(fd.get("name") ?? ""),
        query: {
          state: String(fd.get("state") ?? "") || null,
          relevance: (String(fd.get("relevance") ?? "") || null) as "anti" | "pro" | "neutral" | null,
          keyword: String(fd.get("keyword") ?? "") || null,
          scope: (String(fd.get("scope") ?? "") || null) as "state" | "federal" | null,
        },
        alertMethod: (String(fd.get("alert_method") ?? "in_app")) as "push" | "email" | "both" | "in_app",
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        formEl.reset();
        setShowForm(false);
        router.refresh();
      }
    });
  }

  function onToggle(s: SavedSearch) {
    startTransition(async () => {
      await updateSavedSearch({ id: s.id, active: !s.active });
      router.refresh();
    });
  }

  function onDelete(s: SavedSearch) {
    if (!confirm(`Delete saved search "${s.name}"?`)) return;
    startTransition(async () => {
      await deleteSavedSearch(s.id);
      router.refresh();
    });
  }

  return (
    <>
      {/* Existing saved searches */}
      {initial.length > 0 && (
        <ul className="mb-6 space-y-2">
          {initial.map((s) => {
            const q = s.query;
            const summary = [
              q.state && `state=${q.state}`,
              q.relevance && `${q.relevance}`,
              q.scope && `scope=${q.scope}`,
              q.keyword && `"${q.keyword}"`,
            ]
              .filter(Boolean)
              .join(" · ") || "(any)";
            return (
              <li
                key={s.id}
                className={`rounded-md border p-3 text-sm ${
                  s.active ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-900 bg-zinc-950/20 opacity-60"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${s.active ? "bg-emerald-400" : "bg-zinc-700"}`} />
                  <span className="font-semibold text-zinc-100">{s.name}</span>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {s.alert_method}
                  </span>
                  <span className="ml-auto flex shrink-0 gap-1.5">
                    <button
                      onClick={() => onToggle(s)}
                      disabled={pending}
                      className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] hover:border-emerald-500 disabled:opacity-50"
                    >
                      {s.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => onDelete(s)}
                      disabled={pending}
                      className="rounded-md border border-red-900/50 px-2 py-0.5 text-[11px] text-red-300 hover:border-red-700 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                  {summary}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-600">
                  {s.total_matches.toLocaleString()} total match{s.total_matches === 1 ? "" : "es"}
                  {s.last_match_check_at && ` · last checked ${new Date(s.last_match_check_at).toLocaleString()}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Create form */}
      {showForm ? (
        <form onSubmit={onCreate} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-100">New saved search</h3>
          <div className="space-y-3 text-sm">
            <Field name="name" label="Name" placeholder="e.g. OK anti bills" required />
            <div className="grid grid-cols-2 gap-3">
              <SelectField name="state" label="State (optional)">
                <option value="">Any state</option>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </SelectField>
              <SelectField name="scope" label="Scope (optional)">
                <option value="">Any scope</option>
                <option value="state">State</option>
                <option value="federal">Federal</option>
              </SelectField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField name="relevance" label="Relevance (optional)">
                <option value="">Any</option>
                <option value="anti">Anti-kratom</option>
                <option value="pro">Pro-kratom</option>
                <option value="neutral">Neutral</option>
              </SelectField>
              <Field name="keyword" label="Keyword (optional)" placeholder="e.g. schedule" />
            </div>
            <SelectField name="alert_method" label="Alert via">
              <option value="in_app">In-app only</option>
              <option value="push">Push notification</option>
              <option value="email">Email</option>
              <option value="both">Push + email</option>
            </SelectField>
          </div>

          {error && (
            <p className="mt-3 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save search"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          disabled={initial.length >= 10}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500 disabled:opacity-50"
        >
          {initial.length >= 10 ? "Limit reached (10/10)" : "+ New saved search"}
        </button>
      )}
    </>
  );
}

function Field({
  name, label, placeholder, required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-zinc-300">{label}</label>
      <input
        id={name}
        name={name}
        type="text"
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}

function SelectField({
  name, label, children,
}: { name: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-zinc-300">{label}</label>
      <select
        id={name}
        name={name}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      >
        {children}
      </select>
    </div>
  );
}
