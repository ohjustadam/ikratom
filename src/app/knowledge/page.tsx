import type { Metadata } from "next";
import { CategoryLanding } from "@/components/CategoryLanding";
import { categoryBySlug } from "@/config/nav-categories";

export const metadata: Metadata = {
  title: "Knowledge — iKratom",
  description: "What to read: research, news, briefings, and the library.",
};

export default function KnowledgePage() {
  return <CategoryLanding category={categoryBySlug("knowledge")!} />;
}
