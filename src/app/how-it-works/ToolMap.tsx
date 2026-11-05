import { Block, ToolGrid } from "./guide-ui";

/** Every tool a member has, grouped by what it is for, each card a link. */
export function ToolMap() {
  return (
    <Block id="tools" eyebrow="03 — The toolbelt" title="Everything you can do here">
      <p>
        You don&apos;t need all of this on day one. Start with campaigns and your state&apos;s page; the rest is here when you want it.
      </p>

      <ToolGrid
        heading="Take action"
        tools={[
          { icon: "✉️", name: "Campaigns", href: "/campaigns", body: "Ready-to-send letters on live bills and local ordinances, addressed to your own officials. Personalize, send, and see who you have already written." },
          { icon: "⚡", name: "Do this now", href: "/now", body: "The single most useful action for you today, picked from what is open in your state." },
          { icon: "📞", name: "Calls", href: "/calls", body: "The office number, a short script, and a log of your calls. Calls are tallied separately from email and carry weight." },
          { icon: "⏰", name: "Comment deadlines", href: "/deadlines", body: "Every open public-comment window we know of, with how many days are left." },
        ]}
      />

      <ToolGrid
        heading="Know what is happening"
        tools={[
          { icon: "🗺️", name: "Your state's page", href: "/states", body: "One page per state: the legal status, live bills, hearings, local ordinances and who represents you." },
          { icon: "📜", name: "Bill tracker", href: "/bills", body: "Every kratom and 7-OH bill in all 50 states and Congress, with a plain-English summary and status synced from official sources." },
          { icon: "🏛️", name: "Officials and their record", href: "/record", body: "What each official sponsored, voted for and said, from the record. We show facts, never ally or opponent labels." },
          { icon: "🔔", name: "Alerts and Pulse", href: "/pulse", body: "A live feed of policy signals: new bills, agency actions and local ordinances, as they are found." },
          { icon: "📰", name: "News", href: "/news", body: "Kratom news from across the country, deduplicated and sorted by state." },
          { icon: "📅", name: "Calendar", href: "/calendar", body: "Hearings, public meetings and community events you can show up to." },
        ]}
      />

      <ToolGrid
        heading="Organize"
        tools={[
          { icon: "👥", name: "Groups", href: "/coalitions", body: "Your team's home: chat, events, a shared resource shelf, and an invite link and QR code to bring people in." },
          { icon: "💬", name: "Forum and Lounge", href: "/forum", body: "A live Lounge chat at the top, a forum for every state below. Moderated, and no vendor promotion." },
          { icon: "🔒", name: "Messages", href: "/messages", body: "Private messages, end-to-end encrypted. The keys stay on your device, so not even iKratom can read them." },
          { icon: "🗣️", name: "Story bank", href: "/stories", body: "Tell what kratom means to you. Shared stories are what persuade legislators, and you choose how yours is used." },
        ]}
      />

      <ToolGrid
        heading="Learn"
        tools={[
          { icon: "🎓", name: "Academy", href: "/academy", body: "A short course on kratom, 7-OH and advocacy. Pass the exam to earn a certificate and a checkmark on your profile." },
          { icon: "📚", name: "Library", href: "/library", body: "Research, policy papers and court filings you can cite in a letter or at a hearing." },
          { icon: "🧭", name: "Glossary", href: "/glossary", body: "What KCPA, scheduling, 7-OH and the rest mean, in plain words." },
          { icon: "🆕", name: "What's new", href: "/whats-new", body: "Every change to the platform, newest first." },
        ]}
      />
    </Block>
  );
}
