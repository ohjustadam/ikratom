import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAdminContext } from "@/modules/admin/actions";
import { getPartnerBySlug } from "@/modules/partners/actions";
import { renderQrSvg, partnerQrUrl } from "@/modules/partners/qr";
import { PrintBar } from "./PrintBar";

/**
 * /admin/partners/[slug]/kit — print-ready partner kit.
 *
 * Renders four formats on one HTML page, each on its own paper sheet via
 * `@page` + `break-before: page`. Admin clicks "Print" → browser PDF
 * dialog → save → drop file on USB → ship to shop.
 *
 * Sheet sizes:
 *   1. 8.5×11 portrait counter poster
 *   2. 4×6 landscape counter card
 *   3. 8×8 square window cling
 *   4. 2×2 tip-jar / receipt sticker (with three copies on one sheet to
 *      avoid wasting paper)
 *
 * All four encode the same QR URL: /?ref=embed&host=<slug>. The proxy.ts
 * cookie capture handles attribution downstream — no schema changes
 * needed in this kit.
 *
 * Future-proof: this page renders fresh on every request, so any
 * messaging update we ship later naturally appears in the next print.
 * No "stale USB" concern.
 */
export const metadata = { title: "Partner kit" };
// Print routes don't benefit from caching; always fetch fresh.
export const dynamic = "force-dynamic";

