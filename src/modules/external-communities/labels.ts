// Pure constants — kept out of actions.ts because Next.js "use server"
// files can only export async functions.

export type ExtCategory =
  | "facebook" | "reddit" | "discord" | "podcast"
  | "telegram" | "youtube" | "other";

export const CATEGORY_LABELS: Record<ExtCategory, string> = {
  facebook: "Facebook",
  reddit: "Reddit",
  discord: "Discord",
  podcast: "Podcasts + media",
  telegram: "Telegram",
  youtube: "YouTube",
  other: "Other",
};

export const CATEGORIES: ExtCategory[] = [
  "facebook", "reddit", "discord", "podcast", "telegram", "youtube", "other",
];
