import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryLanding } from "@/components/CategoryLanding";
import { categoryBySlug } from "@/config/nav-categories";

export const metadata: Metadata = {
  title: "Knowledge — iKratom",
  description: "What to read: research, news, briefings, and the library.",
};

export default function KnowledgePage() {
  const category = categoryBySlug("knowledge");
  if (!category) notFound();
  return <CategoryLanding category={category} />;
}
