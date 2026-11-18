import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryLanding } from "@/components/CategoryLanding";
import { categoryBySlug } from "@/config/nav-categories";

export const metadata: Metadata = {
  alternates: { canonical: "/community" },
  title: "Community",
  description: "Who else is here: advocates, coalitions, and real stories.",
};

export default function CommunityPage() {
  const category = categoryBySlug("community");
  if (!category) notFound();
  return <CategoryLanding category={category} />;
}
