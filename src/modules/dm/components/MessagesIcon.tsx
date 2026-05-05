import { getUnreadDmCount } from "../actions";

export async function MessagesIcon() {
  const count = await getUnreadDmCount();
  return (
    <a
      href="/messages"
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-zinc-900"
      aria-label={count > 0 ? `${count} unread messages` : "Messages"}
    >
      <ChatIcon />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-zinc-950">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </a>
  );
}

function ChatIcon() {
  return (
    <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-3.5-7.1L21 3v6h-6" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </svg>
  );
}
