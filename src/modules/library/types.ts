export type LibraryItemType = "video" | "audio" | "book" | "article" | "document";

export const TYPE_LABELS: Record<LibraryItemType, string> = {
  video: "Video",
  audio: "Audio / Podcast",
  book: "Book",
  article: "Article",
  document: "Document",
};

export const TYPE_ICONS: Record<LibraryItemType, string> = {
  video: "▶️",
  audio: "🎙️",
  book: "📖",
  article: "📰",
  document: "📄",
};

export type LibraryItem = {
  id: string;
  type: LibraryItemType;
  title: string;
  description: string | null;
  url: string | null;
  embed_html: string | null;
  cover_image_url: string | null;
  full_text: string | null;
  summary: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  author: string | null;
  source_org: string | null;
  language: string;
  published_at: string | null;
  tags: string[];
  kratom_relevance: string;
  added_by: string | null;
  featured: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};
