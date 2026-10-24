// Minimal MIME reader for the send-record Email Worker (B9).
//
// Dependency-free on purpose: it runs inside a Cloudflare Email Worker that is
// uploaded as plain modules (no bundler). It only needs what the record keeps:
// the readable text of a letter. Walks multipart trees, decodes
// quoted-printable and base64, honours the part's charset, and falls back to
// the HTML part with tags stripped when a client sends no text/plain.
//
// Input is a "binary string" (one char per byte, see bytesToBinary), so 8-bit
// parts in any charset survive until their own charset decodes them.

export function bytesToBinary(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return s;
}

function binaryToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function decodeBytes(bytes, charset) {
  const label = (charset || "utf-8").toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function splitHeadBody(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  if (!m) return { head: raw, body: "" };
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

export function parseHeaders(head) {
  const headers = new Map();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(i + 1).trim());
  }
  return headers;
}

function headerParam(value, param) {
  const re = new RegExp(`(?:^|;)\\s*${param}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i");
  const m = re.exec(value || "");
  return m ? (m[2] ?? m[1]) : null;
}

function decodeQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeBase64Binary(s) {
  try {
    return atob(s.replace(/[^A-Za-z0-9+/=]/g, ""));
  } catch {
    return "";
  }
}

function decodePart(body, headers) {
  const cte = (headers.get("content-transfer-encoding") || "").toLowerCase();
  const charset = headerParam(headers.get("content-type"), "charset");
  let binary = body;
  if (cte === "quoted-printable") binary = decodeQuotedPrintable(body);
  else if (cte === "base64") binary = decodeBase64Binary(body);
  return decodeBytes(binaryToBytes(binary), charset);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Depth-first; collects the first text/plain and the first text/html.
function walk(raw, found, depth) {
  if (depth > 8) return;
  const { head, body } = splitHeadBody(raw);
  const headers = parseHeaders(head);
  const ctype = (headers.get("content-type") || "text/plain").toLowerCase();
  const disposition = (headers.get("content-disposition") || "").toLowerCase();
  if (disposition.startsWith("attachment")) return;

  if (ctype.startsWith("multipart/")) {
    const boundary = headerParam(headers.get("content-type"), "boundary");
    if (!boundary) return;
    const parts = body.split(`--${boundary}`);
    // parts[0] is the preamble; the part after the closing "--boundary--" is the epilogue.
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith("--")) break;
      walk(part.replace(/^\r?\n/, ""), found, depth + 1);
    }
    return;
  }
  if (ctype.startsWith("text/plain") && found.text == null) found.text = decodePart(body, headers);
  else if (ctype.startsWith("text/html") && found.html == null) found.html = decodePart(body, headers);
}

/** { headers, text } — text is the letter as the reader sees it, trimmed. */
export function parseMessage(raw) {
  const { head } = splitHeadBody(raw);
  const found = { text: null, html: null };
  walk(raw, found, 0);
  const text = found.text != null ? found.text.replace(/\r\n/g, "\n").trim() : found.html != null ? htmlToText(found.html) : "";
  return { headers: parseHeaders(head), text };
}

/** RFC 2047 encoded-words (=?utf-8?B?...?= / =?utf-8?Q?...?=) → text. */
export function decodeWords(value) {
  if (!value) return "";
  return value
    .replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset, enc, data) => {
      const binary =
        enc.toUpperCase() === "B"
          ? decodeBase64Binary(data)
          : data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16)));
      return decodeBytes(binaryToBytes(binary), charset);
    });
}
