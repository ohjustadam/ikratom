"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Export everything we have about the signed-in user as JSON.
 * Returns a downloadable string the client can save as a file.
 */
export async function exportMyData(): Promise<{ json: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Pull every table that holds personal data. RLS scopes most of these to self
  // automatically; for cross-table queries we use the user_id filter.
  const [
    profile,
    notifPrefs,
    actions,
    threads,
    posts,
    reactions,
    blocks,
    blocked,
    convs,
    msgs,
    integrations,
    notifs,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("notification_preferences").select("*").eq("user_id", user.id).single(),
    supabase.from("campaign_actions").select("*").eq("user_id", user.id),
    supabase.from("forum_threads").select("*").eq("author_id", user.id),
    supabase.from("forum_posts").select("*").eq("author_id", user.id),
    supabase.from("forum_reactions").select("*").eq("user_id", user.id),
    supabase.from("user_blocks").select("*").eq("blocker_id", user.id),
    supabase.from("user_blocks").select("*").eq("blocked_id", user.id),
    supabase.from("dm_participants").select("*").eq("user_id", user.id),
    supabase.from("dm_messages").select("*").eq("sender_id", user.id),
    supabase.from("email_integrations").select("user_id, account_email, scopes, connected_at").eq("user_id", user.id),
    supabase.from("notifications").select("*").eq("user_id", user.id),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    profile: profile.data,
    notification_preferences: notifPrefs.data,
    campaign_actions: actions.data,
    forum_threads: threads.data,
    forum_posts: posts.data,
    forum_reactions: reactions.data,
    blocks_i_made: blocks.data,
    times_others_blocked_me: blocked.data?.length ?? 0,  // count only — never reveal who
    dm_conversations_im_in: convs.data?.length ?? 0,     // count only — message bodies are E2E encrypted
    dm_messages_i_sent: msgs.data?.map((m) => ({
      id: m.id,
      conversation_id: m.conversation_id,
      created_at: m.created_at,
      // Note: ciphertext + nonce are included for completeness, but you'd need
      // your private key (in IndexedDB on this device) to decrypt them
      ciphertext: m.ciphertext,
      nonce: m.nonce,
    })),
    email_integrations: integrations.data,
    notifications: notifs.data,
    note: "Direct messages are end-to-end encrypted with your device key. Decrypting requires the private key in your browser's IndexedDB. iKratom servers cannot read these.",
  };

  return { json: JSON.stringify(payload, null, 2) };
}

/**
 * Permanently delete the user's account + all associated data.
 * Uses service role since we need to delete from auth.users (RLS doesn't apply
 * to user-side; the cascade fires on profile deletion).
 */
export async function deleteMyAccount(input: { confirmation: string; password: string }) {
  if (input.confirmation !== "DELETE MY ACCOUNT") {
    return { error: "Confirmation phrase didn't match." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) return { error: "Not signed in." };

  // Rate-limit this irreversible, service-role action (pen-test critic): cap
  // attempts per IP so a hijacked/unattended session can't be hammered.
  const ip = await getClientIp();
  if (!(await checkRateLimit(`account:delete:ip:${ip}`, 5, 3600))) {
    return { error: "Too many attempts. Try again later." };
  }

  // RE-AUTHENTICATE before deleting (pen-test critic): the confirmation phrase is
  // a known constant, so a live session alone (XSS / stolen cookie / unattended
  // browser) could wipe the account. Verify the current password via a throwaway
  // client so the live session is untouched.
  if (!input.password) return { error: "Enter your password to confirm deletion." };
  const verifier = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: pwErr } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: input.password,
  });
  if (pwErr) return { error: "Password is incorrect." };

  // Use service role to delete the auth.users row — cascades to profile + all
  // user-owned rows via FK on delete cascade across our schema.
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Audit the self-deletion (actor_id FK is ON DELETE SET NULL, so the row
  // survives the cascade as an anonymized record).
  await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    actor_email: user.email,
    action: "account_self_deleted",
    target_type: "user",
    target_id: user.id,
  });

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };

  // Clear the session cookie locally
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
