"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  EmailTokenRevokedError,
  getEmailIntegration,
  markEmailIntegrationRevoked,
  sendOnUserBehalf,
} from "@/lib/email/user-send";

/**
 * Send ONE test letter from the member's connected mailbox to that same
 * mailbox, so they see exactly what an official receives: their words, from
 * their own address, closing with the iKratom footer (logo + link in the HTML
 * part). Owner ask 2026-10-25: check the footer in a real inbox before the
 * build ships. Takes no arguments, so it can never mail anyone else.
 */
export async function sendTestLetterToMe(): Promise<{ ok: true; to: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  if (!(await checkRateLimit(`test-letter:user:${user.id}`, 3, 3600))) {
    return { error: "That's 3 test letters this hour. Try again later." };
  }
  const integration = await getEmailIntegration(user.id);
  if (!integration) return { error: "Connect your email first." };

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const name = profile?.full_name?.trim() || null;
  const body = [
    `Dear ${name ?? "advocate"},`,
    "",
    "This is a test letter from iKratom. It shows what an official receives when you send a letter with one click: your words, from your own address, with a small iKratom line at the end.",
    "",
    "If you can read this, one-click sending works.",
    "",
    "Sincerely,",
    name ?? "",
  ].join("\n");

  try {
    await sendOnUserBehalf({ integration, fromName: name, to: integration.account_email, subject: "Test letter from iKratom", body });
    return { ok: true, to: integration.account_email };
  } catch (e) {
    if (e instanceof EmailTokenRevokedError) {
      await markEmailIntegrationRevoked(user.id, e.provider);
      return { error: "Your email connection expired. Reconnect it above, then try again." };
    }
    return { error: `Couldn't send: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
}
