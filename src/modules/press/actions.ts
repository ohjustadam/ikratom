"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkRateLimit } from "@/lib/rate-limit";
import { pressLetter, type PressKind } from "./letter";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ADDRESSES_PER_DAY = 10;

export type PressContactResult =
  | { ok: true; name: string; email: string; subject: string; body: string }
  | { ok: false; reason: "signed_out" | "limit" | "missing" };

/**
 * One address, for one signed-in member. The cap keeps a person from being
 * flooded and keeps the list from being read out, so this is the only way in.
 */
export async function getPressContact(contactId: string): Promise<PressContactResult> {
  if (!UUID_RE.test(String(contactId))) return { ok: false, reason: "missing" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "signed_out" };

  const allowed = await checkRateLimit(`press-contact:user:${user.id}`, ADDRESSES_PER_DAY, 86_400);
  if (!allowed) return { ok: false, reason: "limit" };

  const sb = createServiceRoleClient();
  const { data: contact } = await sb
    .from("press_contacts")
    .select("kind, name, email, news_items(title), research_papers(title)")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { ok: false, reason: "missing" };

  const row = contact as unknown as {
    kind: PressKind;
    name: string | null;
    email: string;
    news_items: { title: string } | null;
    research_papers: { title: string } | null;
  };
  const title = row.news_items?.title ?? row.research_papers?.title ?? "";
  const letter = pressLetter({ kind: row.kind, name: row.name, title });
  return { ok: true, name: row.name ?? `The ${row.kind}`, email: row.email, ...letter };
}
