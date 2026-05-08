import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "iKratom — bill detail";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const STATUS_LABEL: Record<string, string> = {
  introduced: "Introduced",
  committee: "In committee",
  passed_chamber: "Passed chamber",
  enacted: "Enacted",
  dead: "Dead",
};

const STANCE_PILL_COLOR: Record<string, string> = {
  pro: "#10b981",
  anti: "#ef4444",
  neutral: "#71717a",
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new ImageResponse(
      (<OgCard pill="Bill" title="iKratom — bill detail" />),
      { ...size },
    );
  }

  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("bills")
    .select("state, bill_number, title, status, scope, locality, kratom_relevance")
    .eq("id", id)
    .single();

  if (!bill) {
    return new ImageResponse(
      (<OgCard pill="Bill not found" title="iKratom — bill detail" />),
      { ...size },
    );
  }

  // Pill: STATE · NUMBER · STATUS  (or with locality for municipal)
  const scopePart = bill.scope && bill.scope !== "state" && bill.locality
    ? bill.locality
    : bill.state;
  const statusPart = bill.status ? STATUS_LABEL[bill.status] ?? bill.status : null;
  const pillParts = [scopePart, bill.bill_number, statusPart].filter(Boolean);
  const pill = pillParts.join(" · ");

  const pillColor = STANCE_PILL_COLOR[bill.kratom_relevance ?? "neutral"] ?? STANCE_PILL_COLOR.neutral;
  const title = bill.title ?? `${bill.state} ${bill.bill_number}`;
  const subtitle = bill.scope === "municipal" || bill.scope === "county"
    ? `Local ordinance · ${bill.locality ?? bill.state}`
    : `${bill.state} state legislation`;

  return new ImageResponse(
    (<OgCard pill={pill} pillColor={pillColor} title={title.slice(0, 220)} subtitle={subtitle} />),
    { ...size },
  );
}
