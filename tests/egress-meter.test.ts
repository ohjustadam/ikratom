/**
 * egress-meter.test.ts — every cron job reports what it cost in Supabase egress.
 *
 * Runs the meter exactly as the workflows do (node --import=...) against a
 * local server that gzips like Supabase, and scans the workflows so a job added
 * later cannot escape the meter.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";

const run = promisify(execFile);
const big = JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ id: i, title: `Kratom bill ${i}`, body: "x".repeat(40) })));
const writes: { url: string; method: string; body: string }[] = [];
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url!.startsWith("/rest/v1/scraper_runs")) {
        writes.push({ url: req.url!, method: req.method!, body });
        res.writeHead(201).end();
      } else {
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" }).end(zlib.gzipSync(big));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

async function job(code: string) {
  const { stdout } = await run(process.execPath, ["--import=./scripts/lib/egress-meter.mjs", "--input-type=module", "-e", code], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: base, SUPABASE_URL: "" },
  });
  return stdout;
}

describe("egress meter", () => {
  it("stamps a telemetry insert with the compressed bytes the job pulled", async () => {
    writes.length = 0;
    const out = await job(`
      const r = await fetch("${base}/rest/v1/bills?select=*"); const rows = await r.json();
      if (rows.length !== 3000) throw new Error("response altered");
      await fetch("${base}/rest/v1/scraper_runs", { method: "POST", body: JSON.stringify({ source: "t" }) });`);
    const row = JSON.parse(writes[0].body);
    const gz = zlib.gzipSync(big).length;
    expect(row.source).toBe("t");
    expect(row.egress_bytes).toBeGreaterThan(gz);          // body + headers
    expect(row.egress_bytes).toBeLessThan(gz + 2000);      // the wire size, not the unpacked size
    expect(big.length).toBeGreaterThan(gz * 5);            // (so counting unpacked bytes would be badly wrong)
    expect(out).toMatch(/\[egress-meter\] [\d.]+ MB from Supabase in 2 requests/);
  });

  it("keeps the start-row + update pattern on one row's total", async () => {
    writes.length = 0;
    await job(`
      await fetch("${base}/rest/v1/scraper_runs", { method: "POST", body: JSON.stringify({ source: "t", status: "running" }) });
      await (await fetch("${base}/rest/v1/x")).text();
      await fetch("${base}/rest/v1/scraper_runs?id=eq.1", { method: "PATCH", body: JSON.stringify({ status: "success" }) });`);
    expect(JSON.parse(writes[0].body).egress_bytes).toBeLessThan(500);
    expect(JSON.parse(writes[1].body).egress_bytes).toBeGreaterThan(zlib.gzipSync(big).length);
  });

  it("adds the column to an array insert's ?columns= list", async () => {
    writes.length = 0;
    await job(`await fetch("${base}/rest/v1/scraper_runs?columns=%22source%22", { method: "POST", body: JSON.stringify([{ source: "a" }, { source: "b" }]) });`);
    expect(decodeURIComponent(writes[0].url)).toContain('"source","egress_bytes"');
  });

  it("ignores other hosts and never alters an unparseable body", async () => {
    writes.length = 0;
    await job(`await fetch("${base}/rest/v1/scraper_runs", { method: "POST", body: "not json" });`);
    expect(writes[0].body).toBe("not json");
  });
});

describe("every cron script runs under the meter", () => {
  const dir = ".github/workflows";
  const calls = fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").map((line, i) => ({ where: `${f}:${i + 1}`, line })))
    .filter(({ line }) => /\bnode (--[\w=./-]+ )*scripts\/[\w-]+\.mjs/.test(line) && !/^\s*#/.test(line));

  it("finds the cron script calls (guards against a scan that matches nothing)", () => {
    expect(calls.length).toBeGreaterThan(100);
  });

  it("preloads the meter on every one", () => {
    const bare = calls.filter(({ line }) => !line.includes("--import=./scripts/lib/egress-meter.mjs")).map((c) => c.where);
    expect(bare).toEqual([]);
  });
});

describe("egress ranking", () => {
  it("ranks jobs by total bytes and scales to a month", async () => {
    const { summarize, topLine } = await import("../scripts/lib/egress-by-job.mjs");
    const jobs = summarize([
      { source: "small", egress_bytes: 1048576 },
      { source: "big", egress_bytes: 5 * 1048576 },
      { source: "big", egress_bytes: 5 * 1048576 },
    ], 24);
    expect(jobs.map((j: { source: string }) => j.source)).toEqual(["big", "small"]);
    expect(jobs[0].runs).toBe(2);
    expect(jobs[0].perMonth).toBe(10 * 1048576 * 30);
    expect(topLine(jobs, 1)).toBe("big 10MB");
  });
});
