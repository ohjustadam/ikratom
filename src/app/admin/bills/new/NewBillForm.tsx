"use client";

import { useState, useTransition } from "react";
import { createLocalBill } from "@/modules/admin/bill-actions";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export function NewBillForm() {
  const [scope, setScope] = useState<"federal" | "state" | "county" | "municipal">("municipal");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createLocalBill(fd);
      if (r && "error" in r && r.error) setError(r.error);
    });
  }

  const requiresLocality = scope === "county" || scope === "municipal";

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      {/* Scope */}
      <div>
        <label className="block text-xs font-medium text-zinc-400">Scope</label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["federal", "state", "county", "municipal"] as const).map((s) => (
            <label
              key={s}
              className={`cursor-pointer rounded-md border px-3 py-2 text-center text-sm capitalize transition ${
                scope === s
                  ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
                  : "border-zinc-800 hover:border-zinc-600"
              }`}
            >
              <input
                type="radio"
                name="scope"
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
                className="hidden"
              />
              {s}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {scope === "municipal" && "City council, town board, etc."}
          {scope === "county" && "County commission, county council, etc."}
          {scope === "state" && "State legislature (use this only if OpenStates missed the bill)."}
          {scope === "federal" && "U.S. Congress (auto-sync coming soon)."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="State" name="state" required>
          <select
            id="state"
            name="state"
            required
            defaultValue=""
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">—</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>

        <Field label="Bill / ordinance number" name="bill_number" required>
          <input
            id="bill_number"
            name="bill_number"
            required
            placeholder={
              scope === "municipal"
                ? "Ord 2026-12"
                : scope === "county"
                ? "CR-026"
                : "HB 1234"
            }
            maxLength={60}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </Field>
      </div>

      {requiresLocality && (
        <Field label={`${scope === "county" ? "County" : "City"} (City, ST)`} name="locality" required>
          <input
            id="locality"
            name="locality"
            required={requiresLocality}
            placeholder={scope === "county" ? "Tulsa County, OK" : "Tulsa, OK"}
            maxLength={120}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </Field>
      )}

      <Field label="Title" name="title" required>
        <input
          id="title"
          name="title"
          required
          maxLength={500}
          placeholder="A short headline of what this bill does"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </Field>

      <Field label="Summary (optional)" name="summary">
        <textarea
          id="summary"
          name="summary"
          rows={4}
          maxLength={5000}
          placeholder="Plain-English explanation of what the bill does"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </Field>

      <Field label="Advocacy callout (optional, shown in emerald box)" name="advocacy_callout">
        <textarea
          id="advocacy_callout"
          name="advocacy_callout"
          rows={2}
          maxLength={500}
          placeholder="Why advocates should care, in one sentence."
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </Field>

      <Field label="Official source URL" name="official_url">
        <input
          id="official_url"
          name="official_url"
          type="url"
          placeholder="https://city-hall.gov/bills/2026-12"
          maxLength={1000}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Stance" name="kratom_relevance" required>
          <select
            id="kratom_relevance"
            name="kratom_relevance"
            defaultValue="anti"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="pro">Pro-kratom</option>
            <option value="anti">Anti-kratom</option>
            <option value="neutral">Neutral</option>
            <option value="unknown">Unknown</option>
          </select>
        </Field>

        <Field label="Status" name="status" required>
          <select
            id="status"
            name="status"
            defaultValue="introduced"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="introduced">Introduced</option>
            <option value="committee">In committee</option>
            <option value="passed_chamber">Passed chamber</option>
            <option value="enacted">Enacted</option>
            <option value="dead">Dead</option>
          </select>
        </Field>

        <Field label="Last action date" name="last_action_at">
          <input
            id="last_action_at"
            name="last_action_at"
            type="date"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </Field>
      </div>

      <Field label="Last action description" name="last_action">
        <input
          id="last_action"
          name="last_action"
          maxLength={500}
          placeholder="Referred to Health Committee"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </Field>

      <Field label="Session id (optional)" name="session_id">
        <input
          id="session_id"
          name="session_id"
          maxLength={40}
          placeholder={scope === "municipal" ? "2026" : "2025-2026"}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </Field>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add bill"}
        </button>
        <a href="/admin" className="text-sm text-zinc-500 hover:text-zinc-300">
          Cancel
        </a>
      </div>
    </form>
  );
}

function Field({
  label, name, required, children,
}: {
  label: string;
  name: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-zinc-400">
        {label}{required ? " *" : ""}
      </label>
      {children}
    </div>
  );
}
