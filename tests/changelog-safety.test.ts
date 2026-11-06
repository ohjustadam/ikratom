import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyCommit,
  isSensitiveSubject,
  isSecurityCommit,
  publishBlocklistHits,
  publishBlocklistMatches,
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

describe("What's New carries only changes members can see (owner, 2026-11-06)", () => {
  // Lines of the kinds that were on the public page before this rule.
  const MUST_BLOCK = [
    "Reliability and security improvements plus behind-the-scenes maintenance landed this period.",
    "## 🛠 Under the hood",
    "A large reliability and security hardening pass landed this week",
    "migrate hosting to Netlify + 3-layer deploy gate",
    "split hourly pipeline so it stops timing out",
    "unblock the hourly fan-out from our own Cloudflare bot protection",
    "egress watchdog: never get restricted blind again",
    "admin review surface at /admin/intel-health",
    "live /pitch/efficiency",
    "We closed several ways your identity could have leaked",
    "Shipped 32 commits",
    "Everything above shipped in (#874)",
    "see [abc1234](https://github.com/ohjustadam/ikratom/commit/abc1234)",
  ];
  for (const line of MUST_BLOCK) {
    it(`blocks: ${line.slice(0, 60)}`, () => {
      expect(publishBlocklistHits(line)).not.toEqual([]);
    });
  }

  // Copy of the kind members should keep getting. Everyday words that sit next
  // to the blocked ones must pass, or the gate gets switched off.
  const MUST_PASS = [
    "**One-click sending does what it says.** It sends the letter you wrote.",
    "Organizers can review join requests, and group admins can pin resources.",
    "Committee chairs now show on every bill.",
    "**Fewer interruptions.** By default, push alerts now arrive together.",
    "Moderators work from @usernames, so your real name stays out of their view.",
    "Report buttons now work the same way across the community.",
    "Your choice stays private. Other members only ever see your @username.",
  ];
  for (const line of MUST_PASS) {
    it(`passes: ${line.slice(0, 60)}`, () => {
      expect(publishBlocklistHits(line)).toEqual([]);
    });
  }

  it("names the words, so the person publishing knows what to change", () => {
    expect(publishBlocklistMatches("Our Security work and a cron fix")).toEqual(["security", "cron"]);
    expect(publishBlocklistMatches("A new calendar view")).toEqual([]);
  });

  it("holds internal commits out of drafts", () => {
    expect(classifyCommit("fix(news): split hourly pipeline so it stops timing out")).toBe("held");
    expect(classifyCommit("feat(ops): migrate hosting to Netlify")).toBe("held");
    expect(classifyCommit("fix(ops): stop a build timeout, netlify side [skip netlify] (#900)")).toBe("held");
  });

  // Almost every real title ends this way. Reading the tag as the word
  // "netlify" held every commit out and left drafts empty.
  it("does not read the build tag on a title as internal work", () => {
    expect(classifyCommit("feat(media): members can reply to reporters [skip netlify] (#1134)")).toBe("public");
    expect(classifyCommit("fix(bills): a bill that became law stops reading Dead [skip netlify] (#1129)")).toBe("public");
  });

  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

  it("checks a note before it goes public and before live copy changes", () => {
    const actions = read("src", "modules", "admin", "patch-note-actions.ts");
    const publish = actions.slice(actions.indexOf("export async function setPatchNoteStatus"));
    const save = actions.slice(
      actions.indexOf("export async function savePatchNote"),
      actions.indexOf("export async function setPatchNoteStatus"),
    );
    expect(publish).toMatch(/publishBlockReason\(note\)/);
    expect(save).toMatch(/publishBlockReason\(\{ title, summary, body_md: body \}\)/);
  });

  it("drafts carry no commit links and no catch-all line", () => {
    const gen = read("scripts", "generate-patch-note.mjs");
    expect(gen).not.toMatch(/ikratom\/commit\//);
    expect(gen).not.toMatch(/Under the hood/);
    expect(gen).not.toMatch(/## 📚 Docs/);
    // Left behind by the old sections, these crash the run after the draft is written.
    expect(gen).not.toMatch(/\b(?:behindCount|securityCount|featureCount|fixCount|docs\.length)\b/);
  });

  it("the public pages make no promise of commit links or counts", () => {
    for (const page of [read("src", "app", "whats-new", "page.tsx"), read("src", "app", "whats-new", "[slug]", "page.tsx")]) {
      expect(page).not.toMatch(/totalCommits/);
      expect(page).not.toMatch(/underlying commits|specific commits/);
    }
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
