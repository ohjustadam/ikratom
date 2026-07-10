"use client";

import { useMemo, useState, useTransition } from "react";
import { createCampaign } from "../campaign-actions";

type Geography = "federal" | "state" | "local";

type WizardLegislator = {
  id: string;
  full_name: string;
  role: string;
  level: string | null;
  state: string;
  district: string | null;
  locality: string | null;
  title: string | null;
  party: string | null;
  email: string | null;
  hasContact: boolean;
};

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const ROLE_LABEL: Record<string, string> = {
  us_senate: "U.S. Senate",
  us_house: "U.S. House",
  state_senate: "State Senate",
  state_house: "State House",
  mayor: "Mayor",
  city_council: "City Council",
  county_executive: "County Executive",
  county_commissioner: "County Commissioner",
  school_board: "School Board",
  other_local: "Other",
};

const DEFAULT_SUBJECT = "Constituent input on kratom policy in {{state}}";
const DEFAULT_BODY = `Dear {{legislator_name}},

My name is {{full_name}} and I am a constituent in {{city}}, {{state}} {{zip}}. I am writing about kratom policy in our community.

[Your specific message about the bill or issue here.]

Thank you for your service.

Sincerely,
{{full_name}}
{{city}}, {{state}} {{zip}}`;

export function CampaignWizard({
  legislators,
  localities,
  prefill,
}: {
  legislators: WizardLegislator[];
  localities: string[];
  prefill?: { state: string | null; title: string; bodyMd: string };
}) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Step 1: Basics — accept prefill from /admin/campaigns/new?from_thread=
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [blurb, setBlurb] = useState("");
  const [bodyMd, setBodyMd] = useState(prefill?.bodyMd ?? "");

  // Step 2: Geography + targets
  const [geo, setGeo] = useState<Geography>("state");
  const [state, setState] = useState(prefill?.state ?? "OK");
  const [locality, setLocality] = useState("");
  const [pickedRoles, setPickedRoles] = useState<Set<string>>(
    new Set(["state_senate", "state_house"])
  );
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [useExplicitIds, setUseExplicitIds] = useState(false);

  // Step 3: Message
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [active, setActive] = useState(true);
  const [allowNonResidents, setAllowNonResidents] = useState(false);

  // Filter the legislators visible at the current geo + state + locality
  const visible = useMemo(() => {
    if (geo === "federal") {
      return legislators.filter((l) => l.level === "federal");
    }
    if (geo === "state") {
      return legislators.filter(
        (l) => (l.level === "state" || l.level === "federal") && l.state === state
      );
    }
    if (geo === "local") {
      if (!locality) return [];
      return legislators.filter(
        (l) =>
          (l.level === "municipal" || l.level === "county") &&
          l.locality === locality
      );
    }
    return [];
  }, [legislators, geo, state, locality]);

  // When entering local, default to selecting all visible IDs
  function selectAllVisible() {
    setPickedIds(new Set(visible.map((l) => l.id)));
    setUseExplicitIds(true);
  }

  function toggleRole(r: string) {
    setPickedRoles((s) => {
      const next = new Set(s);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  function toggleId(id: string) {
    setPickedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function effectiveCampaignState() {
    if (geo === "federal") return null;
    return state;
  }

  function effectiveLocality() {
    if (geo === "local") return locality || null;
    return null;
  }

  function effectiveTargetIds(): string[] | null {
    if (useExplicitIds) return Array.from(pickedIds);
    return null;
  }

  function effectiveTargetRoles(): string[] {
    if (useExplicitIds) return [];
    return Array.from(pickedRoles);
  }

  function targetsPreview(): WizardLegislator[] {
    if (useExplicitIds) {
      return visible.filter((l) => pickedIds.has(l.id));
    }
    return visible.filter((l) => pickedRoles.has(l.role));
  }

  function step1Valid() {
    return title.trim().length > 0;
  }

  function step2Valid() {
    if (geo === "local" && !locality.trim()) return false;
    if (useExplicitIds) return pickedIds.size > 0;
    return pickedRoles.size > 0;
  }

  function step3Valid() {
    return subject.trim().length > 0 && body.trim().length > 0;
  }

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("title", title);
    fd.set("blurb", blurb);
    fd.set("body_md", bodyMd);
    const s = effectiveCampaignState();
    fd.set("state", s ?? "");
    const loc = effectiveLocality();
    if (loc) fd.set("target_locality", loc);
    const ids = effectiveTargetIds();
    if (ids) fd.set("target_legislator_ids", ids.join(","));
    for (const r of effectiveTargetRoles()) fd.set(`role_${r}`, "on");
    fd.set("subject_template", subject);
    fd.set("body_template", body);
    if (active) fd.set("active", "on");
    if (allowNonResidents) fd.set("allow_non_residents", "on");

    startTransition(async () => {
      const result = await createCampaign(fd);
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      {step === 1 && (
        <Section title="Basics — what is this campaign?">
          <Field label="Title *" value={title} onChange={setTitle} placeholder="Tell your reps to oppose Tulsa's kratom ban" />
          <Field
            label="Short blurb (1–2 sentences, shown on cards)"
            value={blurb}
            onChange={setBlurb}
            placeholder="A proposed ordinance would ban kratom sales in Tulsa city limits. Tell council members to vote no."
          />
          <Textarea
            label="Why this matters (full description, optional)"
            value={bodyMd}
            onChange={setBodyMd}
            rows={6}
            placeholder="Background, talking points, why constituents should care."
          />
          <Nav
            onNext={() => setStep(2)}
            nextDisabled={!step1Valid()}
          />
        </Section>
      )}

      {step === 2 && (
        <Section title="Where + Who — pick the targets">
          <div>
            <label className="block text-xs font-medium text-zinc-400">Scope</label>
            <div className="mt-2 flex flex-wrap gap-2">
              <ScopeChip active={geo === "federal"} onClick={() => setGeo("federal")}>Federal</ScopeChip>
              <ScopeChip active={geo === "state"} onClick={() => setGeo("state")}>State</ScopeChip>
              <ScopeChip active={geo === "local"} onClick={() => setGeo("local")}>Local (city / county)</ScopeChip>
            </div>
          </div>

          {geo !== "federal" && (
            <Select label="State" value={state} onChange={setState}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          )}

          {geo === "local" && (
            <div>
              <label className="block text-xs font-medium text-zinc-400">Locality</label>
              <input
                list="localities"
                value={locality}
                onChange={(e) => { setLocality(e.target.value); setPickedIds(new Set()); }}
                placeholder="Tulsa, OK  ·  or  ·  Tulsa County, OK"
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <datalist id="localities">
                {localities.filter((l) => l.endsWith(`, ${state}`)).map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-zinc-500">
                {visible.length === 0 && locality
                  ? <>No officials on file for &ldquo;{locality}&rdquo;. <a href="/admin/locals/new" target="_blank" className="text-emerald-400 hover:underline">Add some →</a></>
                  : visible.length > 0
                    ? `${visible.length} officials available in ${locality}`
                    : "Type or pick from existing localities"}
              </p>
            </div>
          )}

          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-400">Target by:</p>
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setUseExplicitIds(false)}
                  className={`rounded px-2 py-1 ${!useExplicitIds ? "bg-emerald-500 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}
                >
                  Role
                </button>
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className={`rounded px-2 py-1 ${useExplicitIds ? "bg-emerald-500 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}
                >
                  Specific people
                </button>
              </div>
            </div>

            {!useExplicitIds ? (
              <div className="mt-3 space-y-1.5">
                {Array.from(new Set(visible.map((l) => l.role))).map((r) => {
                  const inRole = visible.filter((l) => l.role === r);
                  return (
                    <label key={r} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={pickedRoles.has(r)}
                        onChange={() => toggleRole(r)}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                      />
                      <span className="flex-1">
                        {ROLE_LABEL[r] ?? r}{" "}
                        <span className="text-xs text-zinc-500">({inRole.length})</span>
                      </span>
                    </label>
                  );
                })}
                {visible.length === 0 && (
                  <p className="text-xs text-zinc-500">Pick a state{geo === "local" ? " and locality" : ""} above to see options.</p>
                )}
              </div>
            ) : (
              <div className="mt-3 max-h-72 overflow-y-auto space-y-1">
                {visible.map((l) => (
                  <label key={l.id} className="flex items-start gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-900">
                    <input
                      type="checkbox"
                      checked={pickedIds.has(l.id)}
                      onChange={() => toggleId(l.id)}
                      className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{l.full_name}</span>
                      <span className="ml-2 text-xs text-zinc-500">
                        {l.title || ROLE_LABEL[l.role]}
                        {l.district && ` · D${l.district}`}
                        {l.party && ` · ${l.party.slice(0, 1)}`}
                      </span>
                      {!l.hasContact && (
                        <span className="ml-2 rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300">no contact</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Preview targets={targetsPreview()} />

          <Nav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!step2Valid()}
          />
        </Section>
      )}

      {step === 3 && (
        <Section title="Message — what gets sent">
          <Field
            label="Subject *"
            value={subject}
            onChange={setSubject}
          />
          <Textarea
            label="Body * — placeholders: {{full_name}}, {{city}}, {{state}}, {{zip}}, {{legislator_name}} (street is never included — privacy)"
            value={body}
            onChange={setBody}
            rows={14}
            mono
          />
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              Activate immediately
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowNonResidents}
                onChange={(e) => setAllowNonResidents(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              <span>
                <span className="font-medium">Allow non-residents to send too</span>
                <span className="block text-xs text-zinc-500">
                  Useful when out-of-state advocates (doctors, shop owners, etc.) want to weigh in. They&apos;ll see a notice that they aren&apos;t a constituent.
                </span>
              </span>
            </label>
          </div>

          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !step3Valid()}
              className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create campaign"}
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const labels = ["Basics", "Where + Who", "Message"];
  return (
    <ol className="flex items-center gap-1 text-xs">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <li key={l} className="flex items-center gap-1">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                active
                  ? "bg-emerald-500 text-zinc-950"
                  : done
                  ? "bg-emerald-700 text-zinc-100"
                  : "bg-zinc-900 text-zinc-500"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={active ? "text-zinc-100" : "text-zinc-500"}>{l}</span>
            {n < labels.length && <span className="mx-2 text-zinc-700">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Nav({
  onBack, onNext, nextDisabled,
}: { onBack?: () => void; onNext: () => void; nextDisabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
        >
          ← Back
        </button>
      ) : <span />}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        Next →
      </button>
    </div>
  );
}

function ScopeChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
        active
          ? "border-emerald-500 bg-emerald-500 text-zinc-950"
          : "border-zinc-800 text-zinc-400 hover:border-emerald-500"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (s: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}

function Textarea({
  label, value, onChange, rows, placeholder, mono,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows ?? 6}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none ${mono ? "font-mono text-xs leading-relaxed" : ""}`}
      />
    </div>
  );
}

function Select({
  label, value, onChange, children,
}: { label: string; value: string; onChange: (s: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      >
        {children}
      </select>
    </div>
  );
}

function Preview({ targets }: { targets: WizardLegislator[] }) {
  if (targets.length === 0) {
    return (
      <p className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
        No targets selected yet.
      </p>
    );
  }
  return (
    <div className="rounded-md border border-emerald-900/40 bg-emerald-950/10 p-3">
      <p className="mb-2 text-xs font-semibold text-emerald-300">
        ✓ {targets.length} target{targets.length === 1 ? "" : "s"}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {targets.slice(0, 16).map((t) => (
          <li key={t.id} className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200">
            {t.title || t.role.replace(/_/g, " ")}: {t.full_name}
          </li>
        ))}
        {targets.length > 16 && (
          <li className="rounded px-2 py-0.5 text-xs text-zinc-500">
            …and {targets.length - 16} more
          </li>
        )}
      </ul>
    </div>
  );
}
