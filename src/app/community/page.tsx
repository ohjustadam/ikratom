import type { Metadata } from "next";
import { CategoryLanding } from "@/components/CategoryLanding";
import { categoryBySlug } from "@/config/nav-categories";

export const metadata: Metadata = {
  title: "Community — iKratom",
  description: "Who else is here: advocates, coalitions, and real stories.",
};

export default function CommunityPage() {
  return <CategoryLanding category={categoryBySlug("community")!} />;
}
