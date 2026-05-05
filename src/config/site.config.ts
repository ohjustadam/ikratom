export const siteConfig = {
  name: "iKratom",
  tagline: "The advocate's toolbelt.",
  description:
    "iKratom is a nonpartisan political action platform for the kratom community. One-click legislator emails, real-time bill tracking, and tools that turn advocacy into a few minutes a day.",
  links: {
    support: "support@ikratom.app",
  },
  features: {
    forum: true,
    library: true,
    news: true,
    medicalRecruitment: false,
    aiPersonalization: false,
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
