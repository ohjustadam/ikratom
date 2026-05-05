import { getUnreadNotificationCount } from "../actions";

/**
 * Server component — shows a bell with an unread badge in the header.
 * Renders nothing if user is not signed in (count = 0 also hides badge).
 */
export async function HeaderBell() {
  const count = await getUnreadNotificationCount();

  return (
    <a
      href="/notifications"
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-zinc-900"
      aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}
    >
      <BellIcon />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-zinc-950">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </a>
  );
}

function BellIcon() {
  return (
    <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M15 17h5l-1.4-1.4a2 2 0 01-.6-1.4V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
    </svg>
  );
}
