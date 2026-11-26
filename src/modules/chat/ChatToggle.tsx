"use client";

/** A full-width on/off row with a plain label: a big target, easy to read. */
export function ChatToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-[var(--lc-border)] px-3 py-2 text-left hover:bg-[var(--lc-surface)] focus-visible:outline-2 focus-visible:outline-[var(--lc-accent)]"
    >
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-[0.8em] text-[var(--lc-muted)]">{hint}</span>}
      </span>
      <span aria-hidden className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-[var(--lc-accent)]" : "bg-[var(--lc-border)]"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-[var(--lc-bg)] transition-all ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}
