"use client";

import { useMemo } from "react";
import { renderMarkdown } from "@/lib/markdown";

/**
 * Client-side markdown renderer. Uses our sanitized renderer from
 * src/lib/markdown.ts — output is safe to inject as HTML.
 */
export function Markdown({ children }: { children: string }) {
  const html = useMemo(() => renderMarkdown(children), [children]);
  return (
    <div
      className="md-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
