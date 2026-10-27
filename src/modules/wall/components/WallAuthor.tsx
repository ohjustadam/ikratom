import { publicHandle, handleInitials } from "@/lib/public-handle";
import { profileHref } from "@/modules/profile/href";

/** Avatar + @handle (or "Member" when the author hides it) + time. */
export function WallAuthor({ id, username, avatarUrl, at, small = false }: {
  id: string;
  username: string | null;
  avatarUrl: string | null;
  at: string;
  small?: boolean;
}) {
  const handle = publicHandle({ username });
  const size = small ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  const face = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- privacy route 302s to a signed URL
    <img src={avatarUrl} alt="" className={`${size} shrink-0 rounded-full bg-zinc-800 object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-zinc-800 font-bold text-zinc-300`}>{handleInitials(handle)}</span>
  );
  const when = new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex min-w-0 items-center gap-2">
      {face}
      <div className="min-w-0 leading-tight">
        {username ? (
          <a href={profileHref({ id, username })} className="block truncate text-sm font-semibold hover:text-emerald-400">{handle}</a>
        ) : (
          <span className="block truncate text-sm font-semibold text-zinc-400">{handle}</span>
        )}
        <time dateTime={at} className="text-[11px] text-zinc-500">{when}</time>
      </div>
    </div>
  );
}
