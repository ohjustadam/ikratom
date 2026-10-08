"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Reveal — fades + lifts its children into view on scroll (once). A thin
 * wrapper over framer-motion so pages can add tasteful entrance motion without
 * each re-implementing it. Honors prefers-reduced-motion (renders a plain div,
 * no animation). framer-motion is already a dependency (used on the home page).
 */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as];

  if (reduce) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </MotionTag>
  );
}
