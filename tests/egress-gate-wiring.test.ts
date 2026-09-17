import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { REGISTRY } from "../scripts/lib/cron-pager-registry.mjs";
import { TIER_LIMITS } from "../scripts/lib/egress-budget.mjs";

/**
 * egress-gate-wiring.test.ts — the load-shedder must stay wired into the cron
 * fleet, and this is the guard that says so.
 *
 * WHY IT EXISTS (2026-09-17). `egress_gate` used to be a source in the pager
 * registry, on the belief that a row landed every time a gated workflow ran.
 * It does not: scripts/egress-gate.mjs writes scraper_runs ONLY on the DEFER
 * path, deliberately, because a row per pass would be a row every two hours in
 * the very table the staleness watchdog reads. So the healthy state — budget
 * fine, every cron running — produced no telemetry at all, the pager read that
 * silence as a dead job, and it paged the owner about a gate that was working.
 * A monitor that fires when nothing is wrong is worse than no monitor: it
 * teaches the owner to ignore the channel the real alerts arrive on.
 *
 * But the failure that entry was reaching for is real, and it is the nastiest
 * kind: if the gate step is dropped from a workflow, load-shedding stops and
 * NOTHING says so — the crons keep running, keep spending egress, and the first
 * symptom is Supabase restricting the project and the site going down (which is
 * what happened on 2026-07-16, before the gate existed).
 *
 * That failure is a static property of the workflow files, so it is checked
 * here instead, at PR time, which catches it in the change that causes it
 * rather than 12 hours later. Same shape as the registry↔writer guard in
 * tests/cron-pager-registry.test.ts: scan the real files, assert the invariant,
 * and keep a guard against the scan itself silently matching nothing.
 */

const WF_DIR = join(".github", "workflows");
const GATE_SCRIPT = "scripts/egress-gate.mjs";

/**
 * The workflows that MUST shed load. This list is the thing the pager entry was
 * standing in for: dropping a gate now means deleting a line here, in the diff,
 * where a reviewer sees it — not a silent edit inside a 400-line YAML file.
 *
 * Adding a workflow is handled by the reverse check below, so this list cannot
 * quietly fall behind the fleet.
 */
const MUST_GATE = [
  "cron-daily.yml",
  "cron-grounded-queues.yml",
  "cron-hourly.yml",
  "cron-localreps-cloud.yml",
  "cron-nightly-cloud.yml",
  "cron-weekly.yml",
  "news-backfill-burst.yml",
  "portrait-sync.yml",
  "topic-bills-sync.yml",
];

/**
 * Scheduled workflows that legitimately run ungated. Each needs a reason, and
 * the reason has to be "this does not spend Supabase egress" — not "it is small".
 */
const UNGATED_SCHEDULED: Record<string, string> = {
  "auto-patch-notes.yml":
    "reads git history and opens a PR; never touches Supabase, so there is no egress to shed",
  "auto-weekly-update.yml":
    "same — git log + changelog into a draft PR, no database reads",
};

type Job = {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps?: Array<{ id?: string; run?: string; uses?: string }>;
};
type Workflow = { name?: string; on?: unknown; jobs?: Record<string, Job> };

