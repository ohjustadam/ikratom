/**
 * HeaderAvatar — user's pic + username, surfaced in the top action
 * bar. On desktop shows avatar circle + @username + dropdown caret.
 * On mobile shows just the avatar (clicks open the menu drawer).
 *
 * Server component — pre-rendered from the user's profile row.
 */
import Link from "next/link";

export function HeaderAvatar({
  username,
  avatarUrl,
  fullName,
}: {
  username: string | null;
  avatarUrl: string | null;
  fullName: string | null;
}) {
  // Letter for placeholder when no avatar uploaded
  const initial = (username || fullName || "?").trim().slice(0, 1).toUpperCase();

  return (
    <Link
      href="/account"
      className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-zinc-900"
      title={username ? `@${username}` : (fullName ?? "Your account")}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-200">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          initial
        )}
      </span>
      {/* Username only on >sm screens to keep mobile lean */}
      {username && (
        <span className="hidden text-xs font-medium text-zinc-300 sm:inline">
          @{username}
        </span>
      )}
    </Link>
  );
}
