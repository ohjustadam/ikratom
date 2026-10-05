/**
 * notification-prefs-email.test.ts — saving settings must not turn email off.
 *
 * Until 2026-10-05 the Email checkbox was rendered `disabled` ("coming with
 * email integration"). Browsers leave disabled fields out of FormData, and
 * updateNotificationPrefs saves email = (field === "on"), so the first save of
 * ANY setting silently unsubscribed the member from the daily email and
 * hearing alerts that went live that day.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const form = readFileSync("src/modules/notifications/components/NotificationPrefsForm.tsx", "utf8");
const actions = readFileSync("src/modules/notifications/actions.ts", "utf8");

describe("email preference checkbox", () => {
  const tag = form.match(/<Check\s+name="email"[^>]*>/)?.[0];

  it("is rendered (guards against a scan that matches nothing)", () => {
    expect(tag).toBeTruthy();
    expect(actions).toMatch(/email:\s*formData\.get\("email"\)\s*===\s*"on"/);
  });

  it("is never disabled, so the browser always submits it", () => {
    expect(tag).not.toMatch(/\bdisabled\b/);
  });

  it("defaults to on, matching the column default (0258)", () => {
    expect(tag).toMatch(/initial\?\.email \?\? true/);
  });
});
