"use client";

import { useChromeMe } from "@/components/chrome/ChromeProvider";
import { DraftResponsePanel } from "./DraftResponsePanel";

/**
 * Gates the AI rebuttal generator to signed-in viewers.
 *
 * WHY THIS EXISTS (2026-09-08). The alert page used to call auth.getUser() on
 * the SERVER purely to decide whether to render this panel. That one read made
 * all ~5,000 alert pages dynamic — every crawler hit re-rendering the whole
 * page against Supabase to answer a question about a visitor who, being a bot,
 * was never signed in.
 *
 * The answer now comes from the single /api/me chrome read that real browsers
 * already make. The panel is a client component either way, so nothing about
 * the feature changes; it simply stops being a reason to abandon caching.
 *
 * Note this is a UI gate, not a security boundary — DraftResponsePanel's own
 * server actions do their own auth checks, as they must.
 */
export function SignedInDraftPanel(props: Parameters<typeof DraftResponsePanel>[0]) {
  const { userId } = useChromeMe();
  if (!userId) return null;
  return (
    <div className="mt-6">
      <DraftResponsePanel {...props} />
    </div>
  );
}
