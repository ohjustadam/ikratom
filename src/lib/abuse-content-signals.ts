/**
 * What /admin/abuse-signals shows beyond sign-ins: the moves an organized group
 * makes once it is inside. Blocked letters, reports filed by brand-new accounts,
 * posts hidden by reports, and groups started by brand-new accounts. A week of
 * rows, grouped here so the rules can be tested without a database.
 */
import { publicHandle } from "@/lib/public-handle";

/** Under this age an account counts as new: the same line reports use before they can hide a post (0307). */
const NEW_ACCOUNT_MS = 7 * 86_400_000;

export type SignalRows = {
  blocks: { user_id: string; category: string }[];
  reports: { reporter_id: string; created_at: string }[];
  groups: { name: string; slug: string; owner_id: string; created_at: string }[];
  profiles: { id: string; username: string | null; created_at: string }[];
  hidden: number;
};

export type Counted = { handle: string; count: number };

export type ContentSignals = {
  blocks: { total: number; threats: number; banAsks: number; accounts: number; repeat: Counted[] };
  newReporters: { reports: number; accounts: number; top: Counted[] };
  hidden: number;
  newGroups: { name: string; slug: string; handle: string }[];
};

function tally(ids: string[], handle: (id: string) => string, atLeast: number): Counted[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count >= atLeast)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ handle: handle(id), count }));
}

export function summarizeContentSignals({ blocks, reports, groups, profiles, hidden }: SignalRows): ContentSignals {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const handle = (id: string) => publicHandle(byId.get(id) ?? null);
  // An account we can't find is treated as established: this page flags, it doesn't guess.
  const wasNew = (id: string, at: string) => {
    const joined = byId.get(id)?.created_at;
    return !!joined && Date.parse(at) - Date.parse(joined) < NEW_ACCOUNT_MS;
  };

  const fromNew = reports.filter((r) => wasNew(r.reporter_id, r.created_at)).map((r) => r.reporter_id);
  return {
    blocks: {
      total: blocks.length,
      threats: blocks.filter((b) => b.category === "threat").length,
      banAsks: blocks.filter((b) => b.category === "bans_natural_kratom").length,
      accounts: new Set(blocks.map((b) => b.user_id)).size,
      repeat: tally(blocks.map((b) => b.user_id), handle, 2),
    },
    newReporters: { reports: fromNew.length, accounts: new Set(fromNew).size, top: tally(fromNew, handle, 2) },
    hidden,
    newGroups: groups
      .filter((g) => wasNew(g.owner_id, g.created_at))
      .map((g) => ({ name: g.name, slug: g.slug, handle: handle(g.owner_id) })),
  };
}
