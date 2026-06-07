/**
 * article-content.mjs — extract a fair-use excerpt + embedded media from
 * a fetched publisher article HTML.
 *
 * Copyright posture: we do NOT store or render the full article body.
 * We keep a LEAD excerpt (first few paragraphs, capped) for in-app
 * reading + always link out to the source for the full piece — the
 * standard news-aggregator fair-use pattern. Embedded media (YouTube /
 * Vimeo players, article images) are surfaced via their own embed URLs,
 * which is how publishers intend them to be shared — not rehosted.
 *
 * Output is plain text + validated URLs only. No publisher HTML is
 * passed through, so the rendering side never needs dangerouslySetInnerHTML.
 *
 * Extraction strategy (2026-06-07): PRIMARY = Mozilla Readability (the
 * Firefox Reader-View algorithm) over a linkedom DOM — far more reliable at
 * isolating the real article body than hand-rolled regex, across the long tail
 * of publisher layouts. FALLBACK = the original regex region scan, used when
 * Readability returns nothing (rare layouts, fragment HTML). We still keep only
 * the lead paragraphs from whichever path wins, preserving the fair-use posture.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const PARAGRAPH_CAP = 6;     // lead paragraphs to keep (fair-use excerpt)
const PARA_MIN_CHARS = 40;   // drop nav-y/cruft one-liners
const MEDIA_CAP = 8;

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&lsquo;|&#8216;/g, "‘")
    .replace(/&ldquo;|&#8220;/g, "“")
    .replace(/&rdquo;|&#8221;/g, "”")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&hellip;|&#8230;/g, "…");
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

/** Reduce the HTML to the main article region (regex fallback path). */
function articleRegion(html) {
  let h = html;
  h = h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  h = h.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  h = h.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  h = h.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ");
  h = h.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ");
  h = h.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ");
  h = h.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ");
  const FP = /\b(related|recommend|more-stories|popular|sidebar|promo|outbrain|taboola|recirc|trending|read-more|you-may-like|next-up|elsewhere|teaser|widget|newsletter|subscribe|comment)\b/i;
  for (const tag of ["div", "section", "ul", "figure"]) {
    const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
    h = h.replace(re, (match, attrs) => (FP.test(attrs) ? " " : match));
  }
  const article = h.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const main = h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  return article?.[1] || main?.[1] || h;
}

function extractParagraphs(regionHtml) {
  const paras = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(regionHtml)) !== null) {
    const text = stripTags(m[1]);
    if (text.length >= PARA_MIN_CHARS) paras.push(text);
    if (paras.length >= PARAGRAPH_CAP * 3) break; // scan cap
  }
  // De-dupe consecutive repeats, keep the lead.
  const seen = new Set();
  const out = [];
  for (const p of paras) {
    const k = p.slice(0, 80).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= PARAGRAPH_CAP) break;
  }
  return out;
}

function abs(url, base) {
  try { return new URL(url, base).href; } catch { return null; }
}

const IMG_SKIP = /\b(sprite|spacer|pixel|tracking|1x1|avatar|logo|icon|favicon|ad[-_]|doubleclick|gravatar|emoji)\b/i;

function extractMedia(html, regionHtml, base) {
  const media = [];
  const push = (item) => {
    if (!item.url) return;
    if (media.some((x) => x.url === item.url || (item.embed_url && x.embed_url === item.embed_url))) return;
    media.push(item);
  };

  // YouTube — iframes or watch/short links anywhere in the doc.
  const ytRe = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
  let y;
  while ((y = ytRe.exec(html)) !== null) {
    push({ type: "youtube", video_id: y[1], embed_url: `https://www.youtube-nocookie.com/embed/${y[1]}`, url: `https://www.youtube.com/watch?v=${y[1]}` });
    if (media.length >= MEDIA_CAP) break;
  }

  // Vimeo
  const vRe = /player\.vimeo\.com\/video\/(\d+)|vimeo\.com\/(\d+)/g;
  let v;
  while ((v = vRe.exec(html)) !== null) {
    const id = v[1] || v[2];
    push({ type: "vimeo", video_id: id, embed_url: `https://player.vimeo.com/video/${id}`, url: `https://vimeo.com/${id}` });
    if (media.length >= MEDIA_CAP) break;
  }

  // Lead image from og:image (most reliable hero).
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) {
    const u = abs(og[1], base);
    if (u && /^https/.test(u)) push({ type: "image", url: u, lead: true });
  }

  // Inline article images.
  const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let im;
  while ((im = imgRe.exec(regionHtml)) !== null) {
    const raw = im[1];
    if (/^data:/.test(raw) || IMG_SKIP.test(raw) || IMG_SKIP.test(im[0])) continue;
    const u = abs(raw, base);
    if (u && /^https/.test(u)) push({ type: "image", url: u });
    if (media.length >= MEDIA_CAP) break;
  }

  return media.slice(0, MEDIA_CAP);
}

/**
 * PRIMARY path: Mozilla Readability over a linkedom DOM. Returns the lead
 * fair-use paragraphs + media derived from the CLEAN article body (so article
 * images are kept and nav/ad/related images are dropped). Returns null when
 * Readability can't find an article (caller falls back to the regex scan).
 */
function readabilityExtract(html, baseUrl) {
  try {
    const { document } = parseHTML(html);
    // Readability mutates the document; we parse a fresh one each call.
    const article = new Readability(document, { charThreshold: 200 }).parse();
    if (!article || !article.content) return null;
    const paragraphs = extractParagraphs(article.content);
    if (paragraphs.length === 0) return null;
    // og:image + video embeds come from the FULL html (often in <head> / players
    // outside the article node); inline images from the clean article body.
    const media = extractMedia(html, article.content, baseUrl);
    return { paragraphs, media };
  } catch {
    return null; // any DOM/parse error → fall back to the regex path
  }
}

/**
 * @returns {{ paragraphs: string[], media: Array<{type,url,embed_url?,video_id?,lead?}> }}
 */
export function extractArticleContent(html, baseUrl) {
  if (!html) return { paragraphs: [], media: [] };
  const primary = readabilityExtract(html, baseUrl);
  if (primary && primary.paragraphs.length > 0) return primary;
  // Fallback: original regex region scan.
  const region = articleRegion(html);
  return {
    paragraphs: extractParagraphs(region),
    media: extractMedia(html, region, baseUrl),
  };
}
