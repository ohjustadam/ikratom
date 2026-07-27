import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/audit";

/**
 * Admin CSV export endpoint.
 *
 * GET /admin/exports?type=<campaigns|actions|advocates|bills>
 *
 * - campaigns / actions / bills: owner / admin / leader (re-checked server-side).
 * - advocates: OWNER ONLY. It is a whole-membership PII dump — every user's
 *   real full_name plus their resolved city/county/congressional/state
 *   districts, i.e. enough to locate a named advocate. One URL with no
 *   further friction, so it sits at the owner tier rather than being one
 *   compromised admin session away. (No email column — the older comment
 *   here claimed auth.users.email was included; it never was.)
 * - Every export is audit-logged below, including who pulled what.
 * - Streams text/csv. No buffering, no DB-row caps for now (free-tier
 *   data sizes are small enough that this fits comfortably; revisit if
 *   we ever hit 100k+ rows).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES = ["campaigns", "actions", "advocates", "bills"] as const;
type ExportType = (typeof TYPES)[number];

function csvEscape(s: unknown): string {
  if (s === null || s === undefined) return "";
  let str = String(s).replace(/\r?\n/g, " ");
  // CSV formula-injection defense (pen-test critic): Excel/Sheets execute a cell
  // that starts with = + - @ (or tab/CR) as a formula — e.g. a campaign title
  // `=HYPERLINK(...)` runs when an admin opens the export. Prefix with ' to force
  // the cell to be treated as text.
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") as ExportType | null;
  if (!type || !TYPES.includes(type)) {
    return NextResponse.json({ error: "type must be one of: " + TYPES.join(", ") }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  const p = profile as { is_admin: boolean | null; is_owner: boolean | null; is_advocate_leader: boolean | null } | null;
  if (!p?.is_admin && !p?.is_owner && !p?.is_advocate_leader) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // The advocates export dumps every user's real full_name + full district
  // geography — owner only. Admins and leaders can still export the non-PII
  // campaigns/actions/bills views.
  if (type === "advocates" && !p.is_owner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rows: Record<string, unknown>[] = [];
  switch (type) {
    case "campaigns": {
      const { data } = await supabase
        .from("campaigns")
        .select("id, slug, title, blurb, state, target_locality, target_roles, active, auto_generated, review_state, created_at")
        .order("created_at", { ascending: false });
      rows = (data ?? []) as Record<string, unknown>[];
      break;
    }
    case "actions": {
      const { data } = await supabase
        .from("campaign_actions")
        .select("id, user_id, campaign_id, legislator_id, method, source, sent_at, is_non_resident, referred_from")
        .order("sent_at", { ascending: false });
      rows = (data ?? []) as Record<string, unknown>[];
      break;
    }
    case "advocates": {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, state, city, county, congressional_district, state_senate_district, state_house_district, is_shop_owner, is_medical_professional, is_advocate_leader, locale, action_streak_days, longest_streak_days, last_action_date, forum_post_count, created_at")
        .order("created_at", { ascending: false });
      rows = (data ?? []) as Record<string, unknown>[];
      break;
    }
    case "bills": {
      const { data } = await supabase
        .from("bills")
        .select("id, state, bill_number, title, summary_ai, status, kratom_relevance, relevance_confidence, targets_natural_leaf, targets_synthetic_only, scope, session_id, last_action_at, signed_at, effective_date, official_url")
        .eq("active", true);
      rows = (data ?? []) as Record<string, unknown>[];
      break;
    }
  }

  const csv = toCsv(rows);
  const today = new Date().toISOString().slice(0, 10);

  // Audit every pull. /admin/exports has always TOLD the operator these are
  // logged; until now nothing wrote a row. Bulk data leaving the platform is
  // exactly what an audit trail is for, so the claim is now true.
  await recordAdminAction({
    action: "data_export",
    targetType: "user",
    targetId: user.id,
    details: { type, row_count: rows.length },
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=ikratom-${type}-${today}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
