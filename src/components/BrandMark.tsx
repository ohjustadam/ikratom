import { MARK_D, MARK_VIEWBOX } from "@/lib/brand-mark";

/**
 * The "ik" mark as inline SVG. It takes the text color (`currentColor`), so
 * `text-emerald-400` follows the member's theme and accent like the wordmark.
 * Decorative by default; pass `title` when the mark stands alone.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      className={className}
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={MARK_D} />
    </svg>
  );
}
