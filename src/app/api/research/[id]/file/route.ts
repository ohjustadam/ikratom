import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Opens a research paper's uploaded file: signs a fresh one-hour URL and
 * redirects to it. The paper page is cached, so it links here instead of
 * carrying a signed URL that would expire while the page is still being
 * served. The bucket stays private; only active papers resolve.
 */
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const sb = createServiceRoleClient();
  const { data } = await sb
    .from("research_papers")
    .select("uploaded_storage_path")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  const path = (data?.uploaded_storage_path as string | null | undefined) ?? null;
  if (!path) return notFound();
  const { data: signed } = await sb.storage.from("research-uploads").createSignedUrl(path, 60 * 60);
  if (!signed?.signedUrl) return notFound();
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
