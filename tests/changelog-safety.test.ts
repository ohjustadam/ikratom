import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyCommit,
  isSensitiveSubject,
  isSecurityCommit,
  publishBlocklistHits,
} from "../scripts/lib/changelog-safety.mjs";

describe("changelog-safety: holds sensitive commits out of auto-drafts", () => {
  // Real commit subjects that LEAKED onto the public changelog (PR #691). Each
  // must be classified non-public (held or security-collapsed), never itemized.
  const MUST_HOLD = [
    "fix(security): block profiles privilege self-escalation (CRITICAL)",
    "fix(security): hardening pass (badges, search injection, SSRF, CSP, briefing XSS)",
    "fix(security): lock is_owner against cross-user promotion (#4)",
    "fix(security): reset-password recovery gate (#8) + sign-in enumeration (#11)",
    "fix(security): close open-redirect in /auth/callback next= validation",
    "fix(security): resolve + reject private IPs in safeFetch (DNS-rebinding, ssrf-02)",
    "fix(security): encrypt Gmail/Outlook refresh tokens at rest (oauth-02)",
    "fix(security): DB-layer insert rate caps on campaign_actions + call_sessions (ABUSE-02/03)",
    "feat(intel): cluster-janitor for the pending intel queue",
    "feat(campaigns): veto per-state fan-out of syndicated national headlines",
    "feat(admin): rank campaigns by priority score (relevance + importance)",
    "feat(campaigns): standing vs rotating + timeout/expiry system",
    "chore(infra): wire extra free-tier AI providers + self-evolution standing rule",
    "chore(env): document TAVILY_API_KEY in template",
    "feat(bills): collapsible Opposition/Repeal/Journey playbook + Kokoro Listen",
    "fix(ai-router): accept GH_MODELS_TOKEN (GitHub reserves GITHUB_ secret prefix)",
  ];
  for (const subj of MUST_HOLD) {
    it(`holds: ${subj.slice(0, 64)}`, () => {
      expect(classifyCommit(subj)).not.toBe("public");
    });
  }

  // Genuine user-facing features that MUST stay public.
  const MUST_PUBLISH = [
    "feat(brief): state + date selectors on /brief",
    "feat(state-hq): PR1 — local-reps-at-top + fold briefing+Listen into the state hub",
    "feat(campaigns): every campaign actionable by everyone + connect-email/act nudge",
    "feat(banned): 'Communities that beat a ban' section",
    "feat(calendar): elections + primaries + .ics subscribe",
    "fix(brief): correct the day selector default",
  ];
  for (const subj of MUST_PUBLISH) {
    it(`publishes: ${subj.slice(0, 64)}`, () => {
      expect(classifyCommit(subj)).toBe("public");
    });
  }

  it("treats any security-scoped commit as security (collapsed, never itemized)", () => {
    expect(isSecurityCommit("fix(security): x")).toBe(true);
    expect(isSecurityCommit("chore(auth): rotate keys")).toBe(true);
    expect(isSecurityCommit("security: patch thing")).toBe(true);
    expect(isSecurityCommit("feat(brief): selectors")).toBe(false);
  });

  it("flags vuln + intel + infra vocabulary as sensitive", () => {
    expect(isSensitiveSubject("add an XSS sanitizer")).toBe(true);
    expect(isSensitiveSubject("opposition donor money-trail surface")).toBe(true);
    expect(isSensitiveSubject("switch inference to groq fallback")).toBe(true);
    expect(isSensitiveSubject("ship a community calendar widget")).toBe(false);
  });
});

describe("changelog-safety: no published patch-note leaks (CI guard)", () => {
  // Scans EVERY published patch-note so a sensitive line can't merge even if a
  // post was hand-written (not just auto-generated).
  const dir = join(process.cwd(), "src", "content", "patch-notes");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  it("finds patch-note files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // Legacy posts exempted from the blocklist scan. Currently EMPTY — every
  // published post must pass. (The only former entry, 2026-05-17-update, was an
  // intel-feature post advertising the threat-matrix + donor surfacing that the
  // intel-lockdown pulled off public surfaces; it was deleted, not exempted.)
  // Do NOT add entries — fix or remove the offending post instead.
  const GRANDFATHERED = new Set<string>([]);

  for (const f of files) {
    const t = GRANDFATHERED.has(f) ? it.skip : it;
    t(`clean: ${f}`, () => {
      const content = readFileSync(join(dir, f), "utf8");
      const hits = publishBlocklistHits(content);
      expect(hits, `${f} contains blocked term(s): ${hits.join(", ")}`).toEqual([]);
    });
  }
});
