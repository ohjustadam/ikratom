import Link from "next/link";

export const metadata = {
  title: "Code of Ethics — what we stand for + how we operate",
  description: "iKratom's code of ethics. Nonpartisan kratom advocacy. We don't take sides on whether 7-OH should be banned. We insist on accuracy, evidence, transparency, action — and on cooperation over war.",
};

/**
 * /ethics — the moral anchor of the platform.
 *
 * Owner directive 2026-05-15: 'make a code of morals and ethics page
 * to explain our standing on neutral ground, not choosing war, but
 * choosing peace via cooperation and the masses versus the government,
 * rather than versus we can be side by side and fight together on the
 * same side.'
 *
 * This page is intentionally:
 *   - Short. Long manifestos don't get read.
 *   - Personal in tone. First-person plural with weight, not corporate.
 *   - Anchor-linkable. Each section has an id so debaters can share
 *     "see /ethics#we-do-not-take-sides-on" specifically.
 *   - Read by the chatbot (Phase 2 / Sanctuary Vision). When users ask
 *     'what's your stance on X?' the answer routes here.
 *
 * Style choices:
 *   - No emoji in the main copy (gravitas)
 *   - One quiet emerald accent for the affirmations
 *   - One quiet zinc treatment for the negations
 *   - No CTAs in the middle (a manifesto is read, not bounced through)
 */
