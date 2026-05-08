import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "iKratom briefing";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Defensive: untrusted route param.
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return new ImageResponse(
      (<OgCard pill="Briefing" title="iKratom Policy Briefing" />),
      { ...size },
    );
  }

  const file = path.join(process.cwd(), "src", "content", "briefings", `${slug}.md`);
  if (!fs.existsSync(file)) {
    return new ImageResponse(
      (<OgCard pill="Briefing" title="iKratom Policy Briefing" />),
      { ...size },
    );
  }

  const { data } = matter(fs.readFileSync(file, "utf8"));
  const toStr = (v: unknown): string | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  };
  const title = toStr(data.title) ?? "iKratom Policy Briefing";
  const subtitle = toStr(data.subtitle);
  const published = toStr(data.published);
  const audience = toStr(data.audience);

  // Pill copy: "POLICY BRIEFING · MAY 2026" so the share preview tells
  // the reader exactly what kind of artifact this link is.
  const pillBase = audience?.toLowerCase().includes("industry") ? "Industry briefing" : "Policy briefing";
  const pillDate = published
    ? new Date(published).toLocaleString(undefined, { month: "short", year: "numeric" })
    : null;
  const pill = pillDate ? `${pillBase} · ${pillDate}` : pillBase;

  return new ImageResponse(
    (<OgCard pill={pill} title={title} subtitle={subtitle} />),
    { ...size },
  );
}
