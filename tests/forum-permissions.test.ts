import { describe, expect, it } from "vitest";
import {
  forumRights,
  forumRoleOf,
  isNewForumAccount,
  isSamePost,
  type ForumContent,
  type ForumRole,
  type ForumViewer,
} from "@/lib/forum-permissions";
import { moderateEdit } from "@/lib/moderation";

const post = (over: Partial<ForumContent> = {}): ForumContent => ({
  authorId: "author",
  authorRole: "member",
  isBot: false,
  status: "approved",
  threadLocked: false,
  ...over,
});
const moderator = (role: ForumRole): ForumViewer => ({ id: "me", role, canModerate: true });
const member: ForumViewer = { id: "me", role: "member", canModerate: false };

describe("forumRights", () => {
  it("gives a signed-out visitor nothing", () => {
    expect(forumRights({ id: null, role: "member", canModerate: false }, post())).toEqual({
      edit: false,
      delete: false,
      remove: false,
    });
  });

  it("lets a member edit and delete their own post, and nobody else's", () => {
    expect(forumRights(member, post({ authorId: "me" }))).toEqual({ edit: true, delete: true, remove: false });
    expect(forumRights(member, post())).toEqual({ edit: false, delete: false, remove: false });
  });

  it("stops an author editing in a locked thread, but they can still delete", () => {
    const rights = forumRights(member, post({ authorId: "me", threadLocked: true }));
    expect(rights.edit).toBe(false);
    expect(rights.delete).toBe(true);
  });

  it("leaves what a moderator removed alone, even for its author", () => {
    expect(forumRights(member, post({ authorId: "me", status: "removed" }))).toEqual({
      edit: false,
      delete: false,
      remove: false,
    });
  });

  it("lets a leader hide a member's post but never rewrite it", () => {
    expect(forumRights(moderator("leader"), post())).toEqual({ edit: false, delete: false, remove: true });
  });

  it("lets an admin correct and hide a member's or leader's post", () => {
    for (const authorRole of ["member", "leader"] as const) {
      expect(forumRights(moderator("admin"), post({ authorRole }))).toEqual({
        edit: true,
        delete: false,
        remove: true,
      });
    }
  });

  it("makes a moderator outrank the author", () => {
    expect(forumRights(moderator("leader"), post({ authorRole: "leader" })).remove).toBe(false);
    expect(forumRights(moderator("leader"), post({ authorRole: "admin" })).remove).toBe(false);
    expect(forumRights(moderator("admin"), post({ authorRole: "admin" }))).toEqual({
      edit: false,
      delete: false,
      remove: false,
    });
    expect(forumRights(moderator("admin"), post({ authorRole: "owner" })).remove).toBe(false);
    expect(forumRights(moderator("owner"), post({ authorRole: "admin" }))).toEqual({
      edit: true,
      delete: false,
      remove: true,
    });
  });

  it("keeps the bot's posts for admins and the owner", () => {
    const bot = post({ authorId: null, isBot: true });
    expect(forumRights(moderator("leader"), bot)).toEqual({ edit: false, delete: false, remove: false });
    expect(forumRights(moderator("admin"), bot)).toEqual({ edit: true, delete: false, remove: true });
    expect(forumRights(member, bot)).toEqual({ edit: false, delete: false, remove: false });
  });

  it("follows moderate_forum, not the role name", () => {
    // A leader the owner took moderation away from is a plain member here.
    expect(forumRights({ id: "me", role: "leader", canModerate: false }, post()).remove).toBe(false);
    // A member the owner granted it to moderates like a leader.
    expect(forumRights({ id: "me", role: "member", canModerate: true }, post())).toEqual({
      edit: false,
      delete: false,
      remove: true,
    });
  });

  it("lets a moderator keep editing their own post in a thread they locked", () => {
    expect(forumRights(moderator("leader"), post({ authorId: "me", threadLocked: true })).edit).toBe(true);
  });
});

describe("forumRoleOf", () => {
  it("takes the highest flag", () => {
    expect(forumRoleOf({ is_owner: true, is_admin: true })).toBe("owner");
    expect(forumRoleOf({ is_admin: true, is_advocate_leader: true })).toBe("admin");
    expect(forumRoleOf({ is_advocate_leader: true })).toBe("leader");
    expect(forumRoleOf(null)).toBe("member");
  });
});

describe("spam limits", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");

  it("treats an account as new for three days", () => {
    expect(isNewForumAccount("2026-11-05T12:00:00Z", now)).toBe(true);
    expect(isNewForumAccount("2026-11-03T11:00:00Z", now)).toBe(false);
    expect(isNewForumAccount(null, now)).toBe(false);
  });

  it("sees through case and spacing on a repeated post", () => {
    expect(isSamePost("Call your  rep\nTODAY", "call your rep today")).toBe(true);
    expect(isSamePost("Call your rep", "Call your senator")).toBe(false);
  });
});

describe("moderateEdit", () => {
  const edit = (over: Partial<Parameters<typeof moderateEdit>[0]>) =>
    moderateEdit({ currentStatus: "approved", body: "Fixed a typo", authorPostCount: 10, isPrivileged: false, ...over });

  it("leaves an ordinary edit approved", () => {
    expect(edit({}).status).toBe("approved");
  });

  it("sends a link added after approval to a moderator", () => {
    expect(edit({ body: "Buy here https://cheap-kratom.shop/deal" }).status).toBe("auto_flagged");
  });

  it("keeps a post in review when its author edits it", () => {
    expect(edit({ currentStatus: "pending" }).status).toBe("pending");
    expect(edit({ currentStatus: "user_flagged" }).status).toBe("user_flagged");
  });

  it("sends a new account's edit back to review", () => {
    expect(edit({ authorPostCount: 1 }).status).toBe("pending");
  });

  it("lets a moderator's own post through", () => {
    expect(edit({ body: "See https://example.com/x", isPrivileged: true }).status).toBe("approved");
  });
});
