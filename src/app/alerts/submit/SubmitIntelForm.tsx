"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitIntelTip } from "@/modules/alerts/actions";
import { enrichLibraryUrl } from "@/modules/library/enrich-url-action";
import { useSignIn } from "@/components/auth/SignInContext";
import { ErrorWithReport } from "@/components/ErrorWithReport";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const KINDS: { id: "bill_event" | "bop_hearing" | "fda_action" | "dea_action" | "ag_enforcement" | "news_break"; label: string; hint: string }[] = [
  { id: "bill_event",     label: "Bill / ordinance",   hint: "City council, county, or state legislative action" },
  { id: "bop_hearing",    label: "Pharmacy board",     hint: "Board of Pharmacy meeting agenda or rule" },
  { id: "ag_enforcement", label: "AG enforcement",     hint: "Attorney General presser, lawsuit, settlement" },
  { id: "fda_action",     label: "FDA",                hint: "FDA warning letter, import alert, statement" },
  { id: "dea_action",     label: "DEA",                hint: "DEA scheduling notice, raid, statement" },
  { id: "news_break",     label: "Other news",         hint: "Notable kratom news that doesn't fit above" },
];

const SEVERITIES: { id: "watch" | "alert" | "critical"; label: string; hint: string }[] = [
  { id: "watch",    label: "Watch",    hint: "Worth knowing — no urgent action needed" },
  { id: "alert",    label: "Alert",    hint: "Active situation members should respond to" },
  { id: "critical", label: "Critical", hint: "Imminent vote / hearing / deadline" },
];

