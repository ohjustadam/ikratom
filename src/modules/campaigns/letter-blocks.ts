import "server-only";

import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { screenMemberLetter, type LetterScreen } from "./screen-content";

/**
 * The letter screen, plus a private record when it refuses someone, so a group
 * probing for a way to send a ban letter shows up on /admin/abuse-signals.
 * Who, why and when only, never the letter (migration 0314). Every member path
 * goes through this, including the composer: someone refused there never
 * reaches the queue.
 */
export async function screenLetterFrom(
  userId: string,
  letter: { subject: string; body: string },
): Promise<LetterScreen> {
  const screen = await screenMemberLetter(letter);
  if (screen.block) await recordBlock(userId, screen.category);
  return screen;
}

/** One row per member, reason and hour, because the composer re-checks as they type. */
async function recordBlock(userId: string, category: LetterScreen["category"]) {
  try {
    if (!(await checkRateLimit(`letter:block-log:${userId}:${category}`, 1, 3600))) return;
    const { error } = await createServiceRoleClient()
      .from("letter_screen_blocks")
      .insert({ user_id: userId, category });
    if (error) console.error("letter block not recorded:", error.message);
  } catch (e) {
    // The record must never change what the member sees.
    console.error("letter block not recorded:", e);
  }
}
