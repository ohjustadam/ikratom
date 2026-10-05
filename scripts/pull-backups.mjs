#!/usr/bin/env node
/**
 * pull-backups.mjs — keep a copy of every encrypted database backup on THIS
 * machine's own disk, and prove the newest one opens.
 *
 * The cloud copy is the GitHub Actions artifact written by db-backup.yml.
 * Downloading it costs no Supabase egress (it comes from GitHub, not the
 * database), so a local mirror is free and survives losing GitHub, Supabase or
 * both. Run it daily from Task Scheduler, or by hand.
 *
 *   node scripts/pull-backups.mjs                       # sync to C:\claude\ikratom-backups
 *   node scripts/pull-backups.mjs --dir D:\backups --keep-days 60
 *   node scripts/pull-backups.mjs --verify-latest       # decrypt newest to prove the key works
 *
 * Needs the `gh` CLI signed in. --verify-latest needs private/backup-private-key.pem.
 * Backups are never written inside the repo.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect, decryptFile } from "./lib/backup-crypto.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg("dir", process.env.BACKUP_DIR || (process.platform === "win32" ? "C:\\claude\\ikratom-backups" : path.join(os.homedir(), "ikratom-backups")));
const KEEP_DAYS = Number(arg("keep-days", 45));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gh = (...a) => execFileSync("gh", a, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

fs.mkdirSync(DIR, { recursive: true });
const have = new Set(fs.readdirSync(DIR));
const runs = JSON.parse(gh("run", "list", "--workflow", "db-backup.yml", "--status", "success", "--limit", "40", "--json", "databaseId,createdAt"));
let fetched = 0;
for (const r of runs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ikbk-"));
  try {
    gh("run", "download", String(r.databaseId), "--dir", tmp);
  } catch { fs.rmSync(tmp, { recursive: true, force: true }); continue; } // artifact expired
  for (const f of walk(tmp)) {
    const name = path.basename(f);
    if (!name.endsWith(".enc") || have.has(name)) continue;
    const ok = inspect(f);
    if (!ok.ok) { console.log(`  ✗ ${name}: ${ok.reason}`); continue; }
    fs.copyFileSync(f, path.join(DIR, name)); have.add(name); fetched++;
    console.log(`  ✓ ${name} (${(ok.size / 1e6).toFixed(2)} MB)`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Prune by the date in the filename, never by mtime (a re-download resets mtime).
const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
let pruned = 0;
for (const name of fs.readdirSync(DIR)) {
  const d = name.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (d && d < cutoff && name.endsWith(".enc")) { fs.rmSync(path.join(DIR, name)); pruned++; }
}
console.log(`backups in ${DIR}: +${fetched} new, ${pruned} pruned (> ${KEEP_DAYS} days), ${fs.readdirSync(DIR).filter((n) => n.endsWith(".enc")).length} kept`);

if (argv.includes("--verify-latest")) {
  const keyPath = path.join(repoRoot, "private", "backup-private-key.pem");
  const latest = fs.readdirSync(DIR).filter((n) => n.endsWith("-public.sql.gz.enc")).sort().at(-1);
  if (!latest) { console.log("nothing to verify yet"); process.exit(0); }
  const out = path.join(os.tmpdir(), latest.replace(/\.gz\.enc$/, ""));
  const bytes = decryptFile(path.join(DIR, latest), out, fs.readFileSync(keyPath, "utf8"));
  console.log(`✓ ${latest} decrypts to ${(bytes / 1e6).toFixed(1)} MB of SQL (${out}) — delete it when done`);
}

function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }
