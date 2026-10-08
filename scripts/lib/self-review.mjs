/**
 * self-review.mjs — the pure half of scripts/weekly-self-review.mjs.
 *
 * Everything here is a function of its arguments: no Supabase, no network, no
 * clock, no process.env. That is the point. The review's whole value is its
 * judgement about decay, and judgement that only runs against the production
 * database is judgement nobody can check. These functions are unit-tested in
 * tests/weekly-self-review.test.ts against hand-built run histories, so the
 * classifier can be proven right without a single live row.
 *
 * The script keeps the IO: reading scraper_runs, calling the AI router,
 * posting the issue comment.
 */

/**
 * Scrub anything that looks like a credential out of text bound for a public
 * surface. Error messages are written by dozens of scripts and a hundred
 * upstream libraries; assuming they are clean is how a key ends up in a log.
 * Blunt on purpose — a false positive costs a few unreadable characters, a
 * false negative costs a secret.
 */
export function redact(text) {
  return String(text ?? "")
    .replace(/eyJ[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]")
    .replace(/\b(?:sk|pk|gsk|csk|nvapi|hf|xoxb|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{8,}/gi, "[redacted-key]")
    .replace(/([?&](?:key|token|api[_-]?key|access[_-]?token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .slice(0, 160);
}

/** Plain text only — no markup, no html — for anything rendered into a public issue. */
export function clean(v, max) {
  return String(v ?? "")
    .replace(/[`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

/**
 * Split raw scraper_runs rows into this window and the one before it, and
 * reduce each to per-source counters.
 */
export function summarise(rows, { windowStartMs }) {
  const blank = () => ({ runs: 0, errors: 0, empty: 0, rows: 0, lastError: null });
  const cur = new Map();
  const prev = new Map();
  for (const r of rows) {
    if (!r?.source) continue;
    const bucket = Date.parse(r.started_at) >= windowStartMs ? cur : prev;
    if (!bucket.has(r.source)) bucket.set(r.source, blank());
    const s = bucket.get(r.source);
    s.runs++;
    if (r.status === "error") {
      s.errors++;
      if (!s.lastError && r.error_message) s.lastError = redact(r.error_message);
    }
    if (r.status === "empty") s.empty++;
    s.rows += (r.rows_added ?? 0) + (r.rows_updated ?? 0);
  }
  return { cur, prev };
}

/**
 * Four decay classes, ordered by how blind the existing monitoring is to each.
 *
 * `quiet` is the reason this job exists. check-cron-staleness compares
 * finished_at against a cadence, so a source that runs exactly on schedule and
 * writes nothing every single time reads as perfectly healthy while its data
 * goes stale. Only a week-over-week comparison of OUTPUT can see it.
 */
export function findDecay(cur, prev, { registry, windowDays }) {
  const out = { silent: [], failing: [], quiet: [], shrinking: [], unregistered: [] };
  const registered = new Set(registry.map((e) => e.source));

  for (const e of registry) {
    // A weekly source legitimately has 0-1 runs in a 7-day window, so only
    // judge sources whose own cadence says they should have run in it.
    if (e.interval_hours > windowDays * 24) continue;
    if (!cur.has(e.source) && prev.has(e.source)) {
      out.silent.push({ source: e.source, priorRuns: prev.get(e.source).runs });
    }
  }

  for (const [source, s] of cur) {
    const p = prev.get(source) ?? { runs: 0, errors: 0, rows: 0 };

    if (s.errors > 0 && pct(s.errors, s.runs) > pct(p.errors, p.runs)) {
      out.failing.push({
        source,
        errors: s.errors,
        runs: s.runs,
        priorErrors: p.errors,
        priorRuns: p.runs,
        lastError: s.lastError,
      });
    }

    if (s.runs >= 3 && s.rows === 0 && s.errors === 0 && p.rows > 0) {
      out.quiet.push({ source, runs: s.runs, priorRows: p.rows });
    } else if (p.rows >= 20 && s.rows > 0 && s.rows < p.rows * 0.4) {
      out.shrinking.push({ source, rows: s.rows, priorRows: p.rows });
    }

    // Not decay, but the same blind spot from the other side: a source nothing
    // would page for. The CI guard catches scheduled scripts at PR time; this
    // catches anything that started writing telemetry some other way.
    if (!registered.has(source)) out.unregistered.push({ source, runs: s.runs });
  }

  out.failing.sort((a, b) => b.errors - a.errors);
  out.quiet.sort((a, b) => b.priorRows - a.priorRows);
  out.shrinking.sort((a, b) => b.priorRows - a.priorRows);
  return out;
}

export function findMovement(cur, prev) {
  const top = [...cur.entries()]
    .filter(([, s]) => s.rows > 0)
    .sort((a, b) => b[1].rows - a[1].rows)
    .slice(0, 10)
    .map(([source, s]) => ({ source, rows: s.rows, priorRows: prev.get(source)?.rows ?? 0 }));
  const fresh = [...cur.keys()].filter((s) => !prev.has(s));
  const sum = (m, k) => [...m.values()].reduce((a, s) => a + s[k], 0);
  return {
    top,
    fresh,
    totals: {
      sources: cur.size,
      runs: sum(cur, "runs"),
      errors: sum(cur, "errors"),
      rows: sum(cur, "rows"),
      priorRuns: sum(prev, "runs"),
      priorRows: sum(prev, "rows"),
    },
  };
}

/**
 * Validate and flatten whatever the model returned. The AI router asks every
 * provider for a JSON object, so a narrative is a shape to check rather than
 * prose to trust — and a provider that answers with the wrong shape is the
 * same outcome as one that did not answer at all.
 *
 * Throws when unusable, so the caller takes the degrade path.
 */
export function parseNarrative(parsed, provider) {
  const moved = clean(parsed?.moved, 800);
  const decayed = clean(parsed?.decayed, 800);
  const proposals = (Array.isArray(parsed?.proposals) ? parsed.proposals : [])
    .map((p) => ({ action: clean(p?.action, 300), because: clean(p?.because, 400) }))
    .filter((p) => p.action)
    .slice(0, 5);
  if (!moved || !proposals.length) {
    throw new Error(`${provider} returned an unusable shape (keys: ${Object.keys(parsed ?? {}).join(",") || "none"})`);
  }
  return { moved, decayed, proposals, provider };
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Render the published review. The evidence always goes out, whether or not
 * the model answered — an unreadable week is still a week of facts.
 */
export function renderMarkdown({ evidence, narrative, degraded, windowStartMs, nowMs }) {
  const { movement, decay, admin_actions: audit, merged_to_main: shipped } = evidence;
  const L = [];
  L.push(`## Weekly self-review — ${day(windowStartMs)} to ${day(nowMs)}`);
  L.push("");

  if (narrative) {
    L.push("### What moved");
    L.push("");
    L.push(narrative.moved);
    L.push("");
    L.push("### What decayed");
    L.push("");
    L.push(narrative.decayed || "Nothing the evidence shows.");
    L.push("");
    L.push("### What I would do next");
    L.push("");
    narrative.proposals.forEach((p, i) => L.push(`${i + 1}. **${p.action}** ${p.because}`));
    L.push("");
    L.push(`<sub>Drafted by \`${narrative.provider}\` from the evidence below. Nothing acts on these automatically.</sub>`);
  } else {
    L.push(
      "> **The judgement half of this review is missing.** The evidence below was gathered normally, " +
        "but no free model provider answered, so nothing wrote the \"what I would do next\" section. " +
        `Reason: \`${degraded}\`. Nothing was skipped because of it.`,
    );
  }

  L.push("");
  L.push("<details><summary>The evidence this was written from</summary>");
  L.push("");
  L.push(
    `**Activity.** ${movement.totals.runs} runs across ${movement.totals.sources} sources ` +
      `(${movement.totals.priorRuns} the week before), ${movement.totals.errors} errored, ` +
      `${movement.totals.rows.toLocaleString()} rows written ` +
      `(${movement.totals.priorRows.toLocaleString()} the week before).`,
  );
  L.push("");

  if (movement.top.length) {
    L.push("**Busiest sources**");
    L.push("");
    L.push("| source | rows this week | last week |");
    L.push("| --- | ---: | ---: |");
    for (const t of movement.top) {
      L.push(`| \`${t.source}\` | ${t.rows.toLocaleString()} | ${t.priorRows.toLocaleString()} |`);
    }
    L.push("");
  }
  if (movement.fresh.length) {
    L.push(`**First seen this week:** ${movement.fresh.map((s) => `\`${s}\``).join(", ")}`);
    L.push("");
  }

  const lines = [];
  for (const d of decay.quiet) {
    lines.push(
      `- \`${d.source}\` **ran ${d.runs} times and wrote nothing**, after ${d.priorRows.toLocaleString()} rows last week. ` +
        "The staleness pager cannot see this — the job is running on time.",
    );
  }
  for (const d of decay.failing) {
    lines.push(
      `- \`${d.source}\` failed ${d.errors} of ${d.runs} runs (was ${d.priorErrors} of ${d.priorRuns})` +
        (d.lastError ? `: \`${d.lastError}\`` : ""),
    );
  }
  for (const d of decay.silent) {
    lines.push(`- \`${d.source}\` did not run at all this week (${d.priorRuns} runs last week).`);
  }
  for (const d of decay.shrinking) {
    lines.push(`- \`${d.source}\` wrote ${d.rows.toLocaleString()} rows, down from ${d.priorRows.toLocaleString()}.`);
  }
  for (const d of decay.unregistered) {
    lines.push(`- \`${d.source}\` writes telemetry but is **not in the pager registry**, so nothing would alert if it died.`);
  }
  L.push("**Decay signals**");
  L.push("");
  L.push(lines.length ? lines.join("\n") : "- None. Every source that ran produced output and no failure rate rose.");
  L.push("");

  L.push(`**Admin changes.** ${audit.total} logged this week${audit.byAction?.length ? ":" : "."}`);
  if (audit.byAction?.length) {
    L.push("");
    for (const [action, n] of audit.byAction) L.push(`- \`${clean(action, 60)}\` × ${n}`);
  }
  L.push("");

  L.push(`**Merged to main.** ${shipped.length} commits${shipped.length ? ":" : "."}`);
  if (shipped.length) {
    L.push("");
    for (const s of shipped) L.push(`- ${clean(s, 160)}`);
  }
  L.push("");
  L.push("</details>");
  return L.join("\n");
}

/**
 * Decide whether missing publish credentials are an ordinary local run or a
 * broken workflow.
 *
 * WHY THIS IS NOT JUST `if (!token) return`. Inside Actions the token is
 * always available to the workflow, but it only reaches the SCRIPT through an
 * explicit `GITHUB_TOKEN:` line in the step's env block. Delete that one line
 * and the job reads a full week of telemetry, publishes to nobody, and exits
 * green — the exact "ran, did nothing, reported success" failure this whole
 * job exists to notice. A tool that cannot fail that way is worth three lines.
 *
 * Returns the credentials, returns null when publishing should be skipped
 * (a local run, where the operator is reading stdout), or throws when the
 * absence is a fault.
 */
export function resolvePublishEnv(env) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (token && repo) return { token, repo };
  if (env.GITHUB_ACTIONS) {
    const missing = [!token && "GITHUB_TOKEN", !repo && "GITHUB_REPOSITORY"].filter(Boolean).join(" and ");
    throw new Error(
      `running in GitHub Actions without ${missing} — the step's env block is missing it, or the value is empty. ` +
        "The review was gathered but could not be published to anyone.",
    );
  }
  return null;
}
