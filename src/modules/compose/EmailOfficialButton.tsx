"use client";

import { useState } from "react";
import { ComposeModal } from "./ComposeModal";
import { httpUrlOrNull, isContactFormUrl } from "./send-links";
import type { ComposeOfficial, ComposeContext } from "./types";

/**
 * The one "✉ Email" CTA used on every surface (briefing, bill pages,
 * directories, dashboard, states). Opens the uniform ComposeModal —
 * prefilled letter, AI draft, editing, mailto/Gmail/Outlook/copy, and a
 * contact-form flow when the office has no public inbox.
 *
 * Renders nothing when the official has no email, no contact-form URL, and
 * no website.
 */
export function EmailOfficialButton({
  official,
  context,
  source,
  variant = "chip",
  label,
  className,
}: {
  official: ComposeOfficial;
  context?: ComposeContext;
  /** Surface tag recorded on the send log, e.g. 'legislator_briefing' */
  source: string;
  variant?: "chip" | "button" | "inline";
  /** Override the visible label (default: '✉ Email' / '🌐 Contact form') */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Only a real inbox or a safe http(s) website/form is a usable channel.
  if (!official.email && !httpUrlOrNull(official.website)) return null;

  const isForm = isContactFormUrl(official.email);
  const text =
    label ?? (isForm ? "🌐 Contact form" : official.email ? "✉ Email" : "🌐 Contact");

  const cls =
    className ??
    (variant === "button"
      ? "rounded-md border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
      : variant === "inline"
        ? "text-emerald-400 hover:underline"
        : "rounded border border-emerald-700/50 bg-emerald-950/20 px-2 py-1 text-xs font-semibold text-emerald-300 hover:border-emerald-500");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cls}>
        {text}
      </button>
      {open && (
        <ComposeModal
          open={open}
          onClose={() => setOpen(false)}
          official={official}
          context={context}
          source={source}
        />
      )}
    </>
  );
}
