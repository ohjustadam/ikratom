/**
 * Social profile vocabulary (B4b, migration 0283). Pure — safe to import from
 * client components, server actions and tests alike.
 *
 * The database is the authority: `can_view_audience(owner, audience)` decides
 * every read. These constants only label the four levels and list what a
 * member can choose; changing a label here never changes who can see what.
 */

export const AUDIENCES = ["only_me", "friends", "members", "public"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  only_me: "Only me",
  friends: "Friends",
  members: "Members",
  public: "Public",
};

export const AUDIENCE_HINT: Record<Audience, string> = {
  only_me: "Nobody else can see this",
  friends: "Members you have connected with",
  members: "Anyone signed in to iKratom",
  public: "Anyone on the internet, including search engines",
};

export const AUDIENCE_ICON: Record<Audience, string> = {
  only_me: "🔒",
  friends: "🤝",
  members: "👥",
  public: "🌎",
};

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

/** One audience per profile section; the keys are profile_social columns. */
export const SECTION_AUDIENCES = [
  { key: "profile_audience", label: "Your profile page", hint: "Who can open your profile at all. Every section below is limited by this too." },
  { key: "bio_audience", label: "Bio", hint: "Your short intro." },
  { key: "story_audience", label: "Advocacy story", hint: "The story you choose to tell on your profile." },
  { key: "interests_audience", label: "Interests", hint: "What you care about." },
  { key: "links_audience", label: "Links", hint: "Your website, blog or channels." },
  { key: "friends_audience", label: "Friends list", hint: "Who can see who you are connected with." },
  { key: "activity_audience", label: "Activity", hint: "Forum threads you started and your action count." },
  { key: "photos_default_audience", label: "New photos", hint: "The starting audience for photos you add to your album." },
] as const;

export type SectionAudienceKey = (typeof SECTION_AUDIENCES)[number]["key"];

/** Safe defaults (mirror the column defaults in 0283). */
export const DEFAULT_AUDIENCES: Record<SectionAudienceKey, Audience> = {
  profile_audience: "members",
  bio_audience: "members",
  story_audience: "members",
  interests_audience: "members",
  links_audience: "members",
  friends_audience: "friends",
  activity_audience: "members",
  photos_default_audience: "friends",
};

/** Fixed interest vocabulary: free text would become a doxing channel. */
export const INTERESTS = [
  { id: "consumer", label: "Kratom consumer" },
  { id: "veteran", label: "Veteran" },
  { id: "chronic_pain", label: "Chronic pain" },
  { id: "mental_health", label: "Mental health" },
  { id: "recovery", label: "Recovery" },
  { id: "family", label: "Family & caregivers" },
  { id: "shop_owner", label: "Shop owner" },
  { id: "vendor", label: "Vendor" },
  { id: "medical_pro", label: "Medical professional" },
  { id: "researcher", label: "Research & science" },
  { id: "policy", label: "Policy & bills" },
  { id: "testimony", label: "Testifying" },
  { id: "organizing", label: "Organizing" },
  { id: "writing", label: "Writing & media" },
  { id: "legal", label: "Legal" },
  { id: "consumer_safety", label: "Consumer safety & testing" },
] as const;

export type InterestId = (typeof INTERESTS)[number]["id"];
export const MAX_INTERESTS = 8;
export const MAX_LINKS = 5;
export const BIO_MAX = 300;
export const STORY_MAX = 2000;
export const LINK_LABEL_MAX = 40;
export const LINK_URL_MAX = 300;

export function interestLabel(id: string): string | null {
  return INTERESTS.find((i) => i.id === id)?.label ?? null;
}
