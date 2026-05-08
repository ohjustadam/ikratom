#!/usr/bin/env node
/**
 * Briefing → PDF builder.
 *
 * Reads a markdown file from `briefings/<slug>.md`, applies the
 * industry-briefing CSS theme below, and writes a print-ready PDF to
 * `public/briefings/<slug>.pdf`. The output is committed to the repo
 * so the URL https://www.ikratom.org/briefings/<slug>.pdf is permanent
 * and shareable without rebuild.
 *
 * Run:
 *   npm run build:briefing-pdf -- briefings/ndcs-2026.md
 *   npm run build:briefing-pdf -- briefings/<slug>.md
 */
import { mdToPdf } from "md-to-pdf";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const inputArg = process.argv[2];
if (!inputArg) {
  console.error("Usage: build-briefing-pdf.mjs <path-to-markdown>");
  process.exit(1);
}
const inputPath = path.isAbsolute(inputArg) ? inputArg : path.join(repoRoot, inputArg);
const slug = path.basename(inputPath, path.extname(inputPath));
const outDir = path.join(repoRoot, "public", "briefings");
const outPath = path.join(outDir, `${slug}.pdf`);

// Industry-briefing CSS — light theme with iKratom green accents.
// Designed for letter-size paper, 4-7 pages, dense but airy. Avoids
// the dark-mode aesthetic of the web app since PDFs are usually printed
// or read on light backgrounds. Brand color stays as the accent only.
const CSS = `
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: #1a1d20;
  margin: 0;
  padding: 0;
}

/* Cover page */
.cover {
  min-height: 90vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 40pt 0;
}
.ribbon {
  display: inline-block;
  background: #10b981;
  color: #ffffff;
  padding: 6pt 16pt;
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 36pt;
  border-radius: 2pt;
}
.cover h1 {
  font-size: 36pt;
  line-height: 1.1;
  font-weight: 800;
  margin: 0 0 8pt 0;
  color: #0a0e12;
  letter-spacing: -0.015em;
}
.cover h2 {
  font-size: 18pt;
  font-weight: 600;
  margin: 0 0 24pt 0;
  color: #4a5158;
  border: none;
  padding: 0;
  letter-spacing: -0.01em;
}
.cover .subtitle {
  font-size: 11.5pt;
  color: #4a5158;
  margin: 0 0 56pt 0;
  max-width: 480pt;
  line-height: 1.5;
}
.cover .meta {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 24pt;
  margin-top: auto;
  padding-top: 32pt;
  border-top: 2pt solid #10b981;
  font-size: 9pt;
  color: #4a5158;
}
.cover .meta strong {
  color: #0a0e12;
  font-size: 9.5pt;
  display: block;
  margin-bottom: 4pt;
  letter-spacing: 0.03em;
}

/* Body typography */
h1, h2, h3 { color: #0a0e12; letter-spacing: -0.01em; }
h2 {
  font-size: 18pt;
  font-weight: 700;
  margin: 32pt 0 14pt 0;
  padding-bottom: 8pt;
  border-bottom: 2pt solid #10b981;
}
h3 {
  font-size: 12.5pt;
  font-weight: 700;
  margin: 18pt 0 6pt 0;
}
p { margin: 0 0 10pt 0; }
strong { color: #0a0e12; font-weight: 600; }
em { font-style: italic; }
a { color: #047857; text-decoration: none; border-bottom: 0.5pt solid #047857; }

ul, ol { margin: 8pt 0 16pt 0; padding-left: 22pt; }
li { margin-bottom: 6pt; }

/* Page break helper */
.page-break { page-break-before: always; height: 0; }

/* Callout boxes */
.callout {
  border-left: 3pt solid;
  padding: 14pt 18pt;
  margin: 16pt 0;
  font-size: 11pt;
  border-radius: 0 4pt 4pt 0;
}
.callout strong { display: block; margin-bottom: 6pt; font-size: 11.5pt; }
.callout-emerald { border-color: #10b981; background: #f0fdf4; }
.callout-zinc { border-color: #71717a; background: #f4f4f5; }

/* Commit grid (federal commitments) */
.commit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14pt;
  margin: 16pt 0;
}
.commit {
  border: 1pt solid #e4e4e7;
  border-radius: 4pt;
  padding: 14pt 16pt;
  background: #fafafa;
  page-break-inside: avoid;
}
.commit .num {
  display: inline-block;
  width: 22pt;
  height: 22pt;
  line-height: 22pt;
  text-align: center;
  background: #10b981;
  color: white;
  border-radius: 50%;
  font-weight: 700;
  font-size: 11pt;
  margin-bottom: 8pt;
}
.commit h3 { margin: 0 0 6pt 0; font-size: 11.5pt; }
.commit p { font-size: 10pt; color: #3f4549; margin: 0 0 6pt 0; }

/* Quantified-target chart — 3-column grid: label | track | value.
   Replaces the older .bar-with-text-inside approach where the label
   overflowed when the bar's percentage width was shorter than the
   label needed. */
.data-bar { margin: 8pt 0; }
.data-bar-row {
  display: grid;
  grid-template-columns: 90pt 1fr 70pt;
  align-items: center;
  gap: 8pt;
  margin-bottom: 5pt;
}
.data-bar-label {
  font-size: 9pt;
  color: #4a5158;
  font-weight: 600;
}
.data-bar-track {
  background: #e4e4e7;
  height: 12pt;
  border-radius: 2pt;
  overflow: hidden;
}
.data-bar-fill {
  background: #10b981;
  height: 100%;
  border-radius: 2pt;
}
.data-bar-row:nth-child(1) .data-bar-fill { background: #6ee7b7; }
.data-bar-row:nth-child(2) .data-bar-fill { background: #34d399; }
.data-bar-row:nth-child(3) .data-bar-fill { background: #10b981; }
.data-bar-value {
  font-size: 9pt;
  font-weight: 700;
  color: #0a0e12;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.hint { font-size: 9pt; color: #71717a; font-style: italic; margin-top: 4pt; }

/* Decode table */
table.decode {
  width: 100%;
  border-collapse: collapse;
  margin: 14pt 0;
  font-size: 10pt;
}
table.decode th {
  background: #0a0e12;
  color: white;
  padding: 8pt 12pt;
  text-align: left;
  font-weight: 600;
  font-size: 10pt;
}
table.decode td {
  border: 1pt solid #e4e4e7;
  padding: 10pt 12pt;
  vertical-align: top;
  width: 50%;
}
table.decode tr:nth-child(odd) td { background: #fafafa; }

/* Strategic takeaways */
.takeaways { margin: 14pt 0; }
.takeaway {
  border: 1pt solid #e4e4e7;
  border-radius: 4pt;
  padding: 14pt 16pt;
  margin-bottom: 12pt;
  page-break-inside: avoid;
  background: white;
}
.takeaway h3 { margin: 0 0 6pt 0; font-size: 12pt; }
.takeaway p { font-size: 10pt; color: #3f4549; margin: 0; }
.badge {
  display: inline-block;
  padding: 3pt 10pt;
  font-size: 8.5pt;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 2pt;
  margin-bottom: 8pt;
}
.badge-red { background: #fee2e2; color: #991b1b; }
.badge-emerald { background: #d1fae5; color: #064e3b; }
.badge-amber { background: #fef3c7; color: #78350f; }

/* Missing list (what it does NOT say) */
.missing {
  background: #f0fdf4;
  border-left: 3pt solid #10b981;
  padding: 14pt 18pt 14pt 16pt;
  margin: 16pt 0;
}
.missing ul { margin: 0; padding-left: 22pt; }
.missing li { margin-bottom: 8pt; }

/* Talking points cheat sheet */
.talking-points { margin: 14pt 0; }
.point {
  border: 1pt solid #e4e4e7;
  border-radius: 4pt;
  margin-bottom: 12pt;
  page-break-inside: avoid;
  overflow: hidden;
}
.point .q {
  background: #0a0e12;
  color: white;
  padding: 10pt 14pt;
  font-weight: 600;
  font-size: 10.5pt;
  font-style: italic;
}
.point .a {
  padding: 12pt 14pt;
  background: white;
  font-size: 10.5pt;
  line-height: 1.55;
}

/* Action checklist */
.action-checklist { margin: 14pt 0; }
.action {
  display: flex;
  gap: 12pt;
  align-items: flex-start;
  padding: 12pt 0;
  border-bottom: 0.5pt solid #e4e4e7;
}
.action:last-child { border-bottom: none; }
.action .check {
  font-size: 16pt;
  font-weight: 300;
  color: #10b981;
  margin-top: -2pt;
  width: 18pt;
  flex-shrink: 0;
}
.action div:last-child { font-size: 10.5pt; }
.action strong { color: #0a0e12; }

/* Footer */
.footer {
  font-size: 9pt;
  color: #71717a;
  line-height: 1.5;
  margin-bottom: 8pt;
}
.link { font-family: "SF Mono", Consolas, monospace; font-size: 9.5pt; word-break: break-all; }

/* General body padding */
body > h1, body > h2, body > h3,
body > p, body > ul, body > ol,
body > .callout, body > .commit-grid,
body > .takeaways, body > .missing,
body > .talking-points, body > .action-checklist,
body > table {
  padding-left: 24pt;
  padding-right: 24pt;
}
.cover { padding-left: 48pt; padding-right: 48pt; }
`;

console.log(`Building PDF: ${path.basename(inputPath)} → ${path.relative(repoRoot, outPath)}`);

const result = await mdToPdf(
  { path: inputPath },
  {
    dest: outPath,
    css: CSS,
    pdf_options: {
      format: "Letter",
      margin: { top: "16mm", bottom: "16mm", left: "0mm", right: "0mm" },
      printBackground: true,
      preferCSSPageSize: false,
    },
    launch_options: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  },
).catch((e) => { console.error("md-to-pdf failed:", e.message); process.exit(1); });

if (!result) {
  console.error("md-to-pdf returned no result");
  process.exit(1);
}

console.log(`✓ Wrote ${outPath}`);