export default function EthicsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
      <Link href="/" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Home
      </Link>

      <header className="mt-2 mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          Our code
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
          What we stand for.<br />
          <span className="text-zinc-400">How we operate.</span>
        </h1>
        <p className="mt-5 text-base leading-relaxed text-zinc-300">
          iKratom is a nonpartisan kratom-advocacy platform. We aren&apos;t aligned with the AKA, the GKC, Botanic Tonics, the FDA, the DEA, a state legislator, or any organization. We have allies in all those camps. We have critics in all those camps too. This page is how we explain — and prove — what nonpartisan actually means for the choices we make.
        </p>
      </header>

      <section id="we-do-not-take-sides-on" className="mb-10 scroll-mt-20">
        <h2 className="text-lg font-bold uppercase tracking-wider text-zinc-300">
          We do not take sides on
        </h2>
        <ul className="mt-4 space-y-3 border-l-2 border-zinc-800 pl-5 text-[15px] leading-relaxed text-zinc-300">
          <li>Whether 7-hydroxymitragynine-concentrated products should be banned, regulated, or kept available.</li>
          <li>Whether mitragynine should be a controlled substance.</li>
          <li>Whether kratom is &ldquo;good&rdquo; or &ldquo;bad&rdquo; for any individual person.</li>
          <li>Whether someone&apos;s use of kratom is virtuous or harmful — that&apos;s between them and their doctor.</li>
        </ul>
        <p className="mt-4 text-[13px] leading-relaxed text-zinc-500">
          Our campaign templates reflect this. We ask legislators to clarify scope, cite evidence, and run a transparent process — not to vote a specific way. If you want to send a stance-aligned letter, you can declare your position in your profile and we&apos;ll offer that variant. The default stays neutral.
        </p>
      </section>

      <section id="we-do-insist-on" className="mb-10 scroll-mt-20">
        <h2 className="text-lg font-bold uppercase tracking-wider text-emerald-300">
          We do insist on
        </h2>
        <ul className="mt-4 space-y-4 border-l-2 border-emerald-700/40 pl-5 text-[15px] leading-relaxed text-zinc-200">
          <li>
            <strong className="text-emerald-300">Accuracy.</strong>{" "}
            We distinguish natural leaf, mitragynine, 7-hydroxymitragynine (both as a trace natural alkaloid AND as a concentrated product), pseudoindoxyl, and synthetic analogues — because they are different. Conflating them is the single most common error in public discourse, and we will not repeat it.
          </li>
          <li>
            <strong className="text-emerald-300">Evidence.</strong>{" "}
            We cite peer-reviewed research, not vibes. Our <Link href="/research" className="underline hover:text-emerald-400">research library</Link> shows every paper&apos;s original abstract alongside a conservative AI methodology evaluation. We surface bias indicators — including conflicts of interest in our own sources — rather than hiding them.
          </li>
          <li>
            <strong className="text-emerald-300">Transparency.</strong>{" "}
            Every editorial decision is documented. The <Link href="/takeback" className="underline hover:text-emerald-400">takeback intel</Link> for each banned state names its sources. The <Link href="/banned" className="underline hover:text-emerald-400">banned tracker</Link> filters to verified full-state bans — not 7-OH-only laws or age regulations — and we explain that filter in plain text on the page. Disagree with a call? <Link href="mailto:ohjustadam@proton.me" className="underline hover:text-emerald-400">Email us</Link>; we&apos;ll show our work.
          </li>
          <li>
            <strong className="text-emerald-300">Action.</strong>{" "}
            Information without a way to use it is theatre. Every research finding links to relevant bills. Every bill links to the legislators who decide it. Every legislator surfaces their contact info, their stance signal, and a draft letter. One click sends.
          </li>
          <li>
            <strong className="text-emerald-300">Respect for the person on the other end.</strong>{" "}
            We do not produce form-letter spam. We name legislators we disagree with by name and reasoning — not by insult. We assume good faith first. If we&apos;re wrong about a particular person, we correct it publicly.
          </li>
        </ul>
      </section>

      <section id="choosing-peace-not-war" className="mb-10 scroll-mt-20">
        <h2 className="text-lg font-bold uppercase tracking-wider text-zinc-300">
          Choosing peace, not war
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-200">
          The kratom-policy conversation has been framed as &ldquo;advocates versus regulators&rdquo; for too long. Both sides have legitimate concerns. The regulators see overdose deaths involving 7-OH products and want to act. The advocates see millions of adults using natural-leaf kratom safely and want their access preserved. <strong className="text-zinc-100">Both can be true at once.</strong>
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-200">
          We believe the path forward is cooperation, not victory: better data, better regulation, better consumer protection. Not a defeat for either side — a settlement that protects adults&apos; access to a traditional plant medicine while keeping truly dangerous concentrated synthetics off the shelf at gas stations. A path neither &ldquo;the masses versus the government&rdquo; nor the government versus the masses — but side by side, fighting the same opioid-and-fentanyl epidemic together.
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-200">
          We will work with anyone — at any agency, at any organization, at any company — who is willing to engage honestly. We will publicly disagree with anyone — at any agency, at any organization, at any company — who is not.
        </p>
      </section>

      <section id="together" className="mb-10 scroll-mt-20">
        <h2 className="text-lg font-bold uppercase tracking-wider text-zinc-300">
          Together
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-200">
          We don&apos;t need a million people. We need the right ones — paying attention. Shop owners. Medical professionals. Researchers. Lawyers. Journalists. Recovering opioid users with stories to tell. Family members of people who died and family members of people whom kratom helped survive. All of them, side by side, telling the truth.
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-200">
          If you found this page, you&apos;re probably one of them. Welcome.
        </p>
      </section>

      <section id="how-to-challenge-us" className="mb-10 scroll-mt-20 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
          How to challenge us
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-zinc-300">
          If you think we got a fact wrong, a person wrong, a stance call wrong, or a tone wrong — tell us. We mean it.
        </p>
        <ul className="mt-3 space-y-1.5 text-[13px] text-zinc-400">
          <li>
            Public correction: <Link href="/intel/submit" className="text-emerald-400 hover:underline">submit an intel tip</Link> from the bill page in question
          </li>
          <li>
            Private channel: <a href="mailto:ohjustadam@proton.me" className="text-emerald-400 hover:underline">ohjustadam@proton.me</a>
          </li>
          <li>
            For research-library corrections: leader advocates can <Link href="/research/submit" className="text-emerald-400 hover:underline">add or update papers directly</Link>
          </li>
        </ul>
      </section>

      <footer className="mt-12 border-t border-zinc-800 pt-6">
        <p className="text-[11px] text-zinc-600">
          Last reviewed 2026-05-15. This document evolves as we learn. Material changes will be logged on the home-page changelog. Subtle wording revisions won&apos;t be — they happen continuously as the language gets sharper.
        </p>
        <p className="mt-2 text-[11px] text-zinc-600">
          For the legal &amp; data practices, see{" "}
          <Link href="/privacy" className="underline hover:text-zinc-400">/privacy</Link> and{" "}
          <Link href="/terms" className="underline hover:text-zinc-400">/terms</Link>. They cover what we collect and how we handle it. <strong className="text-zinc-400">This page covers WHY.</strong>
        </p>
      </footer>
    </div>
  );
}
