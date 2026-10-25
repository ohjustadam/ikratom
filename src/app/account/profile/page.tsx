import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_AUDIENCES, SECTION_AUDIENCES, isAudience, type Audience, type SectionAudienceKey } from "@/modules/profile/audience";
import { profileHref } from "@/modules/profile/view";
import { ProfileEditor } from "@/modules/profile/components/ProfileEditor";

export const metadata = { title: "Edit your profile" };
export const dynamic = "force-dynamic";

/**
 * /account/profile — the member's public-facing profile: bio, advocacy story,
 * interests, links, and who can see each one (Only me / Friends / Members /
 * Public). Settings come from get_my_profile_social (0285), which applies the
 * safe defaults when the member has never saved.
 */
export default async function EditProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/profile");

  const [{ data: rows }, { data: links }, { data: me }] = await Promise.all([
    supabase.rpc("get_my_profile_social"),
    supabase.from("profile_links").select("label, url, position").eq("user_id", user.id).order("position"),
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
  ]);
  const s = ((rows ?? []) as Record<string, unknown>[])[0] ?? {};

  const audiences = { ...DEFAULT_AUDIENCES };
  for (const { key } of SECTION_AUDIENCES) {
    const v = s[key];
    if (isAudience(v)) audiences[key as SectionAudienceKey] = v as Audience;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">← Account</a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Your profile</p>
        <h1 className="mt-2 text-3xl font-bold">How other members see you</h1>
        <p className="mt-3 text-sm text-zinc-400">
          You appear as <strong className="text-zinc-200">@{me?.username ?? "you"}</strong> everywhere on iKratom. Choose what to share and who sees it.
          Members in states where kratom is banned: start with <em>Friends</em> or <em>Only me</em>, and add more when you are comfortable.
        </p>
        <a href="/account/photos" className="mt-4 inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500">
          📷 Profile photo, cover and album →
        </a>
      </header>
      <ProfileEditor
        profileUrl={profileHref({ id: user.id, username: me?.username ?? null })}
        initial={{
          bio: (s.bio as string | null) ?? "",
          story: (s.story as string | null) ?? "",
          interests: (s.interests as string[] | null) ?? [],
          links: ((links ?? []) as { label: string; url: string }[]).map((l) => ({ label: l.label, url: l.url })),
          audiences,
        }}
      />
    </div>
  );
}
