"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { disconnectGmail, getGmailIntegration } from "@/lib/email/gmail";

export async function getGmailStatus() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const integration = await getGmailIntegration(user.id);
  if (!integration) return null;
  return { account_email: integration.account_email };
}

export async function disconnectGmailAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  await disconnectGmail(user.id);
  revalidatePath("/account");
  return { ok: true };
}
