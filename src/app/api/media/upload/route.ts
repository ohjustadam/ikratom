import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isMediaStoreConfigured } from "@/lib/media-store";
import { detectModerationSignals } from "@/lib/moderation";
import { MAX_UPLOAD_BYTES, storeMemberPhoto, type PhotoKind } from "@/modules/profile/photo-upload";

export const dynamic = "force-dynamic";

const KINDS = new Set<PhotoKind>(["avatar", "cover", "album"]);

/**
 * POST /api/media/upload (multipart: file, kind, caption?, audience?).
 *
 * The browser has already re-encoded the photo through a canvas (which drops
 * metadata); this route does it again authoritatively (lib/image-strip.ts)
 * before anything is stored. Same-origin only, signed-in only, 4 MB cap
 * (under Netlify's ~6 MB function body limit), 20 uploads an hour.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || safeHost(origin) !== host) return json({ error: "Bad origin." }, 403);
  if (!isMediaStoreConfigured()) return json({ error: "Photo uploads are not enabled on this server." }, 503);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in to upload photos." }, 401);
  // The proxy that enforced account locks is disabled (since 07-26): check here.
  const { data: me } = await supabase.from("profiles").select("account_locked_at").eq("id", user.id).maybeSingle();
  if (me?.account_locked_at) return json({ error: "Your account is locked." }, 403);

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: "That photo is too large (4 MB max)." }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Could not read the upload." }, 400);
  }
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "") as PhotoKind;
  const caption = String(form.get("caption") ?? "").trim().slice(0, 300) || null;
  const audience = form.get("audience") ? String(form.get("audience")) : null;
  if (!(file instanceof File)) return json({ error: "No photo attached." }, 400);
  if (!KINDS.has(kind)) return json({ error: "Unknown photo type." }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "That photo is too large (4 MB max)." }, 413);
  if (caption) {
    const s = detectModerationSignals(caption);
    if (s.phones.length || s.emails.length) return json({ error: "Remove phone numbers and email addresses from the caption." }, 400);
  }

  if (!(await checkRateLimit(`photo-upload:${user.id}`, 20, 3600))) {
    return json({ error: "You've uploaded a lot of photos this hour. Try again later." }, 429);
  }

  const r = await storeMemberPhoto({
    userClient: supabase,
    userId: user.id,
    kind,
    bytes: new Uint8Array(await file.arrayBuffer()),
    caption,
    audience,
  });
  if ("error" in r) return json({ error: r.error }, r.status);

  revalidatePath(`/profile/${user.id}`);
  revalidatePath("/account/profile");
  return json({ ok: true, id: r.id, url: `/api/media/${r.id}` }, 200);
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