export function SubmitIntelForm({
  defaultState,
  initialTitle = "",
  initialBody = "",
  initialUrl = "",
}: {
  defaultState: string;
  /** Prefilled from the PWA share target (manifest.ts) when a user
   *  shares a link/article into iKratom. Empty for normal visits. */
  initialTitle?: string;
  initialBody?: string;
  initialUrl?: string;
}) {
  const router = useRouter();
  const { user, requireSignIn } = useSignIn();
  const [kind, setKind] = useState<typeof KINDS[number]["id"]>("bill_event");
  const [severity, setSeverity] = useState<typeof SEVERITIES[number]["id"]>("watch");
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [locality, setLocality] = useState(defaultState || "");
  const [sourceUrl, setSourceUrl] = useState(initialUrl);
  const [occursAt, setOccursAt] = useState("");
  const [actionRequired, setActionRequired] = useState(false);
  const [anon, setAnon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Auto-fill state — paste a URL, click 📎, server enriches → prefills
  // title and body. Only overwrites when those fields are empty (won't
  // clobber what the user already typed).
  const [autofilling, startAutofill] = useTransition();
  const [autofillNote, setAutofillNote] = useState<string | null>(null);

  function onAutofill() {
    setError(null);
    setAutofillNote(null);
    if (!sourceUrl.trim()) {
      setError("Paste a source URL first.");
      return;
    }
    startAutofill(async () => {
      const r = await enrichLibraryUrl(sourceUrl.trim());
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const s = r.suggestion;
      const filled: string[] = [];
      if (!title && s.title) { setTitle(s.title.slice(0, 200)); filled.push("title"); }
      if (!body && s.description) { setBody(s.description.slice(0, 2000)); filled.push("body"); }
      setAutofillNote(
        filled.length > 0
          ? `Filled: ${filled.join(", ")}. Review below before submitting.`
          : "Source had no usable metadata — leaving your existing fields alone."
      );
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!user) {
      const ok = await requireSignIn();
      if (!ok) return;
    }
    startTransition(async () => {
      const r = await submitIntelTip({
        kind,
        severity,
        title,
        body,
        locality,
        source_url: sourceUrl || null,
        occurs_at: occursAt ? new Date(occursAt).toISOString() : null,
        action_required: actionRequired,
        is_anonymous: anon,
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.push("/pulse?tip_submitted=1");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      {/* Kind */}
      <div>
        <label className="block text-xs font-medium text-zinc-400">What kind of tip?</label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label
              key={k.id}
              className={`cursor-pointer rounded-md border p-3 text-sm transition ${
                kind === k.id
                  ? "border-emerald-500 bg-emerald-950/30"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={k.id}
                checked={kind === k.id}
                onChange={() => setKind(k.id)}
                className="sr-only"
              />
              <div className="font-semibold text-zinc-200">{k.label}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{k.hint}</div>
            </label>
          ))}
        </div>
      </div>

      {/* Severity */}
      <div>
        <label className="block text-xs font-medium text-zinc-400">How urgent?</label>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {SEVERITIES.map((s) => (
            <label
              key={s.id}
              className={`cursor-pointer rounded-md border p-2 text-center text-xs transition ${
                severity === s.id
                  ? s.id === "critical"
                    ? "border-red-500 bg-red-950/30"
                    : s.id === "alert"
                    ? "border-amber-500 bg-amber-950/30"
                    : "border-emerald-500 bg-emerald-950/30"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="severity"
                value={s.id}
                checked={severity === s.id}
                onChange={() => setSeverity(s.id)}
                className="sr-only"
              />
              <div className="font-semibold text-zinc-200">{s.label}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">{s.hint}</div>
            </label>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-zinc-400">Headline *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          placeholder='e.g. "Marshall, IL — city council to vote on kratom ban Tuesday"'
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          For city/county events, prefix with &quot;City, ST —&quot; so the auto-targeting picks up local officials.
        </p>
      </div>

      {/* Body */}
      <div>
        <label className="block text-xs font-medium text-zinc-400">Context (optional)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4_000}
          rows={5}
          placeholder="Who's involved, what's being proposed, why it matters. Quote the agenda or article. 1-2 paragraphs is plenty."
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-zinc-500">{body.length}/4,000</p>
      </div>

      {/* Locality + occurs_at side by side */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-400">Jurisdiction *</label>
          <select
            value={locality}
            onChange={(e) => setLocality(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">— pick one —</option>
            <option value="FED">Federal (Congress / FDA / DEA)</option>
            <option value="ALL">National / multistate</option>
            <optgroup label="States">
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400">When does it happen? (optional)</label>
          <input
            type="datetime-local"
            value={occursAt}
            onChange={(e) => setOccursAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-zinc-500">For meetings, hearings, or comment deadlines.</p>
        </div>
      </div>

      {/* Source URL */}
      <div>
        <label className="block text-xs font-medium text-zinc-400">Source link *</label>
        <div className="mt-1 flex gap-2">
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://newspaper.com/article  or  https://city.gov/agenda.pdf"
            maxLength={1_000}
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onAutofill}
            disabled={autofilling || pending || !sourceUrl.trim()}
            title="Fetch title + summary from the URL"
            className="shrink-0 rounded-md border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
          >
            {autofilling ? "Fetching…" : "📎 Auto-fill"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Tips without a verifiable source get rejected. Click <strong>📎 Auto-fill</strong> after pasting to grab the title + description from the URL.
        </p>
        {autofillNote && (
          <p className="mt-1 rounded border border-emerald-700/40 bg-emerald-950/15 px-2 py-1 text-[11px] text-emerald-300">
            {autofillNote}
          </p>
        )}
      </div>

      {/* Action required + anonymous */}
      <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={actionRequired}
            onChange={(e) => setActionRequired(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          <div className="text-sm">
            <div className="text-zinc-200">Members should take action on this</div>
            <div className="text-xs text-zinc-500">
              If checked + admin approves, a one-click solidarity campaign auto-spawns.
            </div>
          </div>
        </label>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={anon}
            onChange={(e) => setAnon(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          <span className="text-sm text-zinc-200">Submit anonymously (admins still see your account, but it isn&apos;t shown publicly)</span>
        </label>
      </div>

      {error && (
        <ErrorWithReport message={error} kind="intel_tip_submit" errorCode={null} />
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Submitting…" : !user ? "🔒 Sign in + send tip" : "Send tip to admin"}
        </button>
        <a href="/pulse" className="text-sm text-zinc-500 hover:text-zinc-300">Cancel</a>
      </div>

      <p className="text-[11px] text-zinc-500">
        Tips go through admin review. Most are triaged within hours during the workweek.
        Approved tips appear on /pulse with a campaign card; rejected tips include a note explaining why.
      </p>
    </form>
  );
}
