/**
 * Magic-byte file-signature detection. Pure functions — no IO.
 *
 * Used by /research/submit's upload flow to reject files whose
 * extension / claimed MIME doesn't match their actual contents. The
 * server action verifies these AFTER upload (authoritative) and the
 * browser also runs them BEFORE upload (UX).
 *
 * Owner directive 2026-05-15: "block any improper file formats such as
 * videos or audio, among other file type. so we should only allow
 * certain types to begin with."
 *
 * The strict-allow shape: a research-paper bucket accepts .pdf / .txt /
 * .md only. Everything else is denied — videos, audio, executables,
 * archives, images, Office docs (with macros), scripts, HTML. The
 * detectors below recognize the binary signatures so a renamed file
 * (e.g. malware.exe → malware.pdf) still gets caught.
 */

export const ALLOWED_UPLOAD_EXT = new Set(["pdf", "txt", "md", "markdown"]);
export const ALLOWED_UPLOAD_MIME = new Set(["application/pdf", "text/plain", "text/markdown"]);

/** Last-segment extension, lowercased. `file.pdf.exe` → `exe`. */
export function filenameExt(name: string): string {
  const m = /\.([a-z0-9]+)\s*$/i.exec(name.toLowerCase().trim());
  return m ? m[1] : "";
}

export function isExecutable(h: Uint8Array): boolean {
  // MZ (Windows PE)
  if (h[0] === 0x4d && h[1] === 0x5a) return true;
  // ELF (Linux)
  if (h[0] === 0x7f && h[1] === 0x45 && h[2] === 0x4c && h[3] === 0x46) return true;
  // Mach-O (macOS) — 32/64-bit + universal
  if (
    (h[0] === 0xfe && h[1] === 0xed && h[2] === 0xfa && (h[3] === 0xce || h[3] === 0xcf)) ||
    (h[0] === 0xce && h[1] === 0xfa && h[2] === 0xed && h[3] === 0xfe) ||
    (h[0] === 0xcf && h[1] === 0xfa && h[2] === 0xed && h[3] === 0xfe)
  ) return true;
  // Shell script shebang
  if (h[0] === 0x23 && h[1] === 0x21) return true;
  return false;
}

export function isArchive(h: Uint8Array): boolean {
  // PK ZIP / docx / xlsx / jar / apk
  if (h[0] === 0x50 && h[1] === 0x4b) return true;
  // 7-zip
  if (h[0] === 0x37 && h[1] === 0x7a && h[2] === 0xbc && h[3] === 0xaf) return true;
  // RAR
  if (h[0] === 0x52 && h[1] === 0x61 && h[2] === 0x72 && h[3] === 0x21) return true;
  // gzip
  if (h[0] === 0x1f && h[1] === 0x8b) return true;
  // bzip2
  if (h[0] === 0x42 && h[1] === 0x5a && h[2] === 0x68) return true;
  // XZ
  if (h[0] === 0xfd && h[1] === 0x37 && h[2] === 0x7a && h[3] === 0x58 && h[4] === 0x5a) return true;
  return false;
}

export function isMedia(h: Uint8Array): boolean {
  // RIFF (wav/avi)
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) return true;
  // ID3 (mp3 with id3 header)
  if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return true;
  // MP3 frame sync (no id3) — 11-bit sync starts FFE
  if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return true;
  // ftyp at offset 4 — mp4/m4a/mov
  if (h.length >= 8 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) return true;
  // Matroska / webm
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return true;
  // OGG
  if (h[0] === 0x4f && h[1] === 0x67 && h[2] === 0x67 && h[3] === 0x53) return true;
  // FLAC
  if (h[0] === 0x66 && h[1] === 0x4c && h[2] === 0x61 && h[3] === 0x43) return true;
  return false;
}

export function isImage(h: Uint8Array): boolean {
  // PNG
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return true;
  // JPEG
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return true;
  // GIF87a / GIF89a
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return true;
  // BMP
  if (h[0] === 0x42 && h[1] === 0x4d) return true;
  // WebP — RIFF....WEBP at offset 8
  if (h.length >= 12 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return true;
  return false;
}

export function isPdf(h: Uint8Array): boolean {
  // %PDF-
  return h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2d;
}

/**
 * Heuristic: does this look like plain text? Already-detected binary
 * signatures should be filtered FIRST — this is a fallback that just
 * counts unprintable bytes in the header.
 */
export function looksLikeText(h: Uint8Array): boolean {
  let suspect = 0;
  for (let i = 0; i < h.length; i++) {
    const b = h[i];
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b /* esc */)) suspect++;
  }
  return suspect < 3;
}

/**
 * Top-level verdict for an uploaded file.
 * - signature must match the extension
 * - binary types are rejected regardless of claimed extension
 *
 * Returns null if accepted, or a human-readable reason string.
 */
export function rejectReasonForUpload(head: Uint8Array, ext: string): string | null {
  if (head.length < 8) {
    return "File is too small to be a valid research paper.";
  }
  if (isExecutable(head)) return "Executables are not allowed (Windows / Linux / macOS / shell scripts).";
  if (isArchive(head)) return "Archives are not allowed (ZIP, 7z, RAR, gzip, etc.).";
  if (isMedia(head)) return "Audio / video files are not allowed.";
  if (isImage(head)) return "Image files are not allowed in the research bucket.";

  if (ext === "pdf") {
    if (!isPdf(head)) return "File doesn't have a valid PDF signature (%PDF-). Likely a renamed non-PDF.";
    return null;
  }
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    if (!looksLikeText(head)) return "File claims to be text but contains binary bytes. Likely a renamed binary.";
    return null;
  }
  return `Unsupported extension .${ext || "(none)"}`;
}
