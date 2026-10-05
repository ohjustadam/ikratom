import { NextResponse } from "next/server";
import { createClient, getCachedClaims } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { loadYourRep, type YourRepData } from "@/app/bills/[id]/your-rep-data";

/**
 * GET /api/bills/[id]/your-rep — the signed-in viewer's "your rep is deciding
 * this bill" data, for the client component on /bills/:id.
 *
 * Request-bound on purpose: it is one viewer's representatives, so it can never
 * live in the cached bill page (reading cookies there made production 500 every
 * bill page). The bill's state and committee are read HERE from the database,
 * never taken from the browser.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (data: YourRepData | null, status = 200) =>
  NextResponse.json({ data }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return json(null, 400);

    const claims = await getCachedClaims();
    const userId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!userId) return json(null);

    const ip = await getClientIp();
    if (!(await checkRateLimit(`bill-your-rep:${userId}:${ip}`, 120, 60))) return json(null, 429);

    const sb = await createClient();
    const { data: bill } = await sb
      .from("bills")
      .select("state, current_committee_name")
      .eq("id", id)
      .maybeSingle();
    const b = bill as { state: string | null; current_committee_name: string | null } | null;
    if (!b?.state || !b.current_committee_name) return json(null);

    return json(await loadYourRep(sb, userId, b.state, b.current_committee_name));
  } catch {
    // The callout is optional: fail silent rather than break the bill page.
    return json(null);
  }
}
