import { describe, expect, it } from "vitest";
import { analyseSource, scanAdminActions } from "../scripts/lib/admin-mfa-scan.mjs";

// Since #1159 an admin or owner with no verified 2FA factor is refused by
// requireMfaForMutation, but only in the actions that call it. This test scans
// every "use server" file and fails when an exported action reaches an admin
// guard (getAdminContext / getCreatorContext) without reaching the gate.
//
// A new admin action therefore needs one of two things:
//   - the gate:  const mfaErr = requireMfaForMutation(ctx); if (mfaErr) return ...
//   - an entry below, if it only READS (lists, counts, previews, diagnostics).
// Read-only entries are checked too: one that writes to the database fails.

const READ_ONLY: Record<string, string[]> = {
  "src/modules/admin/ai-actions.ts": ["suggestOfficialsAction"],
  "src/modules/admin/ai-control-actions.ts": [
    "listRecentAiJobs",
    "getAiStats24h",
    "getProviderAvailability",
    "getEmailQuotaStatus",
    "getGroundingQuotaStatus",
    "getEnvPresence",
  ],
  // Runs read tools only; proposals execute through executeEditorTool (gated).
  "src/modules/admin/ai-editor-actions.ts": ["askAdminEditor"],
  "src/modules/admin/ai-test-actions.ts": ["runTestPrompt"],
  "src/modules/admin/call-moderation-actions.ts": ["listPendingCalls", "pendingCallCount"],
  "src/modules/admin/campaign-autoapprove-actions.ts": ["listRecentAutoDecisions"],
  "src/modules/admin/chatbot-actions.ts": ["askAdminChatbot"],
  "src/modules/admin/content-actions.ts": ["getContentHistory"],
  // Self-tests: they read config or ping a provider; the push goes to the
  // caller's own devices only. They write an audit row, nothing else.
  "src/modules/admin/diagnostics-actions.ts": [
    "testSupabaseHealth",
    "listOauthCallbacks",
    "checkEnvVars",
    "testAiProvider",
    "testPushToSelf",
  ],
  "src/modules/admin/local-rep-inline-actions.ts": ["previewSuggestions"],
  "src/modules/admin/lounge-actions.ts": [
    "listRecentChatMessages",
    "listMutedChatUsers",
    "listBanReviewQueue",
    "listHeldChatMessages",
  ],
  "src/modules/admin/master-edit-actions.ts": ["searchEntitiesForEdit"],
  "src/modules/admin/meetings-actions.ts": ["listMeetingsForReview"],
  "src/modules/admin/patch-note-actions.ts": ["listPatchNotesForAdmin"],
  "src/modules/admin/patch-note-ledger-actions.ts": ["getPatchNoteLedger"],
  "src/modules/admin/permissions-actions.ts": ["getUserEffectivePermissions"],
  "src/modules/admin/queue-resolve-actions.ts": ["analyzeCampaignQueue", "analyzeIntelQueue", "queueCounts"],
  "src/modules/alerts/actions.ts": ["listPendingIntelTips"],
  "src/modules/announcements/actions.ts": ["listAllAnnouncements"],
  "src/modules/auth/actions-vendor.ts": ["listPendingVendorApplications"],
  "src/modules/discord/actions.ts": ["listDiscordIntegrations", "getDiscordIntegration"],
  "src/modules/external-communities/actions.ts": ["listAllExternalCommunities"],
  "src/modules/feedback/actions.ts": ["listFeedback"],
  "src/modules/forum/actions.ts": ["moderationQueueCount"],
  "src/modules/forum/community-actions.ts": ["listAllCommunities", "countCommunityThreads"],
  "src/modules/library/enrich-url-action.ts": ["enrichLibraryUrl"],
  "src/modules/local-reps/actions.ts": ["listPendingCoverageRequests"],
  "src/modules/partners/actions.ts": ["listPartners", "getPartnerBySlug"],
  "src/modules/state-status/actions.ts": ["listStateStatus"],
  "src/modules/stories/actions.ts": ["listPendingStoriesForAdmin"],
};

// A member's own write that reaches a guard only to learn whether the caller
// moderates. No admin power is used, so no admin gate: a member deleting their
// own post must never be told to enroll in 2FA.
const OWN_WRITES: Record<string, string[]> = {
  "src/modules/forum/edit-actions.ts": ["deleteForumPost", "deleteForumThread"],
};

const key = (file: string, name: string) => `${file}#${name}`;
const flat = (m: Record<string, string[]>) =>
  new Set(Object.entries(m).flatMap(([file, names]) => names.map((n) => key(file, n))));
const readOnly = flat(READ_ONLY);
const ownWrites = flat(OWN_WRITES);

describe("admin actions reach the 2FA gate", () => {
  const rows = scanAdminActions(process.cwd());
  const byKey = new Map(rows.map((r) => [key(r.file, r.name), r]));

  it("finds the admin surface (a scan that sees nothing proves nothing)", () => {
    expect(rows.length).toBeGreaterThan(150);
    expect(new Set(rows.map((r) => r.file)).size).toBeGreaterThan(40);
    expect(rows.filter((r) => r.gated).length).toBeGreaterThan(100);
  });

  it("gates every admin action that is not declared read-only", () => {
    const missing = rows
      .filter((r) => !r.gated && !readOnly.has(key(r.file, r.name)) && !ownWrites.has(key(r.file, r.name)))
      .map((r) => `${key(r.file, r.name)}${r.writes.length ? ` (writes: ${r.writes.join(", ")})` : ""}`);
    expect(missing, "add requireMfaForMutation(ctx), or list it in READ_ONLY if it only reads").toEqual([]);
  });

  it("keeps the read-only list honest: every entry exists, is ungated, and writes nothing", () => {
    const problems: string[] = [];
    for (const k of readOnly) {
      const r = byKey.get(k);
      if (!r) problems.push(`${k}: no such admin action (renamed or removed?)`);
      else if (r.gated) problems.push(`${k}: is gated now, drop it from READ_ONLY`);
      else {
        const dbWrites = r.writes.filter((w) => w !== "recordAdminAction()");
        if (dbWrites.length) problems.push(`${k}: writes (${dbWrites.join(", ")}), so it needs the gate`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the own-writes list honest: every entry exists and is ungated", () => {
    const problems = [...ownWrites].filter((k) => !byKey.get(k) || byKey.get(k)!.gated);
    expect(problems).toEqual([]);
  });
});

describe("analyseSource", () => {
  const head = `"use server";\nimport { getAdminContext } from "./actions";\nimport { requireMfaForMutation } from "./mfa";\n`;

  it("flags an admin write with no gate", () => {
    const src = `${head}
export async function wipe(id: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  await sb.from("t").delete().eq("id", id);
}`;
    expect(analyseSource(src)).toEqual([{ name: "wipe", guarded: true, gated: false, writes: [".delete()"] }]);
  });

  it("follows same-file helpers for both the guard and the gate", () => {
    const src = `${head}
async function guard() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return "no";
  return requireMfaForMutation(ctx);
}
export const save = async () => {
  const err = await guard();
  if (err) return { error: err };
  await sb.from("t").update({ a: 1 });
};`;
    expect(analyseSource(src)).toEqual([{ name: "save", guarded: true, gated: true, writes: [".update()"] }]);
  });

  it("ignores files that are not server actions", () => {
    expect(analyseSource(head.replace('"use server";', "") + "export async function f() { await getAdminContext(); }")).toEqual([]);
  });
});
