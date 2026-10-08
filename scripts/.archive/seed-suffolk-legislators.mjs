/**
 * Seed the 18-member Suffolk County Legislature roster.
 *
 * Why: Suffolk County Resolution 1279-2026 (kratom ban) is currently tabled
 * and our /bills/<suffolk-id> page surfaces an "Officials to contact" widget
 * driven by the `legislators` table filter on:
 *   state='NY' AND locality='Suffolk County, NY' AND role='county_commissioner'
 *   AND active=true
 * That widget is currently empty because we have zero NY county-level
 * legislators in our DB. This script backfills the 18 sitting legislators
 * who would vote on the resolution if it comes off the table.
 *
 * Source: https://www.scnylegislature.us/148/Legislators + each legislator's
 * individual profile page (/154 through /171). Verified per-legislator on
 * 2026-05-14 — email, phone, AND party each pulled from the legislator's
 * own scnylegislature.us profile. Two names deviate from the
 * firstname.lastname pattern, which is why we verified each instead of
 * inferring:
 *   - D3 Mazzarella → Jim.Mazzarella (uses nickname, not James)
 *   - D7 Thorne → DominickS.Thorne (kept middle initial S as one token)
 *
 * Two legislators (D3 Mazzarella, D6 Lennon) didn't have party listed on
 * their county profile pages — left null, admin can fill from external
 * sources.
 *
 * Idempotent — UPSERT on (state, full_name, locality). Re-running updates
 * email/phone if changed; doesn't duplicate.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Verified per-legislator on 2026-05-14 from each profile page on
// scnylegislature.us. Email + phone + party are all source-of-truth from
// the county's own legislator pages, not pattern-inferred.
const SUFFOLK_LEGISLATORS = [
  { district: "1",  name: "Greg Doroski",          email: "Greg.Doroski@suffolkcountyny.gov",       phone: "631-852-3200", party: "D" },
  { district: "2",  name: "Ann Welker",            email: "Ann.Welker@suffolkcountyny.gov",         phone: "631-852-8400", party: "D" },
  { district: "3",  name: "James F. Mazzarella",   email: "Jim.Mazzarella@suffolkcountyny.gov",     phone: "631-852-1300", party: null },
  { district: "4",  name: "Nick Caracappa",        email: "Nick.Caracappa@suffolkcountyny.gov",     phone: "631-854-9292", party: "C" },
  { district: "5",  name: "Steven Englebright",    email: "Steven.Englebright@suffolkcountyny.gov", phone: "631-854-1650", party: "D" },
  { district: "6",  name: "Chad Lennon",           email: "Chad.Lennon@suffolkcountyny.gov",        phone: "631-854-1600", party: null },
  { district: "7",  name: "Dominick S. Thorne",    email: "DominickS.Thorne@suffolkcountyny.gov",   phone: "631-854-1400", party: "R" },
  { district: "8",  name: "Anthony A. Piccirillo", email: "Anthony.Piccirillo@suffolkcountyny.gov", phone: "631-854-9611", party: "R" },
  { district: "9",  name: "Samuel Gonzalez",       email: "Samuel.Gonzalez@suffolkcountyny.gov",    phone: "631-853-3700", party: "D" },
  { district: "10", name: "Trish Bergin",          email: "Trish.Bergin@suffolkcountyny.gov",       phone: "631-854-0940", party: "R" },
  { district: "11", name: "Steven J. Flotteron",   email: "Steven.Flotteron@suffolkcountyny.gov",   phone: "631-854-4100", party: "R" },
  { district: "12", name: "Leslie Kennedy",        email: "Leslie.Kennedy@suffolkcountyny.gov",     phone: "631-854-3735", party: "R" },
  { district: "13", name: "Salvatore Formica",     email: "Salvatore.Formica@suffolkcountyny.gov",  phone: "631-854-3900", party: "R" },
  { district: "14", name: "RJ Renna",              email: "RJ.Renna@suffolkcountyny.gov",           phone: "631-854-1100", party: "R" },
  { district: "15", name: "Jason Richberg",        email: "Jason.Richberg@suffolkcountyny.gov",     phone: "631-854-1111", party: "D" },
  { district: "16", name: "Rebecca Sanin",         email: "Rebecca.Sanin@suffolkcountyny.gov",      phone: "631-854-5100", party: "D" },
  { district: "17", name: "Tom Donnelly",          email: "Tom.Donnelly@suffolkcountyny.gov",       phone: "631-854-4433", party: "D" },
  { district: "18", name: "Stephanie Bontempi",    email: "Stephanie.Bontempi@suffolkcountyny.gov", phone: "631-854-4500", party: "R" },
];

console.log(`Seeding ${SUFFOLK_LEGISLATORS.length} Suffolk County Legislators${DRY_RUN ? " (DRY RUN)" : ""}…\n`);

let ok = 0, fail = 0, skipped = 0;

for (const l of SUFFOLK_LEGISLATORS) {
  const row = {
    state: "NY",
    full_name: l.name,
    role: "county_commissioner",
    title: `Suffolk County Legislator, District ${l.district}`,
    district: l.district,
    locality: "Suffolk County, NY",
    email: l.email,
    phone: l.phone,
    party: l.party,
    website: "https://www.scnylegislature.us/148/Legislators",
    active: true,
  };

  if (DRY_RUN) {
    console.log(`  [DRY] D${l.district.padStart(2)} · ${l.name} (${l.party ?? "?"}) → ${l.email} ${l.phone}`);
    ok++;
    continue;
  }

  // Check if a row already exists for this state + full_name + locality
  const { data: existing } = await sb
    .from("legislators")
    .select("id")
    .eq("state", "NY")
    .eq("full_name", l.name)
    .eq("locality", "Suffolk County, NY")
    .maybeSingle();

  if (existing) {
    const { error } = await sb
      .from("legislators")
      .update({
        role: row.role,
        title: row.title,
        district: row.district,
        email: row.email,
        phone: row.phone,
        party: row.party,
        website: row.website,
        active: true,
      })
      .eq("id", existing.id);
    if (error) {
      console.error(`  ✗ D${l.district} ${l.name}: ${error.message?.slice(0, 150)}`);
      fail++;
      continue;
    }
    console.log(`  ↺ D${l.district.padStart(2)} · ${l.name} (updated existing)`);
    skipped++;
    continue;
  }

  const { error } = await sb.from("legislators").insert(row);
  if (error) {
    console.error(`  ✗ D${l.district} ${l.name}: ${error.message?.slice(0, 150)}`);
    fail++;
    continue;
  }
  console.log(`  ✓ D${l.district.padStart(2)} · ${l.name} → ${l.email}`);
  ok++;
}

console.log(`\nDone. inserted=${ok}, updated=${skipped}, fail=${fail}.`);
console.log(`Admin: review at /admin/legislators?state=NY (or check via the Suffolk bill page's "Officials to contact" widget).`);
