import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_AUDIENCES, SECTION_AUDIENCES, isAudience, type SectionAudienceKey } from "@/modules/profile/audience";
import { profileHref } from "@/modules/profile/view";
import { listBlockedUsers } from "@/modules/dm/block-actions";
import { BlockedUsersList } from "@/modules/auth/components/BlockedUsersList";
import { PrivacySettings } from "@/modules/profile/components/PrivacySettings";

export const metadata = { title: "Privacy" };
export const dynamic = "force-dynamic";

/**
 * /account/privacy — every privacy choice in one place: who sees each profile
 * section (Only me / Friends / Members / Public), whether your @handle can be
 * found, a live preview, and your blocked members. Defaults come from
 * get_my_profile_social (0285): Members-only unless the member opted in to
 * Public, and never wider than their old profile_visibility.
 */
export default async function PrivacyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/privacy");

  const [{ data: rows }, { data: me }, blocked] = await Promise.all([
    supabase.rpc("get_my_profile_social"),
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
    listBlockedUsers(),
  ]);
  const s = ((rows ?? []) as Record<string, unknown>[])[0] ?? {};
  const audiences = { ...DEFAULT_AUDIENCES };
  for (const { key } of SECTION_AUDIENCES) {
    const v = s[key];
    if (isAudience(v)) audiences[key as SectionAudienceKey] = v;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">← Account</a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Privacy</p>
        <h1 className="mt-2 text-3xl font-bold">You decide who sees what</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Other members only ever see you as <strong className="text-zinc-200">@{me?.username ?? "your handle"}</strong>. Your real name,
          email, address and phone are never shown to anyone, at any setting. Photos get their own audience on{" "}
          <a href="/account/photos" className="text-emerald-400 hover:underline">Your photos</a>; location data is stripped from every photo.
        </p>
        <a href={profileHref({ id: user.id, username: me?.username ?? null })} className="mt-3 inline-block text-sm text-emerald-400 hover:underline">View my profile →</a>
      </header>

      <PrivacySettings
        initial={audiences}
        discoverability={typeof s.profile_visibility === "string" ? s.profile_visibility : "public"}
        wallPosting={s.wall_posting === "only_me" ? "only_me" : "friends"}
      />

      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold">Blocked members</h2>
        <p className="mb-3 text-xs text-zinc-500">A block hides everything both ways: profiles, photos, activity, messages and connections.</p>
        <BlockedUsersList blocked={blocked} />
      </section>
    </div>
  );
}
