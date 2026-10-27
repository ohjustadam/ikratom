/**
 * Browser-side first pass on a member photo, before it leaves the device:
 * decode (applying the EXIF orientation), scale down, and re-encode through a
 * canvas. A canvas re-encode carries NO metadata, so GPS never even travels.
 * The server strips again regardless (lib/image-strip.ts): this pass is for
 * the member's bandwidth and privacy, not the security boundary.
 */
export const MAX_DIM = { avatar: 768, cover: 2048, album: 2048, wall: 2048 } as const;

export async function prepareImage(file: File, maxDim: number): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif|gif|bmp)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new Error("Pick a photo (JPEG, PNG or WebP).");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This browser could not open that photo. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not process the photo.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("This browser could not process the photo.");
  return blob;
}

/** Re-encode, then POST to /api/media/upload. Returns the new photo's id. */
export async function uploadPhoto(
  file: File,
  kind: keyof typeof MAX_DIM,
  extra: { audience?: string; caption?: string } = {},
): Promise<{ id: string; url: string }> {
  const blob = await prepareImage(file, MAX_DIM[kind]);
  const form = new FormData();
  form.append("file", blob, "photo.jpg");
  form.append("kind", kind);
  if (extra.audience) form.append("audience", extra.audience);
  if (extra.caption) form.append("caption", extra.caption);
  const res = await fetch("/api/media/upload", { method: "POST", body: form, credentials: "same-origin" });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; url?: string; error?: string };
  if (!res.ok || !body.id || !body.url) throw new Error(body.error ?? "Upload failed. Please try again.");
  return { id: body.id, url: body.url };
}
