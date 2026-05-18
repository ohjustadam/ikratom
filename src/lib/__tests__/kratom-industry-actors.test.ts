import { describe, expect, it } from "vitest";
import {
  KRATOM_INDUSTRY_ACTORS,
  FACTION_META,
  ROLE_LABEL,
  type ActorFaction,
  type ActorRole,
} from "../kratom-industry-actors";

/**
 * Sanity tests for the hardcoded actor registry. This file is hand-
 * edited as new actors surface — typos in IDs / factions / roles
 * would silently break downstream features (the actors page faction
 * panel, threat-matrix cross-references, briefing surfaces). Catch
 * those at CI time, not at view time.
 */

const VALID_FACTIONS = new Set<ActorFaction>(
  Object.keys(FACTION_META) as ActorFaction[],
);
const VALID_ROLES = new Set<ActorRole>(
  Object.keys(ROLE_LABEL) as ActorRole[],
);

describe("kratom-industry-actors registry", () => {
  it("has at least one actor entry", () => {
    expect(KRATOM_INDUSTRY_ACTORS.length).toBeGreaterThan(0);
  });

  it("every actor has a stable lowercase-hyphenated id", () => {
    const idRe = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
    for (const a of KRATOM_INDUSTRY_ACTORS) {
      expect(a.id, `actor ${a.name}`).toMatch(idRe);
    }
  });

  it("all actor ids are unique", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const a of KRATOM_INDUSTRY_ACTORS) {
      if (seen.has(a.id)) dupes.push(a.id);
      seen.add(a.id);
    }
    expect(dupes, `duplicate ids: ${dupes.join(", ")}`).toEqual([]);
  });

  it("every faction is a known faction", () => {
    for (const a of KRATOM_INDUSTRY_ACTORS) {
      expect(VALID_FACTIONS.has(a.faction), `actor ${a.id} → faction ${a.faction}`).toBe(true);
    }
  });

  it("every role is a known role", () => {
    for (const a of KRATOM_INDUSTRY_ACTORS) {
      expect(VALID_ROLES.has(a.role), `actor ${a.id} → role ${a.role}`).toBe(true);
    }
  });

  it("every actor has at least one evidence URL", () => {
    for (const a of KRATOM_INDUSTRY_ACTORS) {
      expect(a.evidence_urls.length, `actor ${a.id}`).toBeGreaterThan(0);
      for (const url of a.evidence_urls) {
        expect(url, `actor ${a.id} url`).toMatch(/^https?:\/\//);
      }
    }
  });

  it("every actor has a last_verified ISO date", () => {
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    for (const a of KRATOM_INDUSTRY_ACTORS) {
      expect(a.last_verified, `actor ${a.id}`).toMatch(isoRe);
    }
  });

  it("every actor has a non-empty summary", () => {
    for (const a of KRATOM_INDUSTRY_ACTORS) {
      expect(a.summary?.trim().length ?? 0, `actor ${a.id}`).toBeGreaterThan(20);
    }
  });

  it("every actor has at least one affiliation", () => {
    for (const a of KRATOM_INDUSTRY_ACTORS) {
      expect(a.affiliations.length, `actor ${a.id}`).toBeGreaterThan(0);
      for (const aff of a.affiliations) {
        expect(aff.trim().length, `actor ${a.id} affiliation`).toBeGreaterThan(0);
      }
    }
  });

  it("FACTION_META has metadata for every faction in use", () => {
    const inUse = new Set(KRATOM_INDUSTRY_ACTORS.map((a) => a.faction));
    for (const f of inUse) {
      expect(FACTION_META[f], `faction ${f} missing FACTION_META`).toBeDefined();
    }
  });
});
