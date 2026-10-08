---
title: "7-OH, Pseudoindoxyl & the MGMs — Federal Scheduling Intel Packet"
subtitle: "What is actually banned on August 26, what is not, and why the reopened 7-OH comment window through September 10 is the community's live shot"
# Quoted so gray-matter keeps this a string. The [slug] page renders it with
# String(data.published); an unquoted YAML date parses to a Date and prints as
# "Sun Aug 23 2026 19:00:00 GMT-0500 (...)" in the reader's local zone.
published: "2026-08-25"
source: "Federal Register docs 2026-17429, 2026-17409, 2026-13580, 2026-13581, 2026-13608; CRS LSB11457; 21 CFR 1300.01 & 1308.11; CFSRE/NPS Discovery forensic reports"
prepared_by: "iKratom Policy Desk"
read_time: "15 min"
audience: "Advocates · Shop owners · Vendors · Medical professionals · Legislative staff"
summary: "HHS just reopened the 7-OH comment period through September 10, 2026 — the community's live shot at fixing the threshold. Meanwhile mitragynine pseudoindoxyl, MGM-15 and MGM-16 become Schedule I on August 26 with no threshold at all. Natural leaf and mitragynine are not scheduled."
---

<style>
.briefing-md .k7-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.75em;margin:1.25em 0}
.briefing-md .k7-card{border:1px solid #27272a;border-radius:6px;padding:.9em 1em;background:rgba(24,24,27,.5)}
.briefing-md .k7-card .k7-name{font-weight:700;color:#fafafa;font-size:.95em;line-height:1.3}
.briefing-md .k7-card .k7-sub{font-size:.75em;color:#71717a;margin-top:.15em}
.briefing-md .k7-card .k7-state{margin-top:.6em;font-size:.8em;font-weight:700;letter-spacing:.03em}
.briefing-md .k7-red .k7-state{color:#f87171}
.briefing-md .k7-amber .k7-state{color:#fbbf24}
.briefing-md .k7-green .k7-state{color:#34d399}
.briefing-md .k7-red{border-left:3px solid #dc2626}
.briefing-md .k7-amber{border-left:3px solid #d97706}
.briefing-md .k7-green{border-left:3px solid #059669}
.briefing-md .k7-fig{margin:1.5em 0;padding:1em;border:1px solid #27272a;border-radius:6px;background:rgba(24,24,27,.35)}
.briefing-md .k7-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.briefing-md .k7-fig svg{display:block;width:100%;height:auto;overflow:visible}
/* Base rule must precede the media query — same specificity, so source order
   decides and a later `display:none` would beat the query's `display:block`. */
.briefing-md .k7-scrollhint{display:none;font-size:.72em;color:#71717a;margin-bottom:.5em;font-style:italic}
/* Below ~680px a 760-unit viewBox scaled to fit makes the labels ~4px tall.
   Hold the SVG at a legible width and let the wrapper scroll sideways. */
@media (max-width:680px){
  .briefing-md .k7-fig svg{width:640px}
  .briefing-md .k7-scrollhint{display:block}
}
.briefing-md .k7-cap{font-size:.78em;color:#71717a;margin-top:.6em;line-height:1.5}
.briefing-md .k7-cap strong{color:#a1a1aa}
.briefing-md .k7-sr{font-size:.8em;color:#a1a1aa;border-top:1px solid #27272a;margin-top:.8em;padding-top:.5em}
.briefing-md table.k7-t{width:100%;border-collapse:collapse;margin:1em 0;font-size:.86em}
.briefing-md table.k7-t th{background:#18181b;color:#fafafa;padding:.55em .8em;text-align:left;font-size:.92em}
.briefing-md table.k7-t td{border:1px solid #27272a;padding:.6em .8em;vertical-align:top}
.briefing-md table.k7-t tr:nth-child(odd) td{background:rgba(24,24,27,.4)}
.briefing-md .k7-yes{color:#34d399;font-weight:700}
.briefing-md .k7-no{color:#f87171;font-weight:700}
.briefing-md .k7-alert{border:1px solid #d97706;border-left:5px solid #d97706;background:rgba(251,191,36,.10);border-radius:6px;padding:1.1em 1.25em;margin:1.5em 0}
.briefing-md .k7-alert .k7-alert-tag{display:inline-block;background:#d97706;color:#1c1917;font-size:.68em;font-weight:800;letter-spacing:.09em;text-transform:uppercase;padding:.22em .7em;border-radius:2px;margin-bottom:.6em}
.briefing-md .k7-alert h3{margin-top:.2em}
.briefing-md .k7-deadline{display:flex;flex-wrap:wrap;gap:.5em 1.5em;margin-top:.8em;padding-top:.7em;border-top:1px solid rgba(217,119,6,.35);font-size:.85em}
.briefing-md .k7-deadline div strong{display:block;font-size:.78em;color:#a16207;text-transform:uppercase;letter-spacing:.06em}
.briefing-md .k7-quote{border-left:3px solid #10b981;background:rgba(16,185,129,.06);padding:.9em 1.1em;margin:1.1em 0;font-size:.93em}
.briefing-md .k7-quote .k7-src{display:block;margin-top:.5em;font-size:.8em;color:#71717a;font-style:normal}
html[data-theme="light"] .briefing-md .k7-card{background:rgba(0,0,0,.03);border-color:#d4d4d8}
html[data-theme="light"] .briefing-md .k7-card .k7-name{color:#18181b}
html[data-theme="light"] .briefing-md .k7-fig{background:rgba(0,0,0,.02);border-color:#d4d4d8}
html[data-theme="light"] .briefing-md table.k7-t td{border-color:#d4d4d8}
html[data-theme="light"] .briefing-md table.k7-t tr:nth-child(odd) td{background:rgba(0,0,0,.03)}
html[data-theme="light"] .briefing-md .k7-red .k7-state{color:#b91c1c}
html[data-theme="light"] .briefing-md .k7-amber .k7-state{color:#b45309}
html[data-theme="light"] .briefing-md .k7-green .k7-state{color:#047857}
html[data-theme="light"] .briefing-md .k7-yes{color:#047857}
html[data-theme="light"] .briefing-md .k7-no{color:#b91c1c}
</style>

<div class="cover">
<div class="ribbon">Federal Scheduling Intel Packet · Nonpartisan · Freely Shareable</div>

<p class="subtitle">A primary-source read of four Federal Register documents, the CFR isomer rule, and the forensic chemistry. Written to replace rumor with citations you can check yourself.</p>

<div class="meta">
<div><strong>Primary sources</strong><br/>FR 2026-17429, 2026-13580,<br/>2026-13581, 2026-13608</div>
<div><strong>Prepared by</strong><br/>iKratom Policy Desk</div>
<div><strong>Status as of</strong><br/>August 25, 2026</div>
<div><strong>Read time</strong><br/>15 minutes</div>
</div>
</div>

<div class="page-break"></div>

<div class="k7-alert">
<span class="k7-alert-tag">Breaking · filed 8:45am, August 25</span>

### HHS has reopened the 7-OH comment period — it now closes September 10

Rather than issue the 7-OH order, HHS filed an **extension of the comment period** on the very threshold that order depends on. Its stated reason: *"in response to a request for an extension to allow interested persons additional time to provide comments."*

Same docket as before — **HHS-OASH-2026-0232** — so it is a continuation, not a restart. Everything submitted in July still counts. **This is the community's live shot, and it is the only federal comment window currently open on kratom.**

<div class="k7-deadline">
<div><strong>Deadline</strong>September 10, 2026</div>
<div><strong>Docket</strong>HHS-OASH-2026-0232</div>
<div><strong>Scope</strong>The threshold number only</div>
<div><strong>Where</strong>regulations.gov</div>
</div>
</div>

## The one-paragraph version

On **August 26, 2026**, three substances — **mitragynine pseudoindoxyl, MGM-15, and MGM-16** — become Schedule I controlled substances for two years, until **August 26, 2028**. The order was signed August 24 and carries **no threshold**: any detectable amount counts. The separate, much better-publicised action against **7-hydroxymitragynine (7-OH)** has **still not been issued** — it remains a notice of intent only, now 20 days past the earliest date DEA gave itself, and on August 25 HHS **reopened the comment period on its threshold through September 10**. **Natural kratom leaf and mitragynine are not scheduled, not proposed for scheduling, and are expressly excluded** by every federal document in this file. But two genuine drafting gaps exist, and the community is currently pointing at the wrong one.

<div class="k7-board">
<div class="k7-card k7-red">
<div class="k7-name">Mitragynine pseudoindoxyl</div>
<div class="k7-sub">MP · 21 CFR 1308.11(h)(89)</div>
<div class="k7-state">SCHEDULE I — Aug 26, 2026</div>
</div>
<div class="k7-card k7-red">
<div class="k7-name">MGM-15</div>
<div class="k7-sub">dihydro-7-OH · (h)(90)</div>
<div class="k7-state">SCHEDULE I — Aug 26, 2026</div>
</div>
<div class="k7-card k7-red">
<div class="k7-name">MGM-16</div>
<div class="k7-sub">9-fluoro-dihydro-7-OH · (h)(91)</div>
<div class="k7-state">SCHEDULE I — Aug 26, 2026</div>
</div>
<div class="k7-card k7-amber">
<div class="k7-name">7-hydroxymitragynine</div>
<div class="k7-sub">7-OH · above a threshold</div>
<div class="k7-state">PENDING — comments reopened to Sep 10</div>
</div>
<div class="k7-card k7-green">
<div class="k7-name">Mitragynine</div>
<div class="k7-sub">the primary leaf alkaloid</div>
<div class="k7-state">NOT SCHEDULED</div>
</div>
<div class="k7-card k7-green">
<div class="k7-name">Kratom leaf</div>
<div class="k7-sub">Mitragyna speciosa, plain leaf</div>
<div class="k7-state">NOT SCHEDULED</div>
</div>
</div>

<p class="hint">Every claim in this packet is sourced to a public document. The full citation list is at the end — check us.</p>

---

## 1. The paper trail

Five documents govern all of this. They are commonly confused with each other, which is where most of the misinformation starts.

<span class="k7-scrollhint">← scroll for the full table →</span>
<div class="k7-scroll">
<table class="k7-t">
<tr><th>Document</th><th>What it is</th><th>Citation</th><th>Status</th></tr>
<tr><td><strong>2026-13581</strong></td><td>Notice of intent — MP, MGM-15, MGM-16</td><td>91 FR 40909 · Jul 6, 2026 · Docket DEA-1644</td><td>Superseded by the order below</td></tr>
<tr><td><strong>2026-17429</strong></td><td><strong>The temporary scheduling ORDER</strong> — MP, MGM-15, MGM-16</td><td>Signed Aug 24 · publishes Aug 26, 2026 · Docket DEA-1644</td><td><span class="k7-no">EFFECTIVE Aug 26</span></td></tr>
<tr><td><strong>2026-13580</strong></td><td>Notice of intent — 7-OH above a specified threshold</td><td>91 FR 40917 · Jul 6, 2026 · Docket DEA-1570</td><td><span class="k7-yes">No order issued</span></td></tr>
<tr><td><strong>2026-13608</strong></td><td>HHS request for information — the 7-OH threshold only</td><td>91 FR 41049 · Jul 6, 2026 · Docket HHS-OASH-2026-0232</td><td>Closed Jul 31 · 32,145 comments</td></tr>
<tr><td><strong>2026-17409</strong></td><td><strong>Extension of that comment period</strong></td><td>Filed Aug 25 · publishes Aug 26, 2026 · Docket HHS-OASH-2026-0232</td><td><span class="k7-yes">OPEN until Sep 10</span></td></tr>
</table>
</div>

**The single most common error** is reading the August 26 order as a *deadline* or a *decision point*. It is neither. Its own DATES line reads:

<div class="k7-quote">
"This temporary order is effective [INSERT DATE OF PUBLICATION IN THE FEDERAL REGISTER], <strong>until August 26, 2028</strong>."
<span class="k7-src">— FR Doc. 2026-17429, DATES</span>
</div>

August 26 is the **start**. Two years, extendable by one more if permanent scheduling proceedings are pending.

---

## 2. Timeline — how we got here

<div class="k7-fig">
<span class="k7-scrollhint">← scroll for the full chart →</span>
<div class="k7-scroll">
<svg viewBox="0 0 760 240" role="img" aria-label="Timeline of the DEA kratom scheduling actions from December 2025 through August 2028">
  <line x1="40" y1="120" x2="720" y2="120" stroke="#3f3f46" stroke-width="2"/>

  <g fill="#6ee7b7"><circle cx="60" cy="120" r="6"/></g>
  <text x="60" y="103" fill="#a1a1aa" font-size="11" text-anchor="middle">Dec 15 '25</text>
  <text x="60" y="146" fill="#71717a" font-size="10" text-anchor="middle">DEA→HHS</text>
  <text x="60" y="158" fill="#71717a" font-size="10" text-anchor="middle">MP/MGM</text>

  <g fill="#6ee7b7"><circle cx="170" cy="120" r="6"/></g>
  <text x="170" y="103" fill="#a1a1aa" font-size="11" text-anchor="middle">Feb 24 '26</text>
  <text x="170" y="146" fill="#71717a" font-size="10" text-anchor="middle">DEA→HHS</text>
  <text x="170" y="158" fill="#71717a" font-size="10" text-anchor="middle">7-OH</text>

  <g fill="#34d399"><circle cx="290" cy="120" r="6"/></g>
  <text x="290" y="103" fill="#a1a1aa" font-size="11" text-anchor="middle">Jul 6 '26</text>
  <text x="290" y="146" fill="#71717a" font-size="10" text-anchor="middle">Both notices</text>
  <text x="290" y="158" fill="#71717a" font-size="10" text-anchor="middle">published</text>

  <g fill="#fbbf24"><circle cx="410" cy="120" r="6"/></g>
  <text x="410" y="103" fill="#fcd34d" font-size="11" text-anchor="middle">Jul 31 '26</text>
  <text x="410" y="146" fill="#71717a" font-size="10" text-anchor="middle">32,145</text>
  <text x="410" y="158" fill="#71717a" font-size="10" text-anchor="middle">comments close</text>

  <g fill="#71717a"><circle cx="510" cy="120" r="5"/></g>
  <text x="510" y="103" fill="#71717a" font-size="11" text-anchor="middle">Aug 5 '26</text>
  <text x="510" y="146" fill="#71717a" font-size="10" text-anchor="middle">earliest</text>
  <text x="510" y="158" fill="#71717a" font-size="10" text-anchor="middle">order date</text>

  <g fill="#f87171"><circle cx="620" cy="120" r="7"/></g>
  <text x="620" y="103" fill="#fca5a5" font-size="11" font-weight="bold" text-anchor="middle">Aug 26 '26</text>
  <text x="620" y="146" fill="#fca5a5" font-size="10" text-anchor="middle">MP/MGM-15/16</text>
  <text x="620" y="158" fill="#fca5a5" font-size="10" text-anchor="middle">SCHEDULE I</text>

  <g fill="#fbbf24"><circle cx="672" cy="120" r="6"/></g>
  <text x="672" y="85" fill="#fcd34d" font-size="11" font-weight="bold" text-anchor="middle">Sep 10 '26</text>
  <text x="672" y="146" fill="#fcd34d" font-size="10" text-anchor="middle">comments</text>
  <text x="672" y="158" fill="#fcd34d" font-size="10" text-anchor="middle">close</text>

  <g fill="#52525b"><circle cx="722" cy="120" r="5"/></g>
  <text x="722" y="103" fill="#71717a" font-size="11" text-anchor="middle">Aug 26 '28</text>
  <text x="722" y="146" fill="#71717a" font-size="10" text-anchor="middle">expires</text>

  <rect x="400" y="182" width="330" height="46" rx="4" fill="rgba(251,191,36,.12)" stroke="#d97706" stroke-width="1"/>
  <text x="565" y="198" fill="#fbbf24" font-size="10.5" font-weight="bold" text-anchor="middle">Aug 25: HHS REOPENED the comment period → Sep 10</text>
  <text x="565" y="211" fill="#a16207" font-size="10" text-anchor="middle">The 7-OH order is still not issued — 20 days past</text>
  <text x="565" y="223" fill="#a16207" font-size="10" text-anchor="middle">DEA's own earliest date. This window is the live shot.</text>
  <line x1="510" y1="128" x2="520" y2="182" stroke="#d97706" stroke-width="1" stroke-dasharray="3 3"/>
</svg>
</div>
<p class="k7-cap"><strong>Note the ordering.</strong> DEA notified HHS about pseudoindoxyl and the MGMs on <strong>December 15, 2025</strong> — more than two months before the 7-OH letter of February 24, 2026. The pseudoindoxyl file was always ahead. This is not a pivot away from 7-OH after public comment; it is the older case finishing first.</p>
</div>

---

## 3. Why they were two separate actions

This is the question we get most: *"Why didn't DEA just do this all at once in July?"*

They effectively did — two notices, signed the same day, published the same day. But they had to be **two** actions rather than one, and the reason is a piece of regulatory plumbing almost nobody reads: the CFR's definition of the word *isomer*.

<div class="k7-quote">
"Isomer means: (1) The <strong>optical isomer</strong>, except as used in § 1308.11(d) and § 1308.12(b)(4) of this chapter."
<span class="k7-src">— 21 CFR 1300.01</span>
</div>

All four substances are being placed in **§ 1308.11(h)** — not (d). So when the orders say "including its isomers, esters, ethers, salts," the word *isomer* means **optical isomers only**.

That has three consequences, and they matter enormously:

<div class="k7-fig">
<span class="k7-scrollhint">← scroll for the full chart →</span>
<div class="k7-scroll">
<svg viewBox="0 0 760 250" role="img" aria-label="Diagram showing that mitragynine is chemically distinct while 7-OH and pseudoindoxyl are structural but not optical isomers">
  <rect x="20" y="30" width="215" height="105" rx="6" fill="rgba(16,185,129,.10)" stroke="#059669" stroke-width="1.5"/>
  <text x="127" y="55" fill="#6ee7b7" font-size="13" font-weight="bold" text-anchor="middle">Mitragynine</text>
  <text x="127" y="76" fill="#a1a1aa" font-size="12" text-anchor="middle">C₂₃H₃₀N₂O₄</text>
  <text x="127" y="98" fill="#71717a" font-size="10.5" text-anchor="middle">Different molecular formula</text>
  <text x="127" y="113" fill="#71717a" font-size="10.5" text-anchor="middle">from every listed substance.</text>
  <text x="127" y="128" fill="#34d399" font-size="11" font-weight="bold" text-anchor="middle">Cannot be reached.</text>

  <rect x="270" y="30" width="215" height="105" rx="6" fill="rgba(251,191,36,.10)" stroke="#d97706" stroke-width="1.5"/>
  <text x="377" y="55" fill="#fcd34d" font-size="13" font-weight="bold" text-anchor="middle">7-OH</text>
  <text x="377" y="76" fill="#a1a1aa" font-size="12" text-anchor="middle">C₂₃H₃₀N₂O₅</text>
  <text x="377" y="98" fill="#71717a" font-size="10.5" text-anchor="middle">Pending, threshold-limited.</text>
  <text x="377" y="113" fill="#71717a" font-size="10.5" text-anchor="middle">Not yet in effect.</text>

  <rect x="520" y="30" width="215" height="105" rx="6" fill="rgba(220,38,38,.10)" stroke="#dc2626" stroke-width="1.5"/>
  <text x="627" y="55" fill="#fca5a5" font-size="13" font-weight="bold" text-anchor="middle">Pseudoindoxyl</text>
  <text x="627" y="76" fill="#a1a1aa" font-size="12" text-anchor="middle">C₂₃H₃₀N₂O₅</text>
  <text x="627" y="98" fill="#71717a" font-size="10.5" text-anchor="middle">Schedule I Aug 26.</text>
  <text x="627" y="113" fill="#fca5a5" font-size="11" font-weight="bold" text-anchor="middle">No threshold at all.</text>

  <path d="M 485 82 L 520 82" stroke="#71717a" stroke-width="1.5" stroke-dasharray="4 3"/>
  <path d="M 520 82 L 485 82" stroke="#71717a" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="502" y="72" fill="#71717a" font-size="9" text-anchor="middle">same</text>
  <text x="502" y="96" fill="#71717a" font-size="9" text-anchor="middle">formula</text>

  <rect x="150" y="165" width="470" height="62" rx="6" fill="rgba(24,24,27,.6)" stroke="#3f3f46" stroke-width="1"/>
  <text x="385" y="188" fill="#e4e4e7" font-size="11.5" font-weight="bold" text-anchor="middle">7-OH and pseudoindoxyl share a formula — but as CONSTITUTIONAL isomers,</text>
  <text x="385" y="205" fill="#e4e4e7" font-size="11.5" font-weight="bold" text-anchor="middle">not OPTICAL ones. Under § 1308.11(h), neither listing captures the other.</text>
  <text x="385" y="220" fill="#71717a" font-size="10.5" text-anchor="middle">That is precisely why DEA needed two separate scheduling actions.</text>
</svg>
</div>
<p class="k7-cap"><strong>The takeaway:</strong> the "isomers, esters, ethers, salts" phrase is not a trapdoor for kratom leaf. It is narrow boilerplate. If it were as broad as feared, DEA would not have needed a second document — it could have listed 7-OH once and swept in pseudoindoxyl for free. It could not, and it did not.</p>
</div>

There is a second, quieter tell that the 7-OH file is still live rather than abandoned. The July 7-OH notice claimed paragraph **(h)(91)** for itself. The August 26 order just took **(h)(89) through (h)(91)**. When the 7-OH order eventually issues, it will have to be renumbered to **(h)(92)** — and DEA's internal control number **9675** still sits reserved for it, immediately after 9672/9673/9674 for the other three. The queue moved; it did not empty.

---

## 4. What the public comments could and could not do

There were **32,145 comments**. They did not go to DEA. Temporary scheduling under 21 U.S.C. 811(h) requires no notice-and-comment at all, and the DEA docket recorded zero. HHS opened a separate one — and drew the boundary explicitly:

<div class="k7-quote">
"OASH is <strong>not</strong> soliciting comment on any permanent scheduling decision, the general safety or utility of kratom-derived products, or other policy questions outside the scope of the threshold determination."
<span class="k7-src">— HHS OASH, 91 FR 41049</span>
</div>

Two questions were asked, and only two: is 0.050% the right number, and are there better ways to express the measurement.

So the widespread hope that comments might **stop** the 7-OH action was structurally impossible — that was never on the table. But the hope that they might **change the number** is entirely live, and 32,145 comments is the best available explanation for why the order has slipped past the date DEA set for itself. Precedent supports the optimism: in 2016 DEA issued a notice of intent to schedule mitragynine *and* 7-OH, and **withdrew it** after public comment.

### And on August 25, that hope got concrete

HHS did not issue the order. It filed an **extension of the comment period** instead:

<div class="k7-quote">
"OASH has received a request for an extension of the comment period on this RFI to allow any interested persons additional time to provide comments. OASH has considered the request and is granting the extension."
<span class="k7-src">— FR Doc. 2026-17409, filed August 25, 2026</span>
</div>

Read what that actually signals. An agency about to sign an order does not reopen comment on the number that order turns on. The threshold is **still being worked**, and the same docket number (**HHS-OASH-2026-0232**) means this is a continuation — every July comment still counts, and new ones join the same record the Secretary forwards to the Attorney General.

The scope limit is unchanged and worth repeating, because comments outside it get discarded: **the number, and how it is expressed. Nothing else.** A comment arguing that kratom is safe, or that DEA lacks authority, is off-scope and wasted. A comment supplying assay data on natural 7-OH ranges, or explaining why a per-article milligram cap captures ordinary leaf, is exactly what was asked for.

---

## 5. Gap one — the zero-threshold problem

Here is where the real exposure lives, and it is in the order everyone waved through as the uncontroversial one.

<div class="k7-fig">
<span class="k7-scrollhint">← scroll for the full chart →</span>
<div class="k7-scroll">
<svg viewBox="0 0 760 200" role="img" aria-label="Comparison showing 7-OH has a concentration threshold while pseudoindoxyl and the MGMs have none">
  <text x="20" y="24" fill="#a1a1aa" font-size="12" font-weight="bold">7-OH (pending order)</text>
  <rect x="20" y="34" width="720" height="34" rx="4" fill="rgba(24,24,27,.6)" stroke="#3f3f46"/>
  <rect x="20" y="34" width="252" height="34" rx="4" fill="rgba(16,185,129,.22)"/>
  <text x="146" y="56" fill="#6ee7b7" font-size="11.5" font-weight="bold" text-anchor="middle">LAWFUL below 0.050%</text>
  <rect x="272" y="34" width="468" height="34" fill="rgba(220,38,38,.20)"/>
  <text x="506" y="56" fill="#fca5a5" font-size="11.5" font-weight="bold" text-anchor="middle">Schedule I above the threshold</text>
  <line x1="272" y1="28" x2="272" y2="74" stroke="#fafafa" stroke-width="2"/>
  <text x="272" y="88" fill="#e4e4e7" font-size="10" text-anchor="middle">0.050% / 1.00 mg</text>

  <text x="20" y="128" fill="#a1a1aa" font-size="12" font-weight="bold">Pseudoindoxyl · MGM-15 · MGM-16 (effective Aug 26)</text>
  <rect x="20" y="138" width="720" height="34" rx="4" fill="rgba(220,38,38,.20)" stroke="#dc2626"/>
  <text x="380" y="160" fill="#fca5a5" font-size="12" font-weight="bold" text-anchor="middle">Schedule I at ANY detectable amount — no floor, no de minimis</text>
  <line x1="20" y1="132" x2="20" y2="178" stroke="#fafafa" stroke-width="2"/>
  <text x="34" y="192" fill="#e4e4e7" font-size="10" text-anchor="start">zero</text>
</svg>
</div>
<p class="k7-cap"><strong>Source:</strong> Congressional Research Service, LSB11457 — "The temporary scheduling of MP, MGM-15, and MGM-16 will <strong>not</strong> be limited to substances containing threshold amounts of the compounds."</p>
</div>

That zero-tolerance design would be unremarkable if these three were purely laboratory creations. DEA's order asserts exactly that:

<div class="k7-quote">
"Unlike the indole alkaloids mitragynine and 7-hydroxymitragynine, which are naturally occurring in the plant, mitragynine pseudoindoxyl, MGM-15, and MGM-16 are produced through synthetic modifications of purified mitragynine isolates or 7-hydroxymitragynine."
<span class="k7-src">— FR Doc. 2026-17429, Factor 4</span>
</div>

But the forensic laboratory **DEA cites in that same order** published something different five months earlier:

<div class="k7-quote">
"Mitragynine is metabolized to 7-hydroxy mitragynine and further to mitragynine pseudoindoxyl; however, the in vivo presence of these alkaloids is often unclear as <strong>both can arise from Kratom itself</strong>."
<span class="k7-src">— Krotulski, Denn, Brower, Papsun &amp; Logan, CFSRE / NPS Discovery, March 2025 (NIJ-funded)</span>
</div>

The chemistry behind that is not controversial. Fresh kratom leaves contain **no measurable 7-OH** — it forms during post-harvest drying and processing, and increases under oxidative conditions. Pseudoindoxyl is the next rearrangement step down that same oxidative path. Heavily oxidized material is the plausible case, which is why the concern is usually voiced about red-vein products.

### The analytical blind spot that makes it worse

<div class="k7-quote">
"7-Hydroxy mitragynine and mitragynine pseudoindoxyl were <strong>indistinguishable by GC-MS</strong>; therefore, analysis via LC-QTOF-MS was required for identification and differentiation."
<span class="k7-src">— CFSRE / NPS Discovery, March 2025</span>
</div>

Both compounds share the formula C₂₃H₃₀N₂O₅ and a molecular weight of 414.5. CFSRE had to publish a **dedicated chromatographic separation method** to tell them apart. GC-MS is the workhorse instrument of most state and county crime labs.

Stack the three findings and the actual risk comes into focus:

<div class="callout callout-emerald">
<strong>The real exposure</strong>
A laboratory running standard GC-MS on ordinary kratom leaf could report <em>"mitragynine pseudoindoxyl"</em> — a zero-tolerance Schedule I substance as of August 26 — when what is actually present is trace 7-OH that is expressly <em>lawful</em> under the 0.050% carve-out. That is not a theory about DEA's motives. It is a drafting gap plus an instrument limitation, and it is fixable.
</div>

---

## 6. Gap two — the "1.00 milligram in the article" prong

The 7-OH threshold has two prongs. Prong (A), for raw botanical material, is a pure **concentration** test. Prong (B) adds something else entirely.

<span class="k7-scrollhint">← scroll for the full table →</span>
<div class="k7-scroll">
<table class="k7-t">
<tr><th>Prong</th><th>Applies to</th><th>Test</th></tr>
<tr><td><strong>(A)</strong></td><td>Any botanical material of <em>Mitragyna speciosa</em></td><td>More than <strong>0.050%</strong> 7-OH on a dry weight basis</td></tr>
<tr><td><strong>(B)(i)</strong></td><td>Articles resulting from synthetic methods</td><td>&gt;0.050% w/w, w/v, v/v <strong>OR &gt; 1.00 mg</strong> in the article</td></tr>
<tr><td><strong>(B)(ii)</strong></td><td>Material "further processed to manufacture alternative dosage forms such as extracts, concentrates, processed edibles, or pressed pills"</td><td>&gt;0.050% w/w, w/v, v/v <strong>OR &gt; 1.00 mg</strong> in the article</td></tr>
</table>
</div>

Ordinary dried leaf runs roughly **0.011–0.039% w/w** (0.114–0.393 mg/g) — comfortably under the concentration limit, though the top of the natural range already sits at about **78% of the ceiling**, and 7-OH climbs with oxidation and age.

Now apply the absolute test instead:

<div class="k7-fig">
<span class="k7-scrollhint">← scroll for the full chart →</span>
<div class="k7-scroll">
<svg viewBox="0 0 760 210" role="img" aria-label="Chart showing how few grams of ordinary kratom leaf contain 1 milligram of 7-OH">
  <text x="20" y="20" fill="#a1a1aa" font-size="11.5" font-weight="bold">Grams of ordinary dried leaf needed to reach 1.00 mg of 7-OH</text>

  <text x="20" y="52" fill="#a1a1aa" font-size="11">Low end (0.114 mg/g)</text>
  <rect x="185" y="40" width="440" height="18" rx="2" fill="rgba(255,255,255,.06)"/>
  <rect x="185" y="40" width="352" height="18" rx="2" fill="#6ee7b7"/>
  <text x="640" y="54" fill="#fafafa" font-size="11" font-weight="bold">8.8 g</text>

  <text x="20" y="84" fill="#a1a1aa" font-size="11">High end (0.393 mg/g)</text>
  <rect x="185" y="72" width="440" height="18" rx="2" fill="rgba(255,255,255,.06)"/>
  <rect x="185" y="72" width="102" height="18" rx="2" fill="#34d399"/>
  <text x="640" y="86" fill="#fafafa" font-size="11" font-weight="bold">2.5 g</text>

  <text x="20" y="112" fill="#71717a" font-size="10.5">For scale: a common single serving is 2–5 g.</text>

  <line x1="20" y1="128" x2="740" y2="128" stroke="#27272a" stroke-width="1"/>

  <text x="20" y="150" fill="#a1a1aa" font-size="11.5" font-weight="bold">7-OH contained in a retail bag of PLAIN LEAF POWDER</text>

  <text x="20" y="176" fill="#a1a1aa" font-size="11">50 g bag</text>
  <rect x="185" y="164" width="440" height="16" rx="2" fill="rgba(255,255,255,.06)"/>
  <rect x="185" y="164" width="44" height="16" rx="2" fill="#fbbf24"/>
  <text x="640" y="177" fill="#fcd34d" font-size="11" font-weight="bold">5.7–19.7 mg</text>

  <text x="20" y="200" fill="#a1a1aa" font-size="11">500 g bag</text>
  <rect x="185" y="188" width="440" height="16" rx="2" fill="rgba(255,255,255,.06)"/>
  <rect x="185" y="188" width="440" height="16" rx="2" fill="#f87171"/>
  <text x="640" y="201" fill="#fca5a5" font-size="11" font-weight="bold">57–197 mg</text>
</svg>
</div>
<p class="k7-cap"><strong>The arithmetic:</strong> 1.00 mg of 7-OH is roughly 2.5 to 8.8 grams of ordinary dried leaf — one to two servings. A retail bag holds 5 to 200 times the trigger amount, while passing the concentration test by a wide margin.</p>
</div>

Whether that matters turns on two undefined words:

- **"Article."** Is it a serving? A capsule? A container? A shipment? The notice never says.
- **"Alternative dosage forms such as..."** The list is illustrative, not exhaustive. **Capsules are not named.** Encapsulated plain leaf powder is a genuinely open question.

There is also a drafting slip worth flagging: prong (B)(ii) reads "and which **may have** materials that have been exposed to chemical, thermal, or other methods leading to chemical transformations." *May have* is permissive — on a literal reading, actual chemical transformation is **not required** for (B)(ii) to apply.

This is precisely what HHS's second question was about: *"whether data exist supporting alternative measurement expressions for purposes of specifying the threshold level."* It is unresolved. **The order has not issued. This one is still fixable.**

---

## 7. Myth versus record

<table class="decode">
<tr><th>What is circulating</th><th>What the documents say</th></tr>
<tr><td>"They're banning all kratom through the isomer language."</td><td><strong>No.</strong> 21 CFR 1300.01 limits "isomer" to <em>optical</em> isomers outside § 1308.11(d). Mitragynine has a different molecular formula entirely and cannot be reached. This is why two separate actions were needed.</td></tr>
<tr><td>"The temp scheduling is in effect now and ends August 26."</td><td><strong>Reversed.</strong> It <em>begins</em> August 26, 2026 and runs to August 26, 2028.</td></tr>
<tr><td>"The 7-OH ban already happened."</td><td><strong>No order was ever issued.</strong> Only the July 6 notice of intent exists on Docket DEA-1570.</td></tr>
<tr><td>"7-OH scheduling expired, so they gave up on it."</td><td><strong>A notice of intent does not expire.</strong> DEA can issue the order any morning. Control number 9675 remains reserved for it.</td></tr>
<tr><td>"Enough comments stopped the 7-OH ban, so they pivoted to pseudoindoxyl."</td><td><strong>Half right, and the half that's wrong matters.</strong> The sequencing rules out a pivot: DEA notified HHS about pseudoindoxyl on Dec 15, 2025 — two months <em>before</em> the 7-OH letter — and that file had no comment docket to stall it. But comments plainly <em>are</em> affecting the 7-OH track: HHS reopened the window on Aug 25 rather than issue the order. Delayed and still being worked, not stopped.</td></tr>
<tr><td>"Natural leaf is covered because it contains 7-OH."</td><td><strong>The threshold is designed to exclude it.</strong> DEA's own notice: 7-OH "makes up less than two percent of the total alkaloid content or occurs in trace amount." FDA Commissioner Makary: "we're not targeting the kratom leaf or ground up kratom."</td></tr>
<tr><td>"We can sue to stop this."</td><td><strong>Not this action.</strong> 21 U.S.C. 811(h)(6) — temporary scheduling orders are not subject to judicial review. The order says so itself.</td></tr>
<tr><td>"Pseudoindoxyl is purely synthetic, so plain leaf is safe."</td><td><strong>Contested by DEA's own cited lab.</strong> CFSRE: pseudoindoxyl and 7-OH "both can arise from Kratom itself." With no threshold on pseudoindoxyl, this is the gap that deserves the pressure.</td></tr>
</table>

---

## 8. The pharmacology, briefly

These three are not being scheduled arbitrarily. The receptor-binding data is stark, and honest advocacy has to hold both facts at once — the leaf is not the concentrate.

<div class="k7-fig">
<span class="k7-scrollhint">← scroll for the full chart →</span>
<div class="k7-scroll">
<svg viewBox="0 0 760 165" role="img" aria-label="Mu-opioid receptor binding affinity comparison on a logarithmic scale">
  <text x="20" y="20" fill="#a1a1aa" font-size="11.5" font-weight="bold">Mu-opioid receptor binding affinity — Ki in nM (lower = more potent, log scale)</text>

  <text x="20" y="52" fill="#a1a1aa" font-size="11">Pseudoindoxyl</text>
  <rect x="175" y="40" width="470" height="18" rx="2" fill="rgba(255,255,255,.06)"/>
  <rect x="175" y="40" width="59" height="18" rx="2" fill="#f87171"/>
  <text x="660" y="54" fill="#fca5a5" font-size="11" font-weight="bold">1.5 nM</text>

  <text x="20" y="84" fill="#a1a1aa" font-size="11">7-OH</text>
  <rect x="175" y="72" width="470" height="18" rx="2" fill="rgba(255,255,255,.06)"/>
  <rect x="175" y="72" width="290" height="18" rx="2" fill="#fbbf24"/>
  <text x="660" y="86" fill="#fcd34d" font-size="11" font-weight="bold">78 nM</text>

  <text x="20" y="116" fill="#a1a1aa" font-size="11">Mitragynine</text>
  <rect x="175" y="104" width="470" height="18" rx="2" fill="rgba(255,255,255,.06)"/>
  <rect x="175" y="104" width="400" height="18" rx="2" fill="#6ee7b7"/>
  <text x="660" y="118" fill="#6ee7b7" font-size="11" font-weight="bold">709 nM</text>

  <text x="20" y="148" fill="#71717a" font-size="10">Pseudoindoxyl binds roughly 52× more tightly than 7-OH, and about 470× more tightly than mitragynine.</text>
</svg>
</div>
<p class="k7-cap"><strong>Source:</strong> CFSRE NPS Discovery monograph, November 2025 (Váradi et al. 2016; Matsumoto et al. 2014). NIDA separately notes that kratom leaves and mitragynine have not been found to cause the respiratory depression associated with life-threatening opioid overdose, while 7-OH has.</p>
</div>

DEA also documents the market pattern: the first confirmed pseudoindoxyl consumer product appeared in **2024**, MGM-15 in **September 2025**. In one study of 51 products sold online as pseudoindoxyl, **39 were chewable tablets**, 35 carried candy-style flavors, and 32 used bright packaging. MGM-16 has **no confirmed consumer presence at all** — DEA scheduled it preemptively after finding a vendor site listing it for future sale, reasoning that scheduling MGM-15 alone "would create a regulatory loophole that manufacturers are already poised to exploit."

---

## 9. What this means for you, practically

<div class="action"><div class="check">✓</div><div><strong>Everyone — comment before September 10.</strong> This is the only open federal comment window on kratom, and it is the one lever that is demonstrably working: the extension exists <em>because people asked for it</em>. Go to regulations.gov, docket <strong>HHS-OASH-2026-0232</strong>. Keep it inside the scope — the threshold number and how it is measured — and lead with data, not sentiment. The single most useful thing an ordinary advocate can submit is a lab certificate showing measured 7-OH in a plain-leaf product they actually bought.</div></div>

<div class="action"><div class="check">✓</div><div><strong>If you consume plain leaf.</strong> Nothing about your product becomes a controlled substance on August 26. Mitragynine is not scheduled. Leaf is not scheduled. The gap described in section 5 is a testing-and-drafting risk worth pressing on, not a reason to panic.</div></div>

<div class="action"><div class="check">✓</div><div><strong>If you own a shop.</strong> Anything containing pseudoindoxyl, MGM-15, or MGM-16 must be off your shelves by August 26. Retail sale of Schedule I substances is prohibited outright, and the order requires surrender of stock by anyone not holding a Schedule I registration. Products marketed as "7-OH" frequently contain pseudoindoxyl as well — CFSRE found detectable pseudoindoxyl in <em>all</em> products it tested in that category. Concentrated 7-OH itself is not yet federally scheduled, but that can change with no advance warning beyond the notice already published.</div></div>

<div class="action"><div class="check">✓</div><div><strong>If you are a vendor or manufacturer.</strong> Ask your lab which instrument it uses. If the answer is GC-MS alone, it cannot distinguish 7-OH from pseudoindoxyl. Insist on LC-QTOF-MS or an equivalent chromatographically-resolved method, and keep the certificates.</div></div>

<div class="action"><div class="check">✓</div><div><strong>If you talk to legislators or press.</strong> Do not say "they are banning all kratom." It is not supported by these documents, and it costs the community credibility with the staffers who actually read them. The narrow, sourced version is far harder to dismiss.</div></div>

<div class="missing">
<strong>The four asks that actually follow from the record:</strong>
<ul>
<li>A <strong>trace / naturally-occurring carve-out for pseudoindoxyl</strong>, matching the one 7-OH already has. There is no principled reason 7-OH gets a floor and its own rearrangement product gets none.</li>
<li>A requirement that enforcement testing use <strong>chromatographically-resolved methods</strong> capable of separating 7-OH from pseudoindoxyl. GC-MS alone cannot do it, and a federal lab has said so in print.</li>
<li>A <strong>definition of "article"</strong> and a fix to the <strong>1.00 mg prong</strong> before the 7-OH order issues — including whether encapsulated plain leaf falls under "alternative dosage forms."</li>
<li>Because temporary scheduling is unreviewable, direct these at the <strong>permanent scheduling proceeding</strong> — which does hold formal hearings and <em>is</em> subject to judicial review — and at <strong>Congress</strong>. H.R. 8000 already carries an express carve-out for "7-OH naturally contained in kratom"; that model should extend to pseudoindoxyl.</li>
</ul>
</div>

---

## 10. Where this could still go

<div class="takeaway">
<span class="badge badge-amber">Watch</span>

### The 7-OH order can still issue any day
DEA gave itself "on or after August 5, 2026" and has not acted. There is no statutory expiry on a notice of intent, and the comment extension does **not** legally bar DEA from issuing the order before September 10 — it only makes doing so politically awkward while its own department is still collecting input on the number. When it lands it will be effective **on publication**, with no grace period. Watch the Federal Register public inspection list, not press releases.
</div>

<div class="takeaway">
<span class="badge badge-amber">Watch</span>

### Permanent scheduling is the real fight
Temporary scheduling buys DEA two years. Permanent scheduling under 21 U.S.C. 811(a) requires formal rulemaking "on the record after opportunity for a hearing" — and unlike this order, the outcome **is** judicially reviewable. CRS notes that with four substances rather than thousands, DEA may well be able to complete the fact-finding. That is where evidence and testimony will actually count.
</div>

<div class="takeaway">
<span class="badge badge-emerald">Leverage</span>

### State law is not preempted
DEA states plainly that this action "does not preempt more restrictive state law." Mississippi, for example, has set its own limit at one percent of total alkaloid content or 0.5 mg per container. State-level Kratom Consumer Protection Acts remain the most responsive lever available to most advocates.
</div>

---

## Sources

Everything above traces to a public document. We encourage you to verify rather than take our word for it.

<div class="footer"><strong>Primary — Federal Register</strong></div>

- [FR Doc. 2026-17429](https://www.federalregister.gov/public-inspection/2026-17429/schedules-of-controlled-substances-temporary-placement-of-mitragynine-pseudoindoxyl-mgm-15-and) — Temporary scheduling **order**, MP/MGM-15/MGM-16. Signed Aug 24, 2026; effective Aug 26, 2026 – Aug 26, 2028. Docket DEA-1644.
- [FR Doc. 2026-13580](https://www.federalregister.gov/documents/2026/07/06/2026-13580/schedules-of-controlled-substance-temporary-placement-of-7-hydroxymitragynine-above-a-specified) — 7-OH notice of intent, **91 FR 40917**. Docket DEA-1570. Contains the full threshold wording.
- [FR Doc. 2026-13581](https://www.federalregister.gov/documents/2026/07/06/2026-13581/schedules-of-controlled-substances-temporary-placement-of-mitragynine-pseudoindoxyl-mgm-15-and) — MP/MGM notice of intent, **91 FR 40909**.
- [FR Doc. 2026-13608](https://www.federalregister.gov/documents/2026/07/06/2026-13608/temporary-placement-of-7-hydroxymitragynine-above-a-specified-threshold-in-schedule-i-request-for) — HHS OASH request for information, **91 FR 41049**. 32,145 comments, closed Jul 31, 2026.
- [FR Doc. 2026-17409](https://www.federalregister.gov/public-inspection/2026-17409/temporary-placement-of-7-hydroxymitragynine-above-a-specified-threshold-in-schedule-i-extension-of) — **Extension of comment period.** Filed Aug 25, publishes Aug 26, 2026. Reopens Docket HHS-OASH-2026-0232 **through September 10, 2026**.
- [Comment here — Docket HHS-OASH-2026-0232](https://www.regulations.gov/docket/HHS-OASH-2026-0232) — the live docket on regulations.gov.
- [FR Doc. 2016-24659](https://www.federalregister.gov/documents/2016/10/13/2016-24659/withdrawal-of-notice-of-intent-to-temporarily-place-mitragynine-and-7-hydroxymitragynine-into) — DEA's 2016 **withdrawal** of its earlier kratom notice after public comment.

<div class="footer"><strong>Legal</strong></div>

- [21 CFR 1300.01](https://www.ecfr.gov/current/title-21/chapter-II/part-1300/section-1300.01) — definition of "isomer."
- 21 U.S.C. 811(h) — temporary scheduling authority; **811(h)(6)** bars judicial review.
- [CRS Legal Sidebar LSB11457](https://www.congress.gov/crs-product/LSB11457) — Joanna Lampe, July 17, 2026. Nonpartisan analysis for Congress.

<div class="footer"><strong>Forensic &amp; scientific</strong></div>

- [CFSRE / NPS Discovery — smoke shop product evaluation](https://www.cfsre.org/images/content/reports/public_alerts/7-Hydroxy_Mitragynine_NPS_Discovery_033125.pdf) — Krotulski, Denn, Brower, Papsun &amp; Logan, March 2025. GC-MS indistinguishability; "both can arise from Kratom itself."
- [CFSRE / NPS Discovery — mitragynine pseudoindoxyl monograph](https://www.cfsre.org/images/monographs/Mitragynine-Pseudoindoxyl-New-Drug-Monograph-NPS-Discovery.pdf) — November 2025. Formula, mass, receptor binding data.
- [From kratom to 7-hydroxymitragynine (PMC12671409)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12671409/) — natural 7-OH concentration ranges; fresh-leaf absence; oxidative formation.

<div class="footer"><strong>Agency &amp; legislative</strong></div>

- [DEA press release, July 1, 2026](https://www.dea.gov/press-releases/2026/07/01/dea-temporarily-schedule-7-oh-and-related-substances-protect-public)
- [FDA — Hiding in Plain Sight: 7-OH Products](https://www.fda.gov/news-events/public-health-focus/hiding-plain-sight-7-oh-products)
- H.R. 8000 — END 7-OH Act, 119th Congress. Carries an express carve-out for "7-OH naturally contained in kratom."

<hr/>

<p class="footer"><strong>About this packet.</strong> Prepared by the iKratom Policy Desk on August 25, 2026, from primary documents only. iKratom is independent of every kratom organization — AKA, GKC, BAE, MAC — and takes no position for or against any of them. We publish what the record says, including where it cuts against the community's preferred narrative. Corrections are welcome and will be logged.</p>

<p class="footer"><em>This is a plain-language summary of public documents. It is not legal advice. Legal status varies by state and locality, and the federal picture described here can change without notice.</em></p>
