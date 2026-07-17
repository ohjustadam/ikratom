/**
 * Static service-status banner — code-committed, ZERO runtime dependencies.
 *
 * Unlike EmergencyBanner (DB-driven via site_config.emergency_mode), this one
 * renders even when the database itself is unreachable — which is exactly when
 * you need it (born during the 2026-07-16 Supabase egress restriction, when the
 * DB-driven banner could not be turned on because the DB was the outage).
 *
 * To change: edit this file and merge — one-line flip of `enabled`.
 * (This comment line also serves as a cache-busting touch: a fresh commit
 * forces Vercel to re-bake NEXT_PUBLIC_* env values into the client bundle.)
 * Keep the DB-driven EmergencyBanner for everything short of a DB outage.
 */
export const statusBanner = {
  enabled: false,
  title: "We're working through a technical issue",
  body:
    "Some features may be temporarily unavailable while we restore service. " +
    "Your account and all your data are safe. Thank you for your patience and understanding 💚",
} as const;
