"use client";

import { useState } from "react";

/**
 * Prominent "copy this briefing's link" affordance, sitting next to the PDF
 * download. PageShare at the top of the page can also copy, but a briefing
 * exists to be forwarded, so the action earns its own button in the header.
 *
 * Replaces an inline <script> that was injected with the CSP nonce. React
 * does not execute a <script> rendered by a component on the client, so the
 * button quietly did nothing after a soft navigation into the page, and
 * React logged "Encountered a script tag while rendering React component"
 * on every render. A client component needs no nonce and works either way.
 */
export function CopyShareLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin, or permission denied) — leave
      // the label alone rather than claiming a copy that didn't happen.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:border-emerald-500"
    >
      {copied ? "✓ Copied!" : "🔗 Copy share link"}
    </button>
  );
}
