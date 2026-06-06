import { headers } from "next/headers";
import { renderQrSvg } from "@/modules/partners/qr";
import { ShareEverywhere } from "@/components/ShareEverywhere";
import { SpreadControls } from "./SpreadControls";

/**
 * /spread — PUBLIC, self-serve storefront kit. Any shop that carries kratom
 * can grab a free printable QR kit + one-tap digital share with no login and
 * no admin-created partner record (that gated flow lives at
 * /admin/partners/[slug]/kit). Customers scan → land on iKratom → fight for
 * kratom in ~30s. This is the mainstream distribution on-ramp.
 *
 * Personalization is via ?shop= & ?state= (shareable/bookmarkable). The QR
 * deep-links to the state hub when a state is chosen, else the homepage, with
 * ?ref=storefront so proxy.ts can attribute the channel.
 */
export const metadata = {
  title: "Spread the word — free storefront QR kit",
  description:
    "Put kratom advocacy on your counter. A free, ready-to-print QR kit your customers scan to track bills and email their reps in 30 seconds. No signup to act.",
};
export const dynamic = "force-dynamic";

export default async function SpreadPage({
  searchParams,
}: {
  searchParams?: Promise<{ shop?: string; state?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const shop = (sp.shop ?? "").slice(0, 60).trim();
  const state = (sp.state ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "www.ikratom.org";
  const origin = (process.env.APP_URL ?? `${proto}://${host}`).replace(/\/$/, "");

  const path = state ? `/states/${state}` : "/";
  const qrTarget = `${origin}${path}?ref=storefront`;

  const [qrPreview, qrPoster, qrCard, qrSticker] = await Promise.all([
    renderQrSvg(qrTarget, { size: 320 }),
    renderQrSvg(qrTarget, { size: 460 }),
    renderQrSvg(qrTarget, { size: 280 }),
    renderQrSvg(qrTarget, { size: 200 }),
  ]);

  const shopLabel = shop || "Brought to you by your local kratom shop";
  const headline = state ? `Defend kratom in ${state}.` : "Defend your right to kratom.";
  const prettyUrl = qrTarget.replace(/^https?:\/\//, "");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {/* Hero — screen only */}
      <div className="print:hidden">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          ◉ For every kratom storefront in the country
        </p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-zinc-100 sm:text-4xl">
          Put kratom advocacy on your counter.
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-300">
          A free, ready-to-print QR kit. Your customers scan it, land on iKratom, and can track every
          kratom bill + email their reps in about 30 seconds — <strong className="text-zinc-100">no signup
          needed to act</strong>. Nonpartisan, no spam, free forever.
        </p>

        <div className="mt-6">
          <SpreadControls shop={shop} state={state} />
        </div>

        {/* On-screen preview */}
        <section className="mt-6 flex flex-col items-center gap-4 rounded-xl border border-zinc-800 bg-gradient-to-br from-emerald-950/30 to-zinc-950/20 p-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Live preview</p>
          <h2 className="text-2xl font-bold text-zinc-100">{headline}</h2>
          <p className="text-sm text-zinc-400">Scan to email your reps in 30 seconds</p>
          <div
            className="[&_svg]:h-56 [&_svg]:w-56 rounded-lg bg-white p-3"
            dangerouslySetInnerHTML={{ __html: qrPreview }}
          />
          <p className="font-mono text-[11px] text-zinc-500">{prettyUrl}</p>
        </section>

        {/* Digital share */}
        <section className="mt-6">
          <p className="mb-2 text-sm font-semibold text-zinc-200">Or share it digitally — one tap:</p>
          <ShareEverywhere
            url={qrTarget}
            title={state ? `Fight for legal kratom in ${state} — it takes 30 seconds` : "Fight for legal kratom — it takes 30 seconds"}
            description="Track every kratom bill and email your reps with one click. Free, nonpartisan, no spam."
            hashtags={["kratom", "keepkratomlegal"]}
          />
        </section>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Tip: tap <strong className="text-zinc-300">🖨 Print kit</strong> above to print a counter poster,
          a 4×6 card, and a sheet of register stickers. iKratom is nonpartisan and not affiliated with your
          shop — this material is free for community use.
        </p>
      </div>

      {/* ---------- PRINT SHEETS (hidden on screen, one per page when printing) ---------- */}
      <div className="hidden print:block">
        {/* Sheet 1 — counter poster */}
        <section className="kit-sheet sheet-poster">
          <div className="poster-inner">
            <p className="poster-eyebrow">{shopLabel}</p>
            <div className="poster-headline">
              <h2>{headline}</h2>
              <p className="poster-tag">Stand up for safe, legal kratom. Two minutes, one click.</p>
            </div>
            <div className="poster-qr" dangerouslySetInnerHTML={{ __html: qrPoster }} />
            <p className="poster-cta">Scan to email your reps in 30 seconds</p>
            <p className="poster-url">{prettyUrl}</p>
            <ul className="poster-bullets">
              <li>📜 Track every kratom bill in your state</li>
              <li>📨 One-click email to your reps · auto-personalized</li>
              <li>🛡️ Get notified the moment a hostile bill drops</li>
            </ul>
            <p className="poster-foot">
              Free. Nonpartisan. No spam. iKratom is not affiliated with this shop; this material is provided
              for community use.
            </p>
          </div>
        </section>

        {/* Sheet 2 — 4×6 counter card */}
        <section className="kit-sheet sheet-card">
          <div className="card-inner">
            <div className="card-text">
              <p className="card-eyebrow">{shop || "Speak up for kratom"}</p>
              <h2 className="card-headline">Kratom advocacy in 30 sec.</h2>
              <p className="card-sub">Scan, read, send. Free + nonpartisan.</p>
              <p className="card-cta">Scan →</p>
            </div>
            <div className="card-qr" dangerouslySetInnerHTML={{ __html: qrCard }} />
          </div>
        </section>

        {/* Sheet 3 — register stickers (3-up) */}
        <section className="kit-sheet sheet-stickers">
          <div className="sticker-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="sticker">
                <div className="sticker-qr" dangerouslySetInnerHTML={{ __html: qrSticker }} />
                <p className="sticker-text">Speak up for kratom · scan</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <style>{`
        @media print {
          body { background: #fff; color: #000; }
          .kit-sheet { break-after: page; page-break-after: always; background: #fff; color: #111; padding: 0.5in; }
          .kit-sheet:last-child { break-after: auto; page-break-after: auto; }
          .sheet-poster { width: 8.5in; min-height: 11in; }
          .poster-inner { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.25in; }
          .poster-eyebrow { font-size: 13pt; letter-spacing: 0.12em; text-transform: uppercase; color: #666; margin: 0; }
          .poster-headline h2 { font-size: 46pt; font-weight: 800; line-height: 1.05; margin: 0.3in 0 0.1in; }
          .poster-tag { font-size: 15pt; color: #333; max-width: 6in; margin: 0 auto; }
          .poster-qr { margin: 0.3in 0 0.1in; }
          .poster-qr svg { width: 4.4in; height: 4.4in; }
          .poster-cta { font-size: 16pt; font-weight: 700; color: #047857; margin: 0; }
          .poster-url { font-size: 11pt; font-family: ui-monospace, monospace; color: #666; margin: 0.05in 0; }
          .poster-bullets { list-style: none; padding: 0; margin: 0.3in 0; font-size: 13pt; line-height: 1.8; color: #222; }
          .poster-foot { font-size: 9pt; color: #888; margin-top: 0.3in; max-width: 6in; }
          .sheet-card { width: 6in; height: 4in; padding: 0.25in; }
          .card-inner { display: flex; align-items: center; height: 100%; gap: 0.25in; }
          .card-text { flex: 1; }
          .card-eyebrow { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin: 0; }
          .card-headline { font-size: 22pt; font-weight: 800; line-height: 1.05; margin: 0.05in 0; color: #111; }
          .card-sub { font-size: 10pt; color: #333; margin: 0.05in 0 0.1in; }
          .card-cta { font-size: 12pt; font-weight: 700; color: #047857; margin: 0.1in 0 0; }
          .card-qr svg { width: 2.5in; height: 2.5in; }
          .sheet-stickers { width: 8.5in; min-height: 4in; }
          .sticker-grid { display: flex; gap: 0.5in; justify-content: center; flex-wrap: wrap; }
          .sticker { width: 2in; height: 2in; padding: 0.1in; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed #ccc; }
          .sticker-qr svg { width: 1.5in; height: 1.5in; }
          .sticker-text { font-size: 7pt; font-weight: 700; color: #047857; margin: 0.05in 0 0; }
        }
      `}</style>
    </main>
  );
}
