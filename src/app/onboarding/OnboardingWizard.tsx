"use client";

import { useState, useTransition } from "react";
import {
  saveAddressStep,
  saveRolesStep,
  saveNotificationsStep,
  completeOnboarding,
  skipOnboarding,
} from "@/modules/onboarding/actions";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

type InitialProfile = {
  full_name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  is_shop_owner: boolean;
  shop_name: string;
  is_medical_professional: boolean;
};

const STEPS = ["welcome", "address", "you", "notifications", "done"] as const;
type Step = (typeof STEPS)[number];

export function OnboardingWizard({ initialProfile }: { initialProfile: InitialProfile }) {
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [isShop, setIsShop] = useState(initialProfile.is_shop_owner);

  function next() {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }

  function back() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  function submitAddress(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveAddressStep(fd);
      if (r.error) setError(r.error);
      else next();
    });
  }

  function submitRoles(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveRolesStep(fd);
      if (r.error) setError(r.error);
      else next();
    });
  }

  function submitNotifications(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveNotificationsStep(fd);
      if (r.error) setError(r.error);
      else next();
    });
  }

  function finish() {
    startTransition(async () => {
      await completeOnboarding();
    });
  }

  function skipAll() {
    if (!confirm("Skip the welcome tour? You can complete your profile later from /account.")) return;
    startTransition(async () => {
      await skipOnboarding();
    });
  }

  // Progress dots
  const totalDots = 4; // welcome → address → you → notifications (done is final)
  const currentDot = Math.min(STEPS.indexOf(step), 3);

  return (
    <div>
      {/* Progress */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex gap-2">
          {Array.from({ length: totalDots }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-10 rounded-full transition ${
                i < currentDot ? "bg-emerald-500" : i === currentDot ? "bg-emerald-700" : "bg-zinc-800"
              }`}
            />
          ))}
        </div>
        {step !== "welcome" && step !== "done" && (
          <button onClick={skipAll} className="text-xs text-zinc-500 hover:text-emerald-400">
            Skip for now
          </button>
        )}
      </div>

      {step === "welcome" && (
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Welcome to the war room
          </p>
          <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
            You&apos;re in. Let&apos;s get you set up in 60 seconds.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-zinc-400">
            iKratom is the advocate&apos;s toolbelt — emails to your reps in one click, real-time
            bill alerts, encrypted DMs with other advocates, all anchored to your state and city.
          </p>
          <ul className="mx-auto mt-8 max-w-md space-y-3 text-left text-sm">
            <Bullet emoji="📍">Your address (private) → we match you to your specific reps</Bullet>
            <Bullet emoji="🎯">Pick what you care about → only relevant alerts</Bullet>
            <Bullet emoji="🔒">DMs are end-to-end encrypted, key never leaves your device</Bullet>
            <Bullet emoji="🤝">Nonpartisan. Independent. Owned by no advocacy org.</Bullet>
          </ul>
          <button
            onClick={next}
            className="mt-10 rounded-md bg-emerald-500 px-8 py-3 font-bold text-zinc-950 hover:bg-emerald-400"
          >
            Let&apos;s go →
          </button>
        </div>
      )}

      {step === "address" && (
        <form onSubmit={submitAddress} className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Step 1 of 3
            </p>
            <h2 className="mt-2 text-3xl font-bold">Where do you live?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Used <strong className="text-zinc-200">only</strong> to match you to your
              specific U.S. House and state legislative districts so the right
              legislators get your emails.
            </p>
            <ul className="mt-3 space-y-1 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-400">
              <li>· Other users never see your address — only your city + state if you choose.</li>
              <li>· We don&apos;t sell, share, or transfer it to advocacy orgs.</li>
              <li>· You can delete it anytime from <span className="font-mono text-zinc-300">/account</span>.</li>
            </ul>
          </div>

          <Field name="full_name" label="Full name" defaultValue={initialProfile.full_name} required />
          <Field name="street" label="Street" defaultValue={initialProfile.street} placeholder="123 Main St" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="city" label="City" defaultValue={initialProfile.city} />
            <Select name="state" label="State" defaultValue={initialProfile.state}>
              <option value="">—</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Field name="zip" label="ZIP" defaultValue={initialProfile.zip} placeholder="12345" />
          </div>

          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <Nav back={back} canBack pending={pending} nextLabel="Continue →" />
        </form>
      )}

      {step === "you" && (
        <form onSubmit={submitRoles} className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Step 2 of 3
            </p>
            <h2 className="mt-2 text-3xl font-bold">Tell us about you</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Optional. Helps us tag the community and lets you weigh in on out-of-state campaigns
              when relevant.
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
              <input
                type="checkbox"
                name="is_shop_owner"
                checked={isShop}
                onChange={(e) => setIsShop(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              <span>
                <span className="font-medium">I own or manage a kratom shop</span>
                <span className="block text-xs text-zinc-500">
                  Shop owners can weigh in on local campaigns out-of-state and join private shop-owner groups.
                </span>
              </span>
            </label>
            {isShop && (
              <Field name="shop_name" label="Shop name" defaultValue={initialProfile.shop_name} placeholder="Your shop's name" />
            )}
            <label className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
              <input
                type="checkbox"
                name="is_medical_professional"
                defaultChecked={initialProfile.is_medical_professional}
                className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              <span>
                <span className="font-medium">I&apos;m a medical professional</span>
                <span className="block text-xs text-zinc-500">
                  Doctor, nurse, pharmacist, etc. — you can contribute to medical-board outreach campaigns.
                </span>
              </span>
            </label>
          </div>

          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <Nav back={back} canBack pending={pending} nextLabel="Continue →" />
        </form>
      )}

      {step === "notifications" && (
        <form onSubmit={submitNotifications} className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Step 3 of 3
            </p>
            <h2 className="mt-2 text-3xl font-bold">What should we tell you about?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              When new campaigns drop. You can fine-tune anytime in your account.
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-5 text-sm">
            <CheckRow name="notify_state_campaigns" defaultChecked>
              New campaigns in my state
            </CheckRow>
            <CheckRow name="notify_local_campaigns" defaultChecked>
              New campaigns in my city or county
            </CheckRow>
            <CheckRow name="notify_federal_campaigns" defaultChecked>
              New federal campaigns (U.S. House / Senate)
            </CheckRow>
          </div>

          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <Nav back={back} canBack pending={pending} nextLabel="Almost done →" />
        </form>
      )}

      {step === "done" && (
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl text-zinc-950">
            ✓
          </div>
          <h2 className="mt-6 text-3xl font-bold">You&apos;re ready.</h2>
          <p className="mx-auto mt-4 max-w-md text-zinc-400">
            Your dashboard is waiting. Look for the <strong className="text-emerald-400">Your representatives</strong> section
            — those are the specific officials we&apos;ll contact for you when a campaign matches your district.
          </p>
          <button
            onClick={finish}
            disabled={pending}
            className="mt-10 rounded-md bg-emerald-500 px-8 py-3 font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {pending ? "Loading…" : "Open my dashboard →"}
          </button>
        </div>
      )}
    </div>
  );
}

function Bullet({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="text-xl">{emoji}</span>
      <span className="text-zinc-300">{children}</span>
    </li>
  );
}

function Field({
  name, label, required, defaultValue, placeholder,
}: { name: string; label: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}{required ? " *" : ""}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
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

function CheckRow({
  name, defaultChecked, children,
}: { name: string; defaultChecked?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
      />
      {children}
    </label>
  );
}

function Nav({
  back, canBack, pending, nextLabel,
}: { back: () => void; canBack: boolean; pending: boolean; nextLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {canBack ? (
        <button type="button" onClick={back} className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500">
          ← Back
        </button>
      ) : <span />}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-500 px-6 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Saving…" : nextLabel}
      </button>
    </div>
  );
}
