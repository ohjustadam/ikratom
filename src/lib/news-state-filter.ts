/**
 * "News about this state" for PostgREST: stories filed under it, plus stories
 * filed elsewhere that are about it too (news_items.mentioned_states, migration
 * 0301; filled by scripts/lib/news-state.mjs). Every per-state news list uses
 * this, so a Mississippi story that discusses Louisiana's ban shows on both.
 */

/** A 2-letter code with anything that could break a filter string removed. */
export function cleanStateCode(state: string): string {
  return state.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
}

/** Filter for `.or(...)`: filed under `state` or naming it. */
export function newsAboutState(state: string): string {
  const st = cleanStateCode(state);
  return `state.eq.${st},mentioned_states.cs.{${st}}`;
}

/** Whether a loaded row is about `state` (client-side twin of newsAboutState). */
export function isNewsAbout(item: { state: string | null; mentioned_states?: string[] | null }, state: string | null): boolean {
  if (!state) return false;
  return item.state === state || (item.mentioned_states ?? []).includes(state);
}
