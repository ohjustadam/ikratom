/**
 * "What does a Public visitor / a Member / a Friend see on my profile?" for
 * the privacy settings page. Pure, and the same rule as can_view_audience
 * (0285) minus blocks: a section is visible when BOTH the profile page and the
 * section are open to that kind of viewer. It only previews; the database
 * decides every real read.
 */
import { AUDIENCES, type Audience, type SectionAudienceKey } from "./audience";

export type Viewer = "public" | "members" | "friends";
export const VIEWERS: { id: Viewer; label: string }[] = [
  { id: "public", label: "Anyone (signed out)" },
  { id: "members", label: "A member" },
  { id: "friends", label: "A friend" },
];

const rank = (a: Audience) => AUDIENCES.indexOf(a); // only_me 0 < friends 1 < members 2 < public 3
const need: Record<Viewer, number> = { friends: 1, members: 2, public: 3 };

export function canSee(viewer: Viewer, audience: Audience): boolean {
  return rank(audience) >= need[viewer];
}

export function previewFor(viewer: Viewer, settings: Record<SectionAudienceKey, Audience>): Record<SectionAudienceKey, boolean> {
  const page = canSee(viewer, settings.profile_audience);
  const out = {} as Record<SectionAudienceKey, boolean>;
  for (const k of Object.keys(settings) as SectionAudienceKey[]) {
    // New-photo default is a starting point, not a section anyone sees.
    out[k] = k === "profile_audience" ? page : k === "photos_default_audience" ? false : page && canSee(viewer, settings[k]);
  }
  return out;
}
