import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isMediaStoreConfigured } from "@/lib/media-store";
import { AUDIENCE_LABEL, isAudience } from "@/modules/profile/audience";
import { MAX_ALBUM_PHOTOS } from "@/modules/profile/photo-upload";
import { AlbumManager, type OwnPhoto } from "@/modules/profile/components/AlbumManager";
import { PhotoUploadButton } from "@/modules/profile/components/PhotoUploadButton";

export const metadata = { title: "Your photos" };
export const dynamic = "force-dynamic";

/**
 * /account/photos — profile photo, cover and album, each photo with its own
 * audience. Location and camera data are stripped twice (in the browser, then
 * on the server) before a photo is stored.
 */
export default async function PhotosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/photos");

  const [{ data: photos }, { data: rows }] = await Promise.all([
    supabase.rpc("get_profile_photos", { p_owner: user.id, p_limit: 120 }),
    supabase.rpc("get_my_profile_social"),
  ]);
  const own = (photos ?? []) as OwnPhoto[];
  const albumCount = own.filter((p) => p.kind === "album").length;
  const def = ((rows ?? []) as { photos_default_audience?: string }[])[0]?.photos_default_audience;
  const enabled = isMediaStoreConfigured();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a href="/account/profile" className="text-xs text-zinc-500 hover:text-emerald-400">← Your profile</a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Your photos</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Every photo has its own audience. Location, camera and time data are removed before anything is stored, so a photo never reveals where you took it.
        </p>
      </header>

      {!enabled ? (
        <p className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-4 text-sm text-amber-200">Photo uploads are not enabled on this server yet.</p>
      ) : (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <PhotoUploadButton kind="avatar" label="Change profile photo" />
          <PhotoUploadButton kind="cover" label="Change cover photo" />
          {albumCount < MAX_ALBUM_PHOTOS && (
            <PhotoUploadButton kind="album" label="+ Add to album" className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50" />
          )}
          <span className="text-xs text-zinc-500">
            New album photos start as <strong className="text-zinc-300">{isAudience(def) ? AUDIENCE_LABEL[def] : "Friends"}</strong>. {albumCount}/{MAX_ALBUM_PHOTOS} used.
          </span>
        </div>
      )}

      <AlbumManager photos={own} />
    </div>
  );
}