export default async function PartnerKitPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const { slug } = await params;
  const r = await getPartnerBySlug(slug);
  if ("error" in r || !r.partner) notFound();
  const partner = r.partner;

  // Determine origin from the request — falls back to APP_URL env in dev.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "ikratom.org";
  const origin = process.env.APP_URL ?? `${proto}://${host}`;

  const qrTarget = partnerQrUrl({ origin, slug: partner.slug });

  // Pre-render the QR at four sizes, picking error correction so even a
  // tiny 2-inch sticker still scans.
  const [qrPoster, qrCard, qrCling, qrSticker] = await Promise.all([
    renderQrSvg(qrTarget, { size: 480 }),
    renderQrSvg(qrTarget, { size: 280 }),
    renderQrSvg(qrTarget, { size: 360 }),
    renderQrSvg(qrTarget, { size: 200 }),
  ]);

  const tagline =
    partner.tagline ??
    "Stand up for safe, legal kratom. Two minutes, one click.";
  const cityState = [partner.city, partner.state].filter(Boolean).join(", ");

  return (
    <>
      <PrintBar partnerName={partner.shop_name} qrUrl={qrTarget} />

      <div className="kit-root mx-auto max-w-4xl px-4 py-10 print:max-w-none print:p-0">
        {/* Sheet 1 — counter poster, 8.5×11 portrait */}
        <section className="kit-sheet sheet-poster">
          <div className="poster-inner">
            <p className="poster-eyebrow">Brought to you by</p>
            <h1 className="poster-shop">{partner.shop_name}</h1>
            {cityState && <p className="poster-loc">{cityState}</p>}

            <div className="poster-headline">
              <h2>Defend your right to kratom.</h2>
              <p className="poster-tag">{tagline}</p>
            </div>

            <div className="poster-qr"
              dangerouslySetInnerHTML={{ __html: qrPoster }}
            />
            <p className="poster-cta">Scan to email your reps in 30 seconds</p>
            <p className="poster-url">{qrTarget.replace(/^https?:\/\//, "")}</p>

            <ul className="poster-bullets">
              <li>📜 Track every kratom bill in your state</li>
              <li>📨 One-click email to your reps · auto-personalized</li>
              <li>🛡️ Get notified the moment a hostile bill drops</li>
            </ul>

            <p className="poster-foot">
              Free. Nonpartisan. No spam. iKratom is not affiliated with this shop;
              this material is provided for community use.
            </p>
          </div>
        </section>

        {/* Sheet 2 — counter card, 4×6 landscape */}
        <section className="kit-sheet sheet-card">
          <div className="card-inner">
            <div className="card-text">
              <p className="card-eyebrow">{partner.shop_name}</p>
              <h2 className="card-headline">Kratom advocacy in 30 sec.</h2>
              <p className="card-sub">{tagline}</p>
              <p className="card-cta">Scan →</p>
            </div>
            <div className="card-qr"
              dangerouslySetInnerHTML={{ __html: qrCard }}
            />
          </div>
        </section>

        {/* Sheet 3 — window cling, 8×8 square */}
        <section className="kit-sheet sheet-cling">
          <div className="cling-inner">
            <h2 className="cling-headline">Speak up.</h2>
            <p className="cling-sub">For kratom. For your shop.</p>
            <div className="cling-qr"
              dangerouslySetInnerHTML={{ __html: qrCling }}
            />
            <p className="cling-shop">{partner.shop_name}</p>
            <p className="cling-url">scan or visit ikratom.org</p>
          </div>
        </section>

        {/* Sheet 4 — sticker sheet, 3 copies of a 2×2 sticker */}
        <section className="kit-sheet sheet-stickers">
          <p className="sticker-instructions print:hidden">
            Three identical 2&quot;×2&quot; stickers on one sheet. Cut to size, peel, place near the register.
          </p>
          <div className="sticker-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="sticker">
                <div className="sticker-qr"
                  dangerouslySetInnerHTML={{ __html: qrSticker }}
                />
                <p className="sticker-text">Speak up for kratom · scan</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Print-friendly CSS. Each sheet pushes a page break before the next. */}
      <style>{`
        @media print {
          body { background: #fff; color: #000; }
          .kit-root { padding: 0 !important; }
          .kit-sheet { break-after: page; page-break-after: always; }
          .kit-sheet:last-child { break-after: auto; page-break-after: auto; }
        }
        .kit-sheet {
          background: #fff; color: #111; padding: 0.5in;
          margin: 0 auto 1in;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.05);
        }
        .sheet-poster {
          width: 8.5in; min-height: 11in;
        }
        .poster-inner { display: flex; flex-direction: column; align-items: center; text-align: center; height: 100%; gap: 0.25in; }
        .poster-eyebrow { font-size: 14pt; letter-spacing: 0.2em; text-transform: uppercase; color: #666; margin: 0; }
        .poster-shop { font-size: 36pt; font-weight: 800; margin: 0.05in 0 0; color: #111; }
        .poster-loc { font-size: 14pt; color: #666; margin: 0; }
        .poster-headline h2 { font-size: 48pt; font-weight: 800; line-height: 1.05; margin: 0.4in 0 0.1in; }
        .poster-tag { font-size: 16pt; color: #333; max-width: 6in; margin: 0 auto; }
        .poster-qr { margin: 0.4in 0 0.1in; }
        .poster-qr svg { width: 4.5in; height: 4.5in; }
        .poster-cta { font-size: 16pt; font-weight: 700; color: #047857; margin: 0; }
        .poster-url { font-size: 11pt; font-family: ui-monospace, monospace; color: #666; margin: 0.05in 0; }
        .poster-bullets { list-style: none; padding: 0; margin: 0.3in 0; font-size: 13pt; line-height: 1.8; color: #222; }
        .poster-bullets li { padding-left: 0; }
        .poster-foot { font-size: 9pt; color: #888; margin-top: auto; max-width: 6in; }

        .sheet-card {
          width: 6in; height: 4in; padding: 0.25in;
        }
        .card-inner { display: flex; align-items: center; height: 100%; gap: 0.25in; }
        .card-text { flex: 1; }
        .card-eyebrow { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin: 0; }
        .card-headline { font-size: 22pt; font-weight: 800; line-height: 1.05; margin: 0.05in 0; color: #111; }
        .card-sub { font-size: 10pt; color: #333; margin: 0.05in 0 0.1in; }
        .card-cta { font-size: 12pt; font-weight: 700; color: #047857; margin: 0.1in 0 0; }
        .card-qr svg { width: 2.5in; height: 2.5in; }

        .sheet-cling {
          width: 8in; height: 8in; padding: 0.4in;
          display: flex; align-items: center; justify-content: center;
        }
        .cling-inner { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.15in; }
        .cling-headline { font-size: 56pt; font-weight: 900; margin: 0; color: #047857; }
        .cling-sub { font-size: 16pt; color: #222; margin: 0; }
        .cling-qr { margin: 0.2in 0; }
        .cling-qr svg { width: 3.6in; height: 3.6in; }
        .cling-shop { font-size: 12pt; font-weight: 700; color: #111; margin: 0.1in 0 0; }
        .cling-url { font-size: 10pt; color: #666; margin: 0; }

        .sheet-stickers {
          width: 8.5in; min-height: 4in;
        }
        .sticker-instructions { font-size: 10pt; color: #666; margin: 0 0 0.25in; }
        .sticker-grid { display: flex; gap: 0.5in; justify-content: center; flex-wrap: wrap; }
        .sticker { width: 2in; height: 2in; padding: 0.1in; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed #ccc; }
        .sticker-qr svg { width: 1.5in; height: 1.5in; }
        .sticker-text { font-size: 7pt; font-weight: 700; color: #047857; margin: 0.05in 0 0; }
      `}</style>
    </>
  );
}
