<#
.SYNOPSIS
  Spin up an ISOLATED git worktree for a parallel Claude/dev session.

.DESCRIPTION
  Parallel sessions must never share one checkout — they'd share a single
  .git/index + HEAD, and one session's commit can sweep in another's staged
  files (this is how PR #608 absorbed PR #607). This script gives a session its
  own working tree (own index/HEAD/files, shared object store) off the latest
  origin/main, and wires up the gitignored bits a fresh worktree lacks:
  node_modules (directory junction — instant, no reinstall) and .env.local.

  Note: private/ is gitignored too, so it is NOT copied — always read/write the
  brief (private/V2_KICKOFF.md) in the MAIN checkout, not the worktree.

.PARAMETER Task
  Short task slug, used for the worktree folder name (..\ikratom-<Task>).

.PARAMETER Branch
  New branch name to create off origin/main.

.EXAMPLE
  pwsh scripts/new-session-worktree.ps1 -Task 19b -Branch feat/19b-notif-broadcast
#>
param(
  [Parameter(Mandatory = $true)][string]$Task,
  [Parameter(Mandatory = $true)][string]$Branch
)

$ErrorActionPreference = "Stop"
$Main = (git rev-parse --show-toplevel)
if (-not $Main) { Write-Error "Run inside the iKratom git repo."; exit 1 }
$WorktreePath = Join-Path (Split-Path $Main -Parent) "ikratom-$Task"

if (Test-Path $WorktreePath) { Write-Error "$WorktreePath already exists."; exit 1 }

git -C $Main fetch origin main
git -C $Main worktree add $WorktreePath -b $Branch origin/main

# node_modules: directory junction to the main checkout (shared, instant)
$nm = Join-Path $WorktreePath "node_modules"
if (Test-Path (Join-Path $Main "node_modules")) {
  New-Item -ItemType Junction -Path $nm -Target (Join-Path $Main "node_modules") | Out-Null
  Write-Host "  node_modules junction -> main checkout"
}

# .env.local: copy (gitignored; safe — not committable from the worktree either)
$env = Join-Path $Main ".env.local"
if (Test-Path $env) { Copy-Item $env (Join-Path $WorktreePath ".env.local"); Write-Host "  .env.local copied" }

# Shared long-term memory (2026-10-17): Claude Code keys auto-memory by folder,
# so a session started in this worktree would get an EMPTY memory and none of
# the project's lessons. Point it at the main checkout's memory instead.
# settings.local.json is gitignored and machine-local; written without a BOM.
$key = ($Main -replace '[:\\/]', '-')
$mem = (Join-Path $env:USERPROFILE ".claude\projects\$key\memory") -replace '\\', '/'
$claudeDir = Join-Path $WorktreePath ".claude"
New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
[System.IO.File]::WriteAllText((Join-Path $claudeDir "settings.local.json"), (@{ autoMemoryDirectory = $mem } | ConvertTo-Json))
Write-Host "  auto-memory -> $mem (shared with the main checkout)"

Write-Host ""
Write-Host "Isolated worktree ready: $WorktreePath  (branch $Branch off origin/main)"
Write-Host "Work there. Commit with an explicit pathspec: git commit -m '...' -- <paths>"
Write-Host "Before merging: gh pr view <n> --json files  (confirm only your files)."
Write-Host "Session mesh: the hooks in .claude/settings.json are active here; run 'node scripts/session-mesh.mjs status' to see the other sessions."
Write-Host "When done: git -C `"$Main`" worktree remove `"$WorktreePath`""
