"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Home memorial band — a candle + portrait for Scot Rubi, in whose honor
 * iKratom is built. Shows his portrait from /public/scot.webp when present; if
 * the file isn't there, it degrades gracefully to a candle so the band always
 * looks intentional. Sits full-width directly under the hero.
 */
export function HomeMemorialBand() {
  const [photoOk, setPhotoOk] = useState(true);
  const reduce = useReducedMotion();

  const flicker = reduce
    ? undefined
    : { opacity: [0.85, 1, 0.9, 1], scale: [1, 1.06, 0.98, 1] };

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      aria-label="In memory of Scot Rubi"
      className="mt-8 overflow-hidden rounded-2xl border border-amber-900/40 bg-gradient-to-b from-zinc-950 via-zinc-950 to-amber-950/15 p-8 text-center sm:p-10"
    >
      <motion.div
        aria-hidden
        className="text-4xl"
        animate={flicker}
        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ filter: "drop-shadow(0 0 14px rgba(245,158,11,0.45))" }}
      >
        🕯️
      </motion.div>

      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-300/80">
        In loving memory
      </p>

      <div className="mt-5 flex justify-center">
        {photoOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/scot.webp"
            alt="Scot Rubi"
            onError={() => setPhotoOk(false)}
            className="h-32 w-32 rounded-full object-cover ring-2 ring-amber-500/40 sm:h-36 sm:w-36"
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-full bg-zinc-900 text-5xl ring-2 ring-amber-500/30 sm:h-36 sm:w-36">
            🌿
          </div>
        )}
      </div>

      <h2 className="mt-5 text-2xl font-bold text-zinc-100">Scot Rubi</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-300">
        iKratom is built in his honor. Much love, brother.
      </p>
    </motion.section>
  );
}
