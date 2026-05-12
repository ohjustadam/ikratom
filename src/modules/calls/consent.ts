/**
 * Recording-consent state list — shared between server actions and the
 * client CallTracker UI.
 *
 * Lives in its own non-"use server" file because Next.js 16 requires
 * that "use server" files only export async functions. A `Set` is an
 * object, so exporting it from actions.ts would break the build.
 */

// States requiring TWO-PARTY consent to record a call (well-established
// list, updated 2026).
// Treat NY as 2-party defensively here even though NY Penal Law § 250.05
// is technically one-party — legislative recordings are sensitive and
// the UI errs on the safer side.
export const TWO_PARTY_CONSENT_STATES: ReadonlySet<string> = new Set([
  "CA", "CT", "DE", "FL", "IL", "MD", "MA", "MI", "MT", "NV",
  "NH", "PA", "WA", "NY",
]);
