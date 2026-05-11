"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFieldSignup } from "@/modules/leader/field-signup-actions";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export function FieldSignupForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [zip, setZip] = useState("");
  const [state, setState] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ name: string; wasExisting: boolean } | null>(null);

  function reset() {
    setEmail("");
    setFirstName("");
    setZip("");
    setState("");
    setConsent(false);
    setError(null);
    setSuccess(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await createFieldSignup({
        email,
        firstName,
        zip,
        state: state || null,
        consent,
      });
      if ("error" in r && r.error) {
        setError(r.error);
      } else if ("ok" in r && r.ok) {
        setSuccess({ name: r.recruitFirstName, wasExisting: r.wasExisting });
        router.refresh(); // refresh the today-count
      }
    });
  }

  if (success) {
    return (
      <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-6 text-center">
        <p className="text-4xl">{success.wasExisting ? "👋" : "✓"}</p>
        <h2 className="mt-3 text-xl font-bold text-emerald-300">
          {success.wasExisting
            ? `${success.name} is back — sign-in link sent`
            : `${success.name} is signed up`}
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          {success.wasExisting
            ? "They already had an account. We sent them a fresh magic-link to sign in. They keep their previous profile."
            : "Magic-link email is on its way. They click it to set their password + finish their profile."}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          You&apos;ll see them on your <a href="/leader" className="text-emerald-400 hover:underline">recruits list</a> once they activate.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Onboard another →
          </button>
          <a
            href="/leader"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
          >
            Back to workshop
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div>
        <label className="block text-xs font-medium text-zinc-400">
          Their email <span className="text-emerald-400">*</span>
        </label>
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="advocate@email.com"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3 text-base focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">
          First name <span className="text-emerald-400">*</span>
        </label>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
          maxLength={60}
          placeholder="First name only"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3 text-base focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-[10px] text-zinc-500">
          They&apos;ll add their full name themselves on /account.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400">
            ZIP <span className="text-emerald-400">*</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{5}(-\d{4})?"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            required
            maxLength={10}
            placeholder="12345"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3 text-base focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400">State (optional)</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3 text-base focus:border-emerald-500 focus:outline-none"
          >
            <option value="">—</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
        />
        <span className="text-sm text-zinc-200">
          I confirm this person <strong>verbally consented</strong> in person to receiving a magic-link email from iKratom right now.
        </span>
      </label>

      {error && (
        <p className="rounded-md border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !email || !firstName || !zip || !consent}
        className="w-full rounded-md bg-emerald-500 py-3 text-base font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Sending magic link…" : "Send sign-up link →"}
      </button>

      <p className="text-center text-[10px] text-zinc-500">
        They&apos;ll get an email from iKratom within ~30 seconds. Tell them to check spam.
      </p>
    </form>
  );
}
