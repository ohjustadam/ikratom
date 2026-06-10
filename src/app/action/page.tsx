import type { Metadata } from "next";
import { CategoryLanding } from "@/components/CategoryLanding";
import { categoryBySlug } from "@/config/nav-categories";

export const metadata: Metadata = {
  title: "Action — iKratom",
  description: "What to do right now: one-click letters, calls, hearings, and the single highest-leverage move today.",
};

export default function ActionPage() {
  return <CategoryLanding category={categoryBySlug("action")!} />;
}
