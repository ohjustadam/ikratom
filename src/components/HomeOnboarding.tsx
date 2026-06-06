"use client";

import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";

/**
 * Home onboarding band — two on-ramps + the "what you're signing up for"
 * explainers (calendar / email / calls). The character path is the high-intent
 * route (purpose to act); the fast path is for the impatient. Pressure without
 * force. Framer Motion staggers the cards in, gated behind reduced-motion.
 */
const EXPLAINERS = [
  {
    icon: "📅",
    title: "Calendar sync",
    body: "Hearings, votes, and BoP meetings on a calendar you can subscribe to — so a last-minute, quietly-posted ban hearing never slips by you again.",
  },
  {
    icon: "📨",
    title: "Email sync",
    body: "Connect Gmail or Outlook once. Then send a personalized letter to your specific legislators in one click — from your own address, in your own voice.",
  },
  {
    icon: "📞",
    title: "Calls that count",
    body: "Tap to call your officials from your phone. Opt in to a live transcript and we log what was said to the official's record — so we can hold them to it.",
  },
];

const CONTAINER: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const ITEM: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

export function HomeOnboarding() {
  const animate = !useReducedMotion();

  return (
    <section className="mt-12 border-t border-zinc-800 pt-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">◉ Two minutes to set up</p>
      <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
        Start as your full self — <span className="text-zinc-400">or just get in the door.</span>
      </h2>

      {/* Two on-ramps */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/15 p-6">
          <h3 className="text-lg font-bold text-emerald-200">🎭 Create your advocate character</h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            Your story, your state, what&apos;s at stake for you — this is what powers letters that read like{" "}
            <span className="font-semibold text-zinc-100">you</span> wrote them. Astroturf groups submit 500 identical
            form letters; we submit 500 individually-written ones.{" "}
            <span className="font-semibold text-emerald-300">That&apos;s the lever that wins.</span> Five minutes now
            makes every future action one tap.
          </p>
          <Link
            href="/signup?redirect=/account/character"
            className="mt-4 inline-block rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Build my character →
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6">
          <h3 className="text-lg font-bold text-zinc-100">⚡ Just get me in</h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Short on time? Create an account in about 90 seconds and start taking action now. You can build out your
            character whenever you&apos;re ready — nothing&apos;s locked behind it.
          </p>
          <Link
            href="/signup"
            className="mt-4 inline-block rounded-md border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-200 hover:border-emerald-500 hover:text-emerald-300"
          >
            Quick signup →
          </Link>
        </div>
      </div>

      {/* Explainers */}
      <motion.div
        className="mt-6 grid gap-4 sm:grid-cols-3"
        variants={animate ? CONTAINER : undefined}
        initial={animate ? "hidden" : false}
        whileInView={animate ? "show" : undefined}
        viewport={{ once: true, margin: "-60px" }}
      >
        {EXPLAINERS.map((e) => (
          <motion.div
            key={e.title}
            variants={animate ? ITEM : undefined}
            className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5"
          >
            <p className="text-2xl">{e.icon}</p>
            <h4 className="mt-2 text-sm font-semibold text-zinc-100">{e.title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">{e.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
