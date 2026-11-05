import { Block, Note, Steps } from "./guide-ui";

/** The first session, in order, and the two-minute daily routine after it. */
export function QuickStart() {
  return (
    <>
      <Block id="start" eyebrow="01 — Your first ten minutes" title="Set up once, then every action is one click">
        <Steps
          items={[
            {
              title: "Create your free account",
              body: "Pick a username. That @username is the only name other members ever see, everywhere on the site.",
              href: "/signup",
              cta: "Sign up",
            },
            {
              title: "Answer the short welcome questions",
              body: "Who you are (consumer, shop owner, medical professional, family, veteran, researcher or leader), your address, what you would lose if kratom were banned, and which alerts you want. Your address is private: it only matches you to the officials who represent you, from Congress down to your city council.",
              tip: "Shop owners and medical professionals carry extra weight with legislators. Pick that role here, and say it in the first line of your letters.",
            },
            {
              title: "Connect your email (optional, and the biggest time saver)",
              body: "In your account settings, connect Gmail or Outlook with one click, or Yahoo, AOL or iCloud with an app password. Letters then go out from your own mailbox, under your own name, and land in your Sent folder. Without it you can still send each letter from your own mail app, one office at a time.",
              href: "/account",
              cta: "Open account settings",
            },
            {
              title: "Take your first campaign action",
              body: "Open a campaign for your state. The letter is already written and addressed to your officials. Tap ✨ Personalize with my story to have it rewritten around your own words, read it, then send. One click reaches every office on the list.",
              href: "/campaigns",
              cta: "See campaigns",
              tip: "Each campaign keeps a list of who you wrote and when, and never lets you write the same office twice for one campaign.",
            },
            {
              title: "Install the app and turn on notifications",
              body: "iKratom installs from the browser on iPhone, Android and PC, with no app store. Turn on notifications so you hear about a bill or a hearing in your area the day it appears.",
              href: "/install",
              cta: "Install the app",
              tip: "On iPhone, notifications only work after you add iKratom to your Home Screen.",
            },
          ]}
        />
      </Block>

      <Block id="daily" eyebrow="02 — Two minutes a day" title="The routine that moves legislators">
        <Steps
          items={[
            { title: "Check your dashboard", body: "It shows what changed in your state since yesterday: new bills, open campaigns, alerts and deadlines.", href: "/dashboard", cta: "Open dashboard" },
            { title: "Act on anything new", body: "Send the open campaign, or make a call: the call tool gives you the number and a short script, and you log the call when you hang up.", href: "/calls", cta: "Make a call" },
            { title: "Pass it on", body: "Share the campaign with your group or your Facebook group. One shared link can bring in ten more letters.", href: "/coalitions", cta: "Your groups" },
          ]}
        />
        <Note>
          Your action streak grows each day you take at least one action. Missing a day is fine. Letters from real constituents, spread out over time, are what count.
        </Note>
      </Block>
    </>
  );
}
