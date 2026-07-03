export const siteConfig = {
  name: "iKratom",
  tagline: "The advocate's toolbelt.",
  description:
    "iKratom is a nonpartisan political action platform for the kratom community. One-click legislator emails, real-time bill tracking, and tools that turn advocacy into a few minutes a day.",
  links: {
    support: "support@ikratom.org",
  },
  features: {
    forum: true,
    library: true,
    news: true,
    medicalRecruitment: false,
    aiPersonalization: false,
    // Flip on once the daily-brief push delivery + snapshot history ships.
    // Until then the "MVP brief — coming next" teaser stays hidden from users.
    briefMvpTeaser: false,
    // Paid monthly tier. The /membership page advertises it as "coming soon"
    // while this is false; flip to true once billing actually ships.
    proSubscription: false,
    // AI Editor-in-Chief — conversational ops copilot at /admin/ai-editor
    // (free router, propose-then-confirm safe actions). Owner-gated: flip true
    // to enable the admin panel entry once you've tried it.
    adminAiChief: false,
  },
  seedStates: ["OK"],
  legislatorRoles: [
    "us_senate",
    "us_house",
    "state_senate",
    "state_house",
  ] as const,
} as const;

export type LegislatorRole = (typeof siteConfig.legislatorRoles)[number];
