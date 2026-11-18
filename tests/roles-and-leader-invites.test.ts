import { describe, expect, it } from "vitest";
import {
  promotionChecklist,
  checklistDone,
  ownerMissingLine,
  inviteNotificationBody,
  missingAddressParts,
  joinAnd,
} from "@/modules/auth/promotion-checklist";
import { canEditCampaign, campaignsSkipReview, resolvePermissions } from "@/modules/admin/permissions";
import { publicRole } from "@/lib/public-handle";

const FULL = { full_name: "A B", street: "1 Main", city: "Tulsa", state: "OK", zip: "74101" };

describe("promotionChecklist", () => {
  it("a verified member has nothing left", () => {
    const items = promotionChecklist({ emailConfirmed: true, ageHours: 100, mfaEnrolled: true, profile: FULL });
    expect(checklistDone(items)).toBe(true);
    expect(ownerMissingLine(items)).toBe("nothing left");
  });

  it("the 11-17 case: the address blocks, 2FA is only recommended", () => {
    const items = promotionChecklist({
      emailConfirmed: true, ageHours: 400, mfaEnrolled: false,
      profile: { full_name: null, street: null, city: null, state: "OK", zip: null },
    });
    expect(checklistDone(items)).toBe(false);
    expect(ownerMissingLine(items)).toBe("needs full name, street, city and ZIP");
    const body = inviteNotificationBody(items);
    expect(body).toContain("full name, street, city and ZIP");
    expect(body).toContain("Recommended, not required: turn on two-step sign-in");
    expect(body).not.toMatch(/\d\. Turn on two-step/); // never a numbered, required step
    expect(body).toContain("Your name and address stay private");
    expect(body).not.toContain("Confirm your email"); // already done, so not listed
  });

  it("owner 11-17: a leader without 2FA is done; an admin-level gate still needs it", () => {
    const leader = promotionChecklist({ emailConfirmed: true, ageHours: 100, mfaEnrolled: false, profile: FULL });
    expect(checklistDone(leader)).toBe(true);
    expect(ownerMissingLine(leader)).toBe("nothing left");
    expect(leader.find((i) => i.key === "mfa")).toMatchObject({ done: false, optional: true });
    expect(inviteNotificationBody(leader)).toContain("Open this to accept. Recommended, not required");

    const admin = promotionChecklist({ emailConfirmed: true, ageHours: 100, mfaEnrolled: false, requireMfa: true, profile: FULL });
    expect(checklistDone(admin)).toBe(false);
    expect(ownerMissingLine(admin)).toBe("needs 2FA");
  });

  it("counts down the 48-hour wait and needs no action for it", () => {
    const items = promotionChecklist({ emailConfirmed: true, ageHours: 40.2, mfaEnrolled: true, profile: FULL });
    const age = items.find((i) => i.key === "age")!;
    expect(age.done).toBe(false);
    expect(age.href).toBeNull();
    expect(age.label).toContain("about 8 more hours");
  });

  it("treats blank strings as missing", () => {
    expect(missingAddressParts({ ...FULL, street: "  " })).toEqual(["street"]);
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("campaign authoring (broken for leaders since #847)", () => {
  const leader = [...resolvePermissions({ isOwner: false, isAdmin: false, isLeader: true })];
  const admin = [...resolvePermissions({ isOwner: false, isAdmin: true, isLeader: false })];
  const member = [...resolvePermissions({ isOwner: false, isAdmin: false, isLeader: false })];

  it("a leader holds author_campaigns but not edit_campaigns, so creation must gate on author_campaigns", () => {
    expect(leader).toContain("author_campaigns");
    expect(leader).not.toContain("edit_campaigns");
  });

  it("a leader edits their own campaign and nobody else's", () => {
    expect(canEditCampaign(leader, "u1", "u1")).toBe(true);
    expect(canEditCampaign(leader, "u1", "u2")).toBe(false);
    expect(canEditCampaign(leader, "u1", null)).toBe(false);
  });

  it("an admin edits any campaign; a plain member edits none", () => {
    expect(canEditCampaign(admin, "a", "someone")).toBe(true);
    expect(canEditCampaign(member, "u1", "u1")).toBe(false);
  });

  it("only admins, the owner and approve_campaigns holders skip review", () => {
    expect(campaignsSkipReview({ isOwner: false, isAdmin: false }, leader)).toBe(false);
    expect(campaignsSkipReview({ isOwner: false, isAdmin: true }, admin)).toBe(true);
    expect(campaignsSkipReview({ isOwner: true, isAdmin: false }, [])).toBe(true);
    expect(campaignsSkipReview({ isOwner: false, isAdmin: false }, ["approve_campaigns"])).toBe(true);
  });
});

describe("publicRole", () => {
  it("shows the owner as Admin, then leader, else nothing", () => {
    expect(publicRole({ is_owner: true })).toBe("admin");
    expect(publicRole({ is_admin: true, is_advocate_leader: true })).toBe("admin");
    expect(publicRole({ is_advocate_leader: true })).toBe("leader");
    expect(publicRole({})).toBeNull();
    expect(publicRole(null)).toBeNull();
  });
});
