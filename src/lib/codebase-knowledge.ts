/**
 * Codebase knowledge search — powers the AI Editor-in-Chief's `search_docs`
 * READ tool so it can answer "how does X work / where is Y" and point a
 * developer (or the owner) at the right file, WITHOUT any AI-provider or DB
 * dependency. Pure keyword scoring over the committed digest
 * (src/lib/codebase-digest.json, built by scripts/build-codebase-digest.mjs).
 *
 * Forever-free + offline: no network, no model call, no migration.
 */
import digest from "./codebase-digest.json";

export type DigestEntry = {
  kind: "doc" | "file";
  path: string;
  heading?: string;
  text?: string;
  purpose?: string;
  symbols?: string[];
  route?: string;
};

const ENTRIES = (digest as { entries: DigestEntry[] }).entries ?? [];

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "is", "it", "how", "does", "do", "where",
  "what", "why", "and", "or", "for", "on", "with", "this", "that", "work",
  "works", "site", "page", "code", "file", "ikratom",
]);

function tokenize(q: string): string[] {
  return Array.from(
    new Set(
      String(q ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9_\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOP.has(t)),
    ),
  ).slice(0, 12);
}

/** Score one entry against the query terms. Path/heading/symbols/route weigh
 *  more than body text so "where is X" and "route for Y" rank precisely. */
function scoreEntry(e: DigestEntry, terms: string[]): number {
  const path = e.path.toLowerCase();
  const strong = `${e.heading ?? ""} ${(e.symbols ?? []).join(" ")} ${e.route ?? ""}`.toLowerCase();
  const body = `${e.text ?? ""} ${e.purpose ?? ""}`.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (path.includes(t)) score += path.split("/").pop()?.includes(t) ? 6 : 4;
    if (strong.includes(t)) score += 3;
    if (body.includes(t)) score += 1;
  }
  return score;
}

export type CodebaseHit = { path: string; kind: DigestEntry["kind"]; label: string; detail: string };

/** Ranked matches for a natural-language question about the codebase. */
export function searchCodebase(query: string, limit = 6): CodebaseHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  return ENTRIES
    .map((e) => ({ e, s: scoreEntry(e, terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ e }) => {
      if (e.kind === "doc") {
        return {
          path: e.path,
          kind: e.kind,
          label: `${e.path} › ${e.heading ?? ""}`.trim(),
          detail: (e.text ?? "").slice(0, 320),
        };
      }
      const bits = [
        e.route ? `route ${e.route}` : null,
        e.symbols?.length ? `exports ${e.symbols.join(", ")}` : null,
        e.purpose || null,
      ].filter(Boolean);
      return { path: e.path, kind: e.kind, label: e.path, detail: bits.join(" — ").slice(0, 320) };
    });
}

/** Digest size, for a health/coverage note. */
export function codebaseDigestStats(): { total: number; docs: number; files: number } {
  return {
    total: ENTRIES.length,
    docs: ENTRIES.filter((e) => e.kind === "doc").length,
    files: ENTRIES.filter((e) => e.kind === "file").length,
  };
}