const files = readdirSync(WF_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

const parsed = files.map((file) => {
  const raw = readFileSync(join(WF_DIR, file), "utf8");
  const wf = load(raw) as Workflow & Record<string, unknown>;
  // `on:` is a YAML 1.1 boolean in some loaders, so it can land under the key
  // `true`. Accept both rather than depending on js-yaml's schema staying put.
  const triggers = (wf?.on ?? (wf as Record<string, unknown>)["true"]) as
    | Record<string, unknown>
    | undefined;
  const jobs = Object.entries(wf?.jobs ?? {});
  const gateJobs = jobs.filter(([, job]) =>
    (job.steps ?? []).some((s) => typeof s.run === "string" && s.run.includes(GATE_SCRIPT)),
  );
  return {
    file,
    raw,
    jobs,
    gateJobs,
    scheduled: Boolean(triggers && typeof triggers === "object" && "schedule" in triggers),
    gated: gateJobs.length > 0,
  };
});

const needsOf = (job: Job): string[] =>
  typeof job.needs === "string" ? [job.needs] : Array.isArray(job.needs) ? job.needs : [];

describe("egress gate wiring", () => {
  it("the scan actually parsed the workflow fleet", () => {
    // Without this, a rename of .github/workflows or a parse failure would make
    // every assertion below pass over an empty list.
    expect(files.length, "no workflow files found — the scan is broken").toBeGreaterThan(10);
    expect(
      parsed.filter((p) => p.jobs.length > 0).length,
      "no workflow parsed into jobs — js-yaml is not reading these files",
    ).toBeGreaterThan(10);
    expect(
      parsed.filter((p) => p.gated).length,
      "no workflow runs the egress gate at all — either the gate was removed fleet-wide or this scan no longer matches it",
    ).toBeGreaterThanOrEqual(MUST_GATE.length);
  });

  it("every workflow that must shed load still runs the gate", () => {
    const missing = MUST_GATE.filter((f) => !parsed.find((p) => p.file === f)?.gated);
    expect(
      missing,
      `These workflows are required to run ${GATE_SCRIPT} and no longer do. Load-shedding\n`
        + `is off for them: they will keep spending Supabase egress after the budget is\n`
        + `blown, which is how the project gets restricted and the site stops serving.\n`
        + `Restore the gate job, or remove the entry here with a reason: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("no scheduled workflow escapes the gate unlisted", () => {
    // The reverse direction, and the reason MUST_GATE can be a hand list: a new
    // scheduled cron is either gated, or explicitly excused here.
    const escaped = parsed
      .filter((p) => p.scheduled && !p.gated && !UNGATED_SCHEDULED[p.file])
      .map((p) => p.file);
    expect(
      escaped,
      `Scheduled workflow(s) run ungated. Add the budget job (see cron-hourly.yml) or,\n`
        + `if they genuinely read no Supabase data, document them in UNGATED_SCHEDULED: ${escaped.join(", ")}`,
    ).toEqual([]);

    // And keep the excuse list honest — a stale entry silently widens the hole.
    const stale = Object.keys(UNGATED_SCHEDULED).filter((f) => {
      const p = parsed.find((x) => x.file === f);
      return !p || p.gated || !p.scheduled;
    });
    expect(stale, `UNGATED_SCHEDULED entries that are gone, now gated, or not scheduled: ${stale.join(", ")}`).toEqual([]);
  });

  it("each gate publishes its verdict as a job output", () => {
    // A gate whose result never leaves its own job is decoration: the downstream
    // `if:` reads an empty string and the job runs regardless.
    const broken: string[] = [];
    for (const p of parsed.filter((x) => x.gated)) {
      for (const [name, job] of p.gateJobs) {
        const step = (job.steps ?? []).find((s) => s.run?.includes(GATE_SCRIPT));
        if (!step?.id) {
          broken.push(`${p.file} → job "${name}": the gate step has no \`id\`, so nothing can reference its outputs`);
          continue;
        }
        const out = job.outputs?.run;
        if (!out || !out.includes(`steps.${step.id}.outputs.run`)) {
          broken.push(
            `${p.file} → job "${name}": outputs.run must be \${{ steps.${step.id}.outputs.run }}, found ${out ?? "nothing"}`,
          );
        }
      }
    }
    expect(broken, `\n${broken.join("\n")}\n`).toEqual([]);
  });

  it("each gate actually gates at least one job", () => {
    const idle: string[] = [];
    for (const p of parsed.filter((x) => x.gated)) {
      for (const [gateName] of p.gateJobs) {
        const consumers = p.jobs.filter(
          ([, job]) =>
            needsOf(job).includes(gateName) &&
            typeof job.if === "string" &&
            new RegExp(`needs\\.${gateName}\\.outputs\\.run\\s*==\\s*'true'`).test(job.if),
        );
        if (consumers.length === 0) {
          idle.push(`${p.file} → job "${gateName}" runs the gate but no job defers on it`);
        }
      }
    }
    expect(idle, `\n${idle.join("\n")}\n`).toEqual([]);
  });

  it("every job that claims to be gated declares the dependency", () => {
    // `if: needs.budget.outputs.run == 'true'` without `needs: budget` does not
    // block the job — the expression evaluates against nothing and is falsy in a
    // way that has bitten other repos both directions. Make it impossible.
    const undeclared: string[] = [];
    for (const p of parsed) {
      for (const [name, job] of p.jobs) {
        if (typeof job.if !== "string") continue;
        for (const m of job.if.matchAll(/needs\.([A-Za-z0-9_-]+)\.outputs\.run/g)) {
          if (!needsOf(job).includes(m[1])) {
            undeclared.push(`${p.file} → job "${name}" reads needs.${m[1]}.outputs.run but does not list it in \`needs\``);
          }
        }
      }
    }
    expect(undeclared, `\n${undeclared.join("\n")}\n`).toEqual([]);
  });

  it("every gate runs a tier the budget library knows", () => {
    // A typo'd tier silently falls back to `normal` inside checkEgressBudget, so
    // a workflow meant to stop at 70% would keep running to 85%.
    const bad: string[] = [];
    for (const p of parsed.filter((x) => x.gated)) {
      for (const [name, job] of p.gateJobs) {
        const run = (job.steps ?? []).find((s) => s.run?.includes(GATE_SCRIPT))!.run!;
        const tier = run.match(/--tier\s+([a-z]+)/)?.[1];
        if (!tier) bad.push(`${p.file} → job "${name}": no --tier flag, so it defaults to "normal" by accident`);
        else if (!(tier in TIER_LIMITS)) bad.push(`${p.file} → job "${name}": unknown tier "${tier}"`);
      }
    }
    expect(bad, `\n${bad.join("\n")}\nKnown tiers: ${Object.keys(TIER_LIMITS).join(", ")}`).toEqual([]);
  });

  it("egress_gate stays out of the pager registry", () => {
    // The regression this whole file replaces. scripts/egress-gate.mjs writes
    // telemetry only when it DEFERS, so a registered entry pages the owner for
    // the healthy case. If the gate is ever changed to log every run, this
    // assertion — and the CONDITIONAL_WRITERS exemption in
    // tests/cron-pager-registry.test.ts — should come out together.
    const gateWritesOnPass = /if\s*\(\s*gate\.skip\s*\)/.test(
      readFileSync(join("scripts", "egress-gate.mjs"), "utf8"),
    );
    expect(gateWritesOnPass, "egress-gate.mjs no longer guards its scraper_runs insert with `if (gate.skip)` — re-check whether it can be registered with the pager again").toBe(true);
    expect(
      REGISTRY.filter((e: { source: string }) => e.source === "egress_gate"),
      "egress_gate is registered with the staleness pager again. It writes telemetry only on the DEFER path, so a healthy fleet writes nothing and the pager alerts continuously. Coverage for the gate lives in this file instead.",
    ).toEqual([]);
  });
});
