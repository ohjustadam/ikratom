import { ImageResponse } from "next/og";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

export const runtime = "nodejs";
export const alt = "iKratom campaign";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * Per-campaign OG card. Without this the App Router falls back to the default
 * site banner, so every shared campaign (and every Facebook share, which reads
 * og:image and ignores prefilled text) looked identical. Service-role read so
 * the crawler-fetched image renders regardless of session/RLS.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return new ImageResponse(<OgCard pill="Take action" title="iKratom campaign" />, { ...size });
  }

  const sb = createServiceClient(url, key, { auth: { persistSession: false } });
  const { data: c } = await sb
    .from("campaigns")
    .select("title, blurb, state, target_locality")
    .eq("slug", slug)
    .maybeSingle();

  if (!c) {
    return new ImageResponse(<OgCard pill="Take action" title="iKratom campaign" />, { ...size });
  }

  const scope = c.target_locality || c.state || null;
  const pill = scope ? `Take action · ${scope}` : "Take action";
  const title = (c.title ?? "iKratom campaign").slice(0, 220);
  const subtitle = c.blurb
    ? String(c.blurb).slice(0, 180)
    : "One-click letters + calls to the right officials.";

  return new ImageResponse(
    <OgCard pill={pill} pillColor="#10b981" title={title} subtitle={subtitle} />,
    { ...size },
  );
}
