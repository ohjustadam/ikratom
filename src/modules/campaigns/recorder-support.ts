/**
 * Browser differences for the clip recorder, kept pure so tests pin them.
 *
 * Chrome, Edge and Firefox record WebM; iOS Safari records MP4 (AAC audio).
 * Supabase's `campaign-attachments` bucket accepts audio/* and video/* up to
 * 25 MB (migration 0217), so the upload must carry a real media type: an empty
 * or parameterised one ("audio/webm;codecs=opus") is not a safe bet.
 */

export type ClipKind = "audio" | "video";

const CANDIDATES: Record<ClipKind, string[]> = {
  audio: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"],
  video: ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"],
};

/** The first container this browser can record, or undefined to let it choose. */
export function pickRecorderMime(kind: ClipKind, isTypeSupported: (t: string) => boolean): string | undefined {
  return CANDIDATES[kind].find((t) => {
    try {
      return isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

/** "audio/webm;codecs=opus" → "audio/webm"; an empty type falls back to what Safari records. */
export function uploadContentType(mime: string | null | undefined, kind: ClipKind): string {
  const base = String(mime ?? "").split(";")[0].trim().toLowerCase();
  if (/^(audio|video)\/[\w.+-]+$/.test(base)) return base;
  return kind === "video" ? "video/mp4" : "audio/mp4";
}

export function extForContentType(type: string): string {
  if (type.endsWith("/webm")) return "webm";
  if (type === "audio/mp4" || type === "audio/aac" || type === "audio/x-m4a") return "m4a";
  if (type === "video/mp4") return "mp4";
  if (type === "video/quicktime") return "mov";
  if (type.endsWith("/ogg")) return "ogg";
  return type.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin";
}

/** A plain-English reason recording could not start, with what to do about it. */
export function mediaErrorMessage(err: unknown, kind: ClipKind): string {
  const device = kind === "video" ? "camera and microphone" : "microphone";
  const name = (err as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return `Your browser blocked the ${device}. To allow it, tap the lock or settings icon next to the web address and allow ${kind === "video" ? "Camera and Microphone" : "Microphone"} for ikratom.org (on iPhone: Settings › Safari › ${kind === "video" ? "Camera / Microphone" : "Microphone"} › Allow), then reload this page.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `No ${device} was found on this device.`;
    case "NotReadableError":
    case "AbortError":
      return `Your ${device} is in use by another app. Close that app and try again.`;
    case "Unsupported":
      return "This browser can't record clips. Try the latest Chrome or Safari.";
    default:
      return `Couldn't start recording${(err as Error)?.message ? `: ${(err as Error).message}` : "."}`;
  }
}
