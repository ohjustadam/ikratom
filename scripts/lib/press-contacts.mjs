// Finding the address a reporter or researcher printed themselves. Kept apart
// from the network so the rules can be tested. A miss costs one reply, and a
// wrong hit sends a member's letter to a stranger, so these rules are strict.

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

// Desks and shared inboxes, and the placeholder CBS prints in its own copy.
const SHARED_INBOX =
  /^(opinions?|letters?|editors?|editorial|news|newsroom|newsdesk|tips?|newstips?|info|contact|contactus|support|help|hello|community|subscribe|subscriptions?|circulation|customerservice|advertising|ads|sales|press|media|webmaster|admin|feedback|corrections?|yourreporter|reporter|staff|desk|metro|business|sports|obits?|no-?reply|privacy|legal|jobs|careers|membership)([._-]|\d|$)/i;

// A .gov address in a story belongs to someone quoted in it, not the writer.
const NOT_A_WRITER_DOMAIN = /\.(gov|mil)$/i;

const compact = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function hostRoot(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2).join(".");
  } catch {
    return "";
  }
}

function sameOutlet(domain, url, sourceName) {
  const root = domain.split(".").slice(-2).join(".");
  if (root === hostRoot(url)) return true;
  const label = compact(root.split(".")[0]);
  return label.length >= 4 && compact(sourceName).includes(label);
}

function surname(name) {
  const words = String(name ?? "").trim().split(/\s+/);
  return words.length >= 2 ? compact(words[words.length - 1]) : "";
}

const isPerson = (name) => /^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]*){1,3}$/u.test(String(name ?? "").trim());

/** The byline, from the JSON-LD or meta tags publishers fill in for search engines. */
export function bylineFrom(html) {
  const text = String(html ?? "");
  for (const m of text.matchAll(/"author"\s*:\s*(?:\[\s*)?\{[^{}]*?"name"\s*:\s*"([^"]{3,60})"/g)) {
    if (isPerson(m[1])) return m[1].trim();
  }
  const meta =
    text.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']{3,60})["']/i) ??
    text.match(/<meta[^>]+content=["']([^"']{3,60})["'][^>]+name=["']author["']/i);
  return meta && isPerson(meta[1]) ? meta[1].trim() : null;
}

const nameInLine = (line, email) => {
  const before = line.slice(0, line.toLowerCase().indexOf(email));
  const m = before.match(/\b(?:[Ee]-?mail|[Cc]ontact|[Rr]each)\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){1,2})\s+at\s*:?\s*$/u);
  return m?.[1] ?? null;
};

const nameFromAddress = (local) => {
  const parts = local.split(".");
  if (parts.length !== 2 || parts.some((p) => p.length < 2 || /\d/.test(p))) return null;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ");
};

/**
 * The story's writer, or null. An address counts when it belongs to the byline,
 * or when it's a person's address on the outlet's own domain at the end of the
 * story, where a writer signs off.
 */
export function findWriter({ html = "", paragraphs, url, sourceName }) {
  const byline = bylineFrom(html);
  const closing = (paragraphs ?? []).slice(-8);
  const mailto = [...String(html ?? "").matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => m[1]);
  const lines = [...closing, ...mailto];

  for (const line of lines) {
    for (const raw of String(line).match(EMAIL) ?? []) {
      const email = raw.toLowerCase().replace(/\.$/, "");
      const [local, domain] = email.split("@");
      if (SHARED_INBOX.test(local) || NOT_A_WRITER_DOMAIN.test(domain)) continue;
      const last = surname(byline);
      const bylineMatch = last.length >= 3 && compact(local).includes(last);
      const inClosing = closing.includes(line);
      if (!bylineMatch && !(inClosing && sameOutlet(domain, url, sourceName))) continue;
      return { email, name: byline ?? nameInLine(String(line), email) ?? nameFromAddress(local) };
    }
  }
  return null;
}

// PubMed writes "Alëna" as "Al&#xeb;na".
const decodeEntities = (text) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");

/** The first author in a PubMed record who printed an address, or null. */
export function findPaperAuthor(articleXml) {
  for (const m of String(articleXml ?? "").matchAll(/<Author\b[^>]*>([\s\S]*?)<\/Author>/g)) {
    const email = m[1].match(EMAIL)?.[0]?.toLowerCase().replace(/\.$/, "");
    if (!email || SHARED_INBOX.test(email.split("@")[0])) continue;
    const first = m[1].match(/<ForeName>([^<]+)</)?.[1];
    const last = m[1].match(/<LastName>([^<]+)</)?.[1];
    return { email, name: decodeEntities([first, last].filter(Boolean).join(" ")) || null };
  }
  return null;
}
