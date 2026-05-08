/**
 * Pure helpers for forum engagement keys. Lives in its own file (not
 * engagement-actions.ts) because Next requires "use server" modules to
 * export only async functions — sync helpers like these have to sit
 * alongside, not inside.
 *
 * Key encoding (matches the SQL CHECK constraint in 0060):
 *   "state:OK"           — Oklahoma state forum
 *   "state:FED"          — National (federal) forum
 *   "community:<uuid>"   — topical community
 */

export type SubMode = "alerts" | "digest" | "mute";

export const FORUM_KEY_RX = /^(state:[A-Z]{2,4}|community:[0-9a-f-]{36})$/;

export function stateKey(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  const a = abbr.trim().toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(a)) return null;
  return `state:${a}`;
}

export function communityKey(id: string | null | undefined): string | null {
  if (!id) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return `community:${id.toLowerCase()}`;
}
