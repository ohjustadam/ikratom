import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryLanding } from "@/components/CategoryLanding";
import { categoryBySlug } from "@/config/nav-categories";

export const metadata: Metadata = {
  alternates: { canonical: "/legislative" },
  title: "Legislative",
  description: "What to track: every bill, board, and legislator shaping kratom policy.",
};

export default function LegislativePage() {
  const category = categoryBySlug("legislative");
  if (!category) notFound();
  return <CategoryLanding category={category} />;
}
