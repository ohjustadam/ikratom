import { getContent } from "@/lib/editable-content";
import { donateConfig } from "@/config/donate.config";

/**
 * The always-visible donation strip along the bottom border.
 *
 * Replaces the hard-coded Cash App line that used to live inline in
 * layout.tsx — which the owner could not edit or remove without a code change.
 * Now the text comes from the `donate.strip` editable-content key, so the owner
 * edits it at /admin/content/donate.strip and can HIDE it entirely by saving an
 * empty value. That was the actual ask: change it, or delete it, without me.
 *
 * Cookieless + cached: `getContent` reads through unstable_cache with a
 * service-role client, so this renders on STATIC pages without dragging the
 * whole app back into dynamic rendering (the thing that caused the CPU outage —
 * see private/STATIC_CHROME_PLAN.md). It also fails soft: if the DB is
 * unreachable, `stripFallback` still renders.
 *
 * One CTA, not three payment links: at 11px on every page there is no room for
 * a real ask, and a single click-through to /donate lets us explain the
 * situation properly and offer every method including "something else".
 */
export async function DonateStrip() {
  // Empty string = owner has deliberately hidden the strip.
  const text = await getContent("donate.strip", donateConfig.stripFallback);
  if (!text || !text.trim()) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-emerald-900/50 bg-zinc-950/95 px-3 py-1.5 text-center text-[11px] text-zinc-400 backdrop-blur lg:bottom-0">
      <span className="align-middle">{text}</span>{" "}
      <a
        href="/donate"
        className="ml-1 inline-block rounded-full bg-emerald-500 px-3 py-0.5 align-middle text-[11px] font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
      >
        {donateConfig.ctaLabel} →
      </a>
    </div>
  );
}
