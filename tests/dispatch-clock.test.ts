/**
 * dispatch-clock.test.ts — the database clock and the workflows agree.
 *
 * GitHub's own schedule ran cron-hourly 3 times in 24h on 2026-10-06, so
 * Supabase pg_cron dispatches it on time (migration 0263). This holds the
 * three pieces together: every clocked workflow accepts workflow_dispatch,
 * de-duplicates its late scheduled run, and is actually scheduled in SQL.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import yaml from "js-yaml";

const sql = fs.readFileSync("supabase/migrations/0263_github_dispatch_clock.sql", "utf8");
const clocked = [...sql.matchAll(/cron\.schedule\('[^']+', '([^']+)', \$\$select public\.dispatch_github_workflow\('([a-z0-9-]+\.yml)'\)\$\$\)/g)]
  .map((m) => ({ cron: m[1], file: m[2] }));

describe("database dispatch clock", () => {
  it("schedules the hourly and daily workflows (guards against a scan that matches nothing)", () => {
    expect(clocked.map((c) => c.file).sort()).toEqual(["cron-daily.yml", "cron-hourly.yml"]);
  });

  for (const { file } of clocked) {
    it(`${file} accepts dispatch and cancels a late scheduled duplicate`, () => {
      const wf = yaml.load(fs.readFileSync(`.github/workflows/${file}`, "utf8")) as {
        on: Record<string, unknown>; jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps?: { run?: string }[] }>;
      };
      expect(wf.on).toHaveProperty("workflow_dispatch");
      expect(wf.on).toHaveProperty("schedule"); // the fallback stays
      const clock = wf.jobs.clock;
      expect(clock?.if).toBe("github.event_name == 'schedule'");
      expect(clock?.permissions?.actions).toBe("write");
      const run = clock?.steps?.map((s) => s.run ?? "").join("\n") ?? "";
      expect(run).toContain(`--workflow ${file} --event workflow_dispatch`);
      expect(run).toContain('gh run cancel "$GITHUB_RUN_ID"');
    });
  }

  it("never exposes the dispatcher to site visitors", () => {
    expect(sql).toMatch(/revoke all on function public\.dispatch_github_workflow\(text\) from public, anon, authenticated/);
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
  });
});
