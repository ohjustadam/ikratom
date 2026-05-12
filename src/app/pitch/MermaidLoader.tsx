"use client";

import { useEffect } from "react";

/**
 * Client-side Mermaid renderer for /pitch. Lazy-imports mermaid only
 * on this route so the rest of the app isn't burdened with the ~1MB
 * Mermaid bundle.
 *
 * Configured for the iKratom dark theme so diagrams blend with the
 * page background instead of forcing the user into a white box.
 */
export function MermaidLoader() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import("mermaid")).default;
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          // Match the iKratom palette so diagrams look native.
          primaryColor: "#10b981",
          primaryTextColor: "#f4f4f5",
          primaryBorderColor: "#3f3f46",
          lineColor: "#71717a",
          secondaryColor: "#18181b",
          tertiaryColor: "#27272a",
          background: "#09090b",
          mainBkg: "#18181b",
          secondBkg: "#1f1f23",
          textColor: "#e4e4e7",
          nodeBorder: "#3f3f46",
          clusterBkg: "#0f0f11",
          clusterBorder: "#3f3f46",
          edgeLabelBackground: "#0a0a0a",
          actorBkg: "#18181b",
          actorBorder: "#10b981",
          actorTextColor: "#f4f4f5",
          actorLineColor: "#71717a",
          signalColor: "#10b981",
          signalTextColor: "#e4e4e7",
          labelTextColor: "#e4e4e7",
          loopTextColor: "#e4e4e7",
          taskBkgColor: "#18181b",
          taskTextColor: "#f4f4f5",
          taskTextOutsideColor: "#e4e4e7",
          taskBorderColor: "#3f3f46",
          activeTaskBkgColor: "#065f46",
          activeTaskBorderColor: "#10b981",
          doneTaskBkgColor: "#0a4533",
          doneTaskBorderColor: "#10b981",
          critBorderColor: "#ef4444",
          critBkgColor: "#7f1d1d",
        },
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" },
        sequence: { useMaxWidth: true, mirrorActors: false },
        gantt: { useMaxWidth: true },
        mindmap: { useMaxWidth: true },
      });
      await mermaid.run({ nodes: document.querySelectorAll("pre.mermaid") });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
