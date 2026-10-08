import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PERMISSION_KEYS } from "../src/modules/admin/permissions";

/**
 * Coverage canary: every /admin page must gate on a real permission.
 *
 * A new admin page that calls the bare `getAdminContext()` still works, but it
 * is invisible to the permissions matrix — the owner cannot revoke it from an
 * admin, and cannot delegate it to a leader. That is exactly the silent gap
 * the matrix was rebuilt to close, so this fails CI instead of letting the
 * next page quietly regress it.
 *
 * If you add a page that genuinely should be role-gated rather than
 * permission-gated, add it to ALLOWED_BARE with a reason.
 */

const ADMIN_DIR = join(__dirname, "..", "src", "app", "admin");

const ALLOWED_BARE: Record<string, string> = {};

function pages(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
}

const files = pages(ADMIN_DIR);
const keys = new Set<string>(PERMISSION_KEYS);

describe("every /admin page is permission-gated", () => {
  it("found the admin pages", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    const rel = file.slice(file.indexOf(`src${join("", "")}app`)).replace(/\\/g, "/");
    it(rel, () => {
      const src = readFileSync(file, "utf8");
      if (ALLOWED_BARE[rel]) return;

      const gate = /get(?:Admin|Creator)Context\(\{\s*require:\s*"([a-z_]+)"\s*\}\)/.exec(src);
      const bare = /get(?:Admin|Creator)Context\(\)/.test(src);

      expect(
        bare,
        `${rel} calls getAdminContext()/getCreatorContext() with no \`require\` — it cannot be delegated or revoked from the permissions matrix.`,
      ).toBe(false);
      expect(gate, `${rel} has no permission gate`).not.toBeNull();
      expect(keys.has(gate![1]), `${rel} gates on unknown permission "${gate![1]}"`).toBe(true);
    });
  }
});
