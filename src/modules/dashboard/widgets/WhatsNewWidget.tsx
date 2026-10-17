import { listVisibleAnnouncements } from "@/modules/announcements/actions";
import { DismissAnnouncementButton } from "./DismissAnnouncementButton";

/**
 * Admin-curated "what's new" feed. Shows up to 5 visible-and-not-
 * dismissed announcements, pinned first. Each is dismissable per-user.
 *
 * Hides itself entirely when there are no visible announcements.
 */
export async function WhatsNewWidget() {
  const items = await listVisibleAnnouncements();
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">whats new</p>
        <span className="font-mono text-[10px] text-zinc-600">{items.length} update{items.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="divide-y divide-zinc-900">
        {items.map((a) => {
          const toneCls =
            a.tone === "danger"
              ? "border-l-red-500"
              : a.tone === "warn"
              ? "border-l-amber-500"
              : a.tone === "success"
              ? "border-l-emerald-500"
              : "border-l-blue-500";
          return (
            <li key={a.id} className={`flex items-start gap-3 border-l-2 ${toneCls} px-4 py-3 text-sm`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {a.pinned && (
                    <span className="rounded bg-amber-950/40 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                      pinned
                    </span>
                  )}
                  <h3 className="font-semibold text-zinc-100">{a.title}</h3>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{a.body}</p>
                {a.cta_href && a.cta_label && (
                  <a
                    href={a.cta_href}
                    className="mt-2 inline-block text-xs font-semibold text-emerald-400 hover:underline"
                  >
                    {a.cta_label} →
                  </a>
                )}
              </div>
              <DismissAnnouncementButton id={a.id} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
