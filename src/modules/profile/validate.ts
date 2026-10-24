/**
 * Server-side validation for the profile editor. Pure, so it is unit-tested
 * (tests/social-profile.test.ts). The DB constraints in 0283 are the backstop;
 * this turns a bad input into a readable message before it gets there.
 */
import { isSafePublicUrl } from "@/lib/url-safety";
import { detectModerationSignals } from "@/lib/moderation";
import {
  BIO_MAX, DEFAULT_AUDIENCES, INTERESTS, LINK_LABEL_MAX, LINK_URL_MAX, MAX_INTERESTS, MAX_LINKS,
  SECTION_AUDIENCES, STORY_MAX, isAudience,
  type Audience, type SectionAudienceKey,
} from "./audience";

export type ProfileInput = {
  bio: string;
  story: string;
  interests: string[];
  links: { label: string; url: string }[];
  audiences: Partial<Record<SectionAudienceKey, string>>;
};

export type ProfileClean = {
  bio: string | null;
  story: string | null;
  interests: string[];
  links: { label: string; url: string }[];
  audiences: Record<SectionAudienceKey, Audience>;
};

const INTEREST_IDS = new Set<string>(INTERESTS.map((i) => i.id));

/** A public profile is no place for a phone number or an email address. */
function contactLeak(text: string): string | null {
  const s = detectModerationSignals(text);
  if (s.phones.length) return "a phone number";
  if (s.emails.length) return "an email address";
  return null;
}

export function validateProfileInput(raw: ProfileInput): { ok: true; value: ProfileClean } | { error: string } {
  const bio = (raw.bio ?? "").trim();
  const story = (raw.story ?? "").trim();
  if (bio.length > BIO_MAX) return { error: `Bio must be ${BIO_MAX} characters or less.` };
  if (story.length > STORY_MAX) return { error: `Story must be ${STORY_MAX} characters or less.` };
  for (const [name, text] of [["bio", bio], ["story", story]] as const) {
    const leak = contactLeak(text);
    if (leak) return { error: `Your ${name} contains ${leak}. Remove it: other members can see your profile, and contact details can identify you.` };
  }

  const interests = [...new Set((raw.interests ?? []).map((i) => String(i)))];
  if (interests.length > MAX_INTERESTS) return { error: `Pick up to ${MAX_INTERESTS} interests.` };
  if (interests.some((i) => !INTEREST_IDS.has(i))) return { error: "Unknown interest." };

  const links: { label: string; url: string }[] = [];
  for (const l of raw.links ?? []) {
    const label = (l?.label ?? "").trim();
    const url = (l?.url ?? "").trim();
    if (!label && !url) continue;
    if (!label || label.length > LINK_LABEL_MAX) return { error: `Each link needs a label of 1-${LINK_LABEL_MAX} characters.` };
    if (url.length > LINK_URL_MAX) return { error: `Links must be ${LINK_URL_MAX} characters or less.` };
    const safe = isSafePublicUrl(url);
    if (!safe.ok) return { error: `Link "${label}": ${safe.reason}` };
    if (safe.url.protocol !== "https:") return { error: `Link "${label}" must start with https://` };
    if (/\s/.test(url)) return { error: `Link "${label}" contains spaces.` };
    links.push({ label, url: safe.url.toString() });
  }
  if (links.length > MAX_LINKS) return { error: `Add up to ${MAX_LINKS} links.` };

  const audiences = { ...DEFAULT_AUDIENCES };
  for (const { key } of SECTION_AUDIENCES) {
    const v = raw.audiences?.[key];
    if (v === undefined) continue;
    if (!isAudience(v)) return { error: "Invalid privacy level." };
    audiences[key] = v;
  }

  return {
    ok: true,
    value: { bio: bio || null, story: story || null, interests, links, audiences },
  };
}
