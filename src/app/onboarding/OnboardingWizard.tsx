"use client";

import { useState, useTransition } from "react";
import {
  saveAddressStep,
  saveClassStep,
  saveStakeStep,
  saveNotificationsStep,
  completeOnboarding,
  skipOnboarding,
} from "@/modules/onboarding/actions";
import { PushSubscribe } from "@/modules/auth/components/PushSubscribe";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const CLASSES: { id: string; label: string; tagline: string; bonus: string }[] = [
  { id: "consumer", label: "Consumer", tagline: "Daily user", bonus: "The base voice — most advocates fall here. Legislators expect to hear from you." },
  { id: "shop_owner", label: "Shop Owner", tagline: "You sell kratom", bonus: "Economic-impact angle, employees, local-business framing. Devastating in committee testimony." },
  { id: "medical_pro", label: "Medical Pro", tagline: "Doctor / nurse / pharmacist", bonus: "Outsized credibility on health & safety arguments. Medical board outreach unlocked." },
  { id: "family", label: "Family", tagline: "Loved one of a kratom user", bonus: "The 'this saved my husband' story is one of the most-cited in committee transcripts." },
  { id: "veteran", label: "Veteran", tagline: "Served in the U.S. military", bonus: "Massive narrative weight on the Hill — both sides want to be seen helping vets." },
  { id: "researcher", label: "Researcher", tagline: "Academic / industry", bonus: "You bring data. Quoted studies make staff fold." },
  { id: "leader", label: "Leader", tagline: "Org work, hearings, organized outreach", bonus: "Coalition framing. The 'speaking on behalf of X advocates' move." },
  { id: "other", label: "Other", tagline: "Doesn't fit above", bonus: "No bonus — pick something else if you can." },
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

// Push moved from step 5/5 → 3/5 (right after location is known). Earlier
// in the funnel = higher activation rate. Browser requires user gesture
// to fire Notification.requestPermission(), so we ask the moment the
// state is in scope so the value prop is concrete.
const STEPS = ["welcome", "class", "where", "push", "stake", "alerts", "done"] as const;
type Step = (typeof STEPS)[number];

export function OnboardingWizard({
  initialProfile,
  vapidPublicKey,
}: {
  initialProfile: InitialProfile;
  vapidPublicKey: string | null;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [advocateType, setAdvocateType] = useState<string>(
    initialProfile.is_shop_owner ? "shop_owner"
    : initialProfile.is_medical_professional ? "medical_pro"
    : ""
  );

  function next() {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }

  function back() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  function submitClass(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveClassStep(fd);
      if (r.error) setError(r.error);
      else next();
    });
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

  function submitStake(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveStakeStep(fd);
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
    if (!confirm("Skip character creation? You can finish from /account anytime.")) return;
    startTransition(async () => {
      await skipOnboarding();
    });
  }

  // Progress dots: welcome → class → where → stake → alerts (done is final)
  const totalDots = 5;
  const currentDot = Math.min(STEPS.indexOf(step), totalDots - 1);

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
            Character Creation
          </p>
          <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
            Let&apos;s build your advocate.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-zinc-400">
            iKratom is the advocate&apos;s toolbelt. The next 60 seconds shape how the platform
            writes in <strong className="text-zinc-200">your voice</strong> — what stories
            it picks up on, which legislators you reach, what alerts you get.
          </p>
          <ul className="mx-auto mt-8 max-w-md space-y-3 text-left text-sm">
            <Bullet emoji="🎭">Pick a class — drives the voice of your legislator emails</Bullet>
            <Bullet emoji="📍">Drop your pin — matches you to your specific reps</Bullet>
            <Bullet emoji="🔥">Name your stake — the one line that makes the bill matter</Bullet>
            <Bullet emoji="🔔">Set your alerts — only what hits your district + your interests</Bullet>
          </ul>
          <button
            onClick={next}
            className="mt-10 rounded-md bg-emerald-500 px-8 py-3 font-bold text-zinc-950 hover:bg-emerald-400"
          >
            Start →
          </button>
          <p className="mt-4 text-xs text-zinc-500">
            All optional. All editable later. Nonpartisan. Independent.
          </p>
        </div>
      )}

      {step === "class" && (
        <form onSubmit={submitClass} className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Step 1 of 4 · Pick your class
            </p>
            <h2 className="mt-2 text-3xl font-bold">Who are you fighting as?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Drives the default tone of your legislator emails. Veterans and medical
              pros get extra narrative weight by default. Pick the one that fits best
              — you can change it later.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {CLASSES.map((c) => (
              <label
                key={c.id}
                className="cursor-pointer rounded-md border border-zinc-800 p-3 text-sm transition has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-950/20 hover:border-zinc-700"
              >
                <input
                  type="radio"
                  name="advocate_type"
                  value={c.id}
                  checked={advocateType === c.id}
                  onChange={(e) => setAdvocateType(e.target.value)}
                  className="sr-only"
                />
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-zinc-100">{c.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">{c.tagline}</span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">{c.bonus}</p>
              </label>
            ))}
          </div>

          {advocateType === "shop_owner" && (
            <Field
              name="shop_name"
              label="Shop name (optional)"
              defaultValue={initialProfile.shop_name}
              placeholder="Your shop's name"
            />
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400">
              Years using kratom <span className="text-zinc-600">(optional, 0–80)</span>
            </label>
            <input
              type="number"
              name="kratom_years"
              min={0}
              max={80}
              placeholder="—"
              className="mt-1 w-32 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Surfaced in legislator letters (&ldquo;An 11-year kratom user from Toledo&rdquo;). Skip if you&apos;d rather not say.
            </p>
          </div>

          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <Nav back={back} canBack pending={pending} nextLabel="Drop my pin →" />
        </form>
      )}

      {step === "where" && (
        <form onSubmit={submitAddress} className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Step 2 of 4 · Drop your pin
            </p>
            <h2 className="mt-2 text-3xl font-bold">Where do you fight?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Used <strong className="text-zinc-200">only</strong> to match you to your
              specific U.S. House + state legislative districts so the right reps get
              your emails.
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

      {step === "stake" && (
        <form onSubmit={submitStake} className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Step 3 of 4 · Name your stake
            </p>
            <h2 className="mt-2 text-3xl font-bold">What would you lose if it&apos;s banned?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              One sentence. <strong className="text-emerald-300">Specifics land harder than generalities.</strong>
              {" "}This is the line iKratom will surface — with your permission — when your
              legislator email needs to make a bill <em>matter</em>.
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Stays private. Never shown to other users. Never sold or shared.
            </p>
          </div>

          <div>
            <textarea
              name="lose_if_banned"
              maxLength={500}
              rows={5}
              placeholder='e.g. "I would go back to opioids within a month — and I&apos;d be one more statistic Big Pharma uses to sell more pills."'
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-zinc-500">Up to 500 characters. Skip if you&apos;d rather write it later.</p>
          </div>

          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <Nav back={back} canBack pending={pending} nextLabel="Continue →" />
        </form>
      )}

      {step === "alerts" && (
        <form onSubmit={submitNotifications} className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Step 4 of 4 · Tune your alerts
            </p>
            <h2 className="mt-2 text-3xl font-bold">What should we ping you about?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              When new campaigns drop. You can fine-tune anytime from your account.
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

          <Nav back={back} canBack pending={pending} nextLabel="One more step →" />
        </form>
      )}

      {step === "push" && (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Step 5 of 5 · Get real-time alerts
            </p>
            <h2 className="mt-2 text-3xl font-bold">Don&apos;t miss a vote.</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Enable browser notifications and we&apos;ll push you the moment a
              kratom bill, hearing, or city ordinance moves in
              {" "}<strong className="text-zinc-100">{initialProfile.state || "your state"}</strong>.
              You can turn this off anytime.
            </p>
          </div>

          {/* Concrete value-prop list — what users actually get from saying yes */}
          <ul className="space-y-2 rounded-md border border-emerald-700/30 bg-emerald-950/10 p-4 text-sm text-zinc-300">
            <li className="flex items-start gap-2">
              <span aria-hidden>🚨</span>
              <span><strong className="text-emerald-300">LIVE meeting alerts</strong> — city council or BoP hearing on kratom starts → push within seconds</span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden>📅</span>
              <span><strong className="text-emerald-300">Calendar reminders</strong> — 7 days, 3 days, and 1 day before any approved meeting</span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden>📰</span>
              <span><strong className="text-emerald-300">Critical news alerts</strong> — DEA action, bill signing, AG move, ordinance vote in your state</span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden>🎯</span>
              <span><strong className="text-emerald-300">Personalized only</strong> — we filter by your state, so you don&apos;t get pinged about Idaho if you live in Texas</span>
            </li>
          </ul>

          {/* Hard privacy beat — same tone as the invite page */}
          <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] text-zinc-400">
            🔒 <strong className="text-zinc-200">No tracking, no data sales.</strong>{" "}
            Push notifications are delivered through your browser&apos;s built-in
            mechanism. We only see WHEN we sent you a push, not what you do
            after. You can disable anytime in /account/security.
          </p>

          {/* The actual subscribe button — handles browser permission prompt */}
          <PushSubscribe vapidPublicKey={vapidPublicKey} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={back}
              disabled={pending}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={next}
              disabled={pending}
              className="rounded-md bg-emerald-500 px-6 py-2 text-sm font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl text-zinc-950">
            ✓
          </div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Character ready
          </p>
          <h2 className="mt-2 text-3xl font-bold">Your advocate is built.</h2>
          <p className="mx-auto mt-4 max-w-md text-zinc-400">
            Your dashboard is waiting. Look for the
            {" "}<strong className="text-emerald-400">Your representatives</strong>{" "}
            section — those are the specific officials we&apos;ll route your emails to
            when a campaign matches your district.
          </p>
          <p className="mx-auto mt-3 max-w-md text-xs text-zinc-500">
            Want to write a longer kratom story, upload a video clip, or change your
            class later? Visit <span className="font-mono text-zinc-300">/account/character</span>.
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
