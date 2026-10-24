"use client";

/**
 * B9 notice on the "open in your own email app" paths. The compose window gets
 * a hidden copy (BCC) to r-<nonce>@ikratom.org so the letter counts on the
 * member's record; this says so plainly and lets them opt out (owner rule:
 * approved only with this notice, 2026-10-21).
 */
export function SendRecordNotice({
  keepCopy,
  onChange,
}: {
  keepCopy: boolean;
  onChange: (keep: boolean) => void;
}) {
  return (
    <label className="mb-3 flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
      <input
        type="checkbox"
        checked={keepCopy}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
      />
      <span>
        <strong className="text-zinc-300">Keep a copy on my iKratom record.</strong> A hidden copy (BCC) goes to an{" "}
        <span className="font-mono text-zinc-300">r-…@ikratom.org</span> address so this letter counts as sent.
        Officials never see a BCC. Untick this, or delete that BCC line in the compose window, if you&apos;d rather not.
      </span>
    </label>
  );
}
