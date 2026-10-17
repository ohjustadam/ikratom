"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * RouteTransition — a smooth cross-fade between screens. Keyed on the pathname
 * so each App Router navigation re-triggers the fade-in of the new page.
 *
 * Opacity-only on purpose: a transform/filter here would establish a containing
 * block for any position:fixed descendant inside page content. Honors
 * prefers-reduced-motion (renders children untouched).
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  if (reduce) return <>{children}</>;

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
