import { describe, it, expect } from "vitest";
import { canSee, previewFor } from "@/modules/profile/privacy-preview";
import { DEFAULT_AUDIENCES } from "@/modules/profile/audience";

describe("privacy preview (mirrors can_view_audience, minus blocks)", () => {
  it("ranks the four levels", () => {
    expect(canSee("public", "public")).toBe(true);
    expect(canSee("public", "members")).toBe(false);
    expect(canSee("members", "members")).toBe(true);
    expect(canSee("members", "friends")).toBe(false);
    expect(canSee("friends", "friends")).toBe(true);
    expect(canSee("friends", "only_me")).toBe(false);
  });

  it("defaults: Members-only, so a signed-out visitor sees nothing", () => {
    const anon = previewFor("public", DEFAULT_AUDIENCES);
    expect(Object.values(anon).some(Boolean)).toBe(false);
    const member = previewFor("members", DEFAULT_AUDIENCES);
    expect(member.bio_audience).toBe(true);
    expect(member.friends_audience).toBe(false); // friends list defaults to Friends
    expect(previewFor("friends", DEFAULT_AUDIENCES).friends_audience).toBe(true);
  });

  it("the profile audience caps every section", () => {
    const s = { ...DEFAULT_AUDIENCES, profile_audience: "friends" as const, bio_audience: "public" as const };
    expect(previewFor("public", s).bio_audience).toBe(false);
    expect(previewFor("members", s).bio_audience).toBe(false);
    expect(previewFor("friends", s).bio_audience).toBe(true);
  });

  it("the new-photo default is never shown as a section", () => {
    const s = { ...DEFAULT_AUDIENCES, profile_audience: "public" as const, photos_default_audience: "public" as const };
    expect(previewFor("public", s).photos_default_audience).toBe(false);
  });
});
