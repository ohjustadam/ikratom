import Link from "@/components/Link";
import { SmartLinkBox } from "@/components/link-box/SmartLinkBox";
import { Checklist, type Step } from "./Checklist";

export const metadata = {
  title: "Add news and campaigns, step by step",
  alternates: { canonical: "/how-it-works/for-leaders/walkthrough" },
};

/**
 * The walkthrough for leaders and admins (owner ask 2026-11-25): how to add
 * news and campaigns, written for people who are not technical. The smart
 * link box is the easy path, so it is step one and sits right on the page.
 * Linked from the leader playbook, the leader tour, and a first-visit hint on
 * the admin campaign and intel screens (WalkthroughHint). Keep it in step
 * with docs/RUNBOOK_owner_ops.md.
 */
const SHARE: Step[] = [
  { id: "share-find", text: "Find the story: a newspaper article, a city council agenda, a TV news page or a state legislature page." },
  {
    id: "share-copy",
    text: "Copy its link.",
    tip: "On a phone: tap Share, then Copy link. On a computer: click the address bar at the top of the page, then press Ctrl+C (Cmd+C on a Mac).",
  },
  {
    id: "share-paste",
    text: "Paste the link in the box below and press Share it.",
    tip: "The same box is on your dashboard. On a phone you can also tap Share in any app and pick iKratom. On Android, press and hold the iKratom icon and pick Share a link.",
  },
  {
    id: "share-read",
    text: "Read the answer. \"We already have this\" shows the story and any letter you can send now. \"Thanks! It's new\" means you're done: a moderator checks it, usually within a few hours.",
    tip: "If it says it couldn't find anything about kratom and you know it is about kratom, use the full form instead.",
    href: "/alerts/submit?details=1#details",
    linkLabel: "The full form",
  },
];

const CAMPAIGN: Step[] = [
  { id: "camp-open", text: "Open New campaign.", href: "/admin/campaigns/new", linkLabel: "New campaign" },
  {
    id: "camp-basics",
    text: "Basics: write a short title and a one-line reason.",
    tip: "Example: \"Tell Tulsa's council to vote no on the kratom ban.\" If it's about a bill, put the bill number in the title.",
  },
  {
    id: "camp-who",
    text: "Where + Who: pick Federal, State or Local, then the place, then who gets the letter.",
    tip: "State senators and representatives, members of Congress, or city and county officials.",
  },
  {
    id: "camp-letter",
    text: "Message: write the subject and the letter. Keep it short and polite.",
    tip: "{{full_name}}, {{city}} and {{legislator_name}} fill in with each member's own details. Never name a party or attack a person.",
  },
  { id: "camp-submit", text: "Press Create campaign. An admin checks it. Once it's approved it goes live and the members it fits are told." },
  {
    id: "camp-wave",
    text: "Optional: when it's live, schedule a wave so everyone sends in the same hour.",
    href: "/admin/campaigns",
    linkLabel: "Your campaigns",
  },
];

const REVIEW: Step[] = [
  {
    id: "rev-queue",
    text: "Open the Intel queue. The newest tips are on top.",
    tip: "A blue 🔗 line means a member shared it with the link box, and shows what the AI thought of it.",
    href: "/admin/intel-queue",
    linkLabel: "Intel queue",
  },
  { id: "rev-check", text: "Open the source link and check three things: it's about kratom, it's real news (not an ad or a rumor), and the state is right." },
  { id: "rev-severity", text: "Set how urgent it is: Watch, Alert, or Critical for a vote or deadline in the next two weeks." },
  {
    id: "rev-action",
    text: "Tick \"Action required\" only when there's a vote, hearing, comment period or bill people can still change.",
    tip: "Ticking it starts a campaign draft when you approve. The draft is checked like any other before it goes live.",
  },
  { id: "rev-decide", text: "Press Approve + publish, or Reject. Both can be undone." },
  {
    id: "rev-drafts",
    text: "Open Campaigns awaiting review. A draft marked \"🔗 link box · needs a person\" was started from a member's link.",
    tip: "The automatic approvers never touch these drafts. Only a person can publish one.",
    href: "/admin/campaigns/pending",
    linkLabel: "Campaigns awaiting review",
  },
  { id: "rev-draft-check", text: "Before you approve a draft: open the bill and check it's still moving, read the letter, and check who it goes to. Approving tells every member it fits." },
];

export default function WalkthroughPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/how-it-works/for-leaders" className="text-base text-zinc-400 hover:text-emerald-400">← Leader playbook</Link>
      <h1 className="mt-3 text-4xl font-bold leading-tight">Add news and campaigns, step by step</h1>
      <p className="mt-3 text-lg text-zinc-300">
        A plain walkthrough for leaders and admins. Tick each step as you go. Your ticks are saved on this device only.
      </p>

      <Part n={1} title="The easy way: share a link" who="Everyone, leaders included">
        <Checklist steps={SHARE} />
        <div className="mt-5"><SmartLinkBox compact heading="Try it here" /></div>
      </Part>

      <Part n={2} title="Write a campaign yourself" who="Leaders and admins">
        <Checklist steps={CAMPAIGN} />
      </Part>

      <Part n={3} title="Review what members shared" who="Admins and moderators">
        <Checklist steps={REVIEW} />
      </Part>

      <p className="mt-10 text-lg text-zinc-300">
        Stuck on a step? <Link href="/feedback" className="font-semibold text-emerald-300 underline underline-offset-4">Send us a note</Link> and say which one.
      </p>
    </div>
  );
}

function Part({ n, title, who, children }: { n: number; title: string; who: string; children: React.ReactNode }) {
  return (
    <section id={`part-${n}`} className="mt-10 scroll-mt-20">
      <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">Part {n} · {who}</p>
      <h2 className="mt-1 text-2xl font-bold text-zinc-50">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
