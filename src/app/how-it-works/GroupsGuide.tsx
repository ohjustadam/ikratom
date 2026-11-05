import { Block, Note, Steps } from "./guide-ui";

/** Groups and recruiting: start one, bring people in, act together. */
export function GroupsGuide() {
  return (
    <Block id="groups" eyebrow="04 — Groups and recruiting" title="Bring your people with you">
      <p>
        A group is a home for your team: a Facebook group, a shop&apos;s regulars, a support circle, or a few friends in one county. Groups are free, and anyone can start one.
      </p>
      <Steps
        items={[
          {
            title: "Start a group",
            body: "Give it a name and a short description. You become its organizer.",
            href: "/coalitions/new",
            cta: "Start a group",
          },
          {
            title: "Get your invite link and QR code",
            body: "On the group's page, tap Show the group link + QR code. It is one link for everyone: paste it into Facebook, a text or an email, or print the QR code. New people create their account first and land straight in your group.",
            tip: "Turn on member sharing and every member can pass the same link on. You get referral credit for each person who joins.",
          },
          {
            title: "Pick this week's group action",
            body: "Choose one live campaign for everyone to act on together. The group sees how many have acted, never who has or hasn't.",
          },
          {
            title: "Keep the team together",
            body: "Use the group chat and discussion, post events, and keep a shelf of resources: the talking points, the hearing date, the phone numbers.",
          },
        ]}
      />
      <Note>
        <strong>Own a shop?</strong> The free storefront kit gives you a printable QR poster for your counter, so customers can sign up and write their legislators while they wait.{" "}
        <a href="/spread" className="text-emerald-400 hover:underline">Get the storefront kit →</a>
      </Note>
      <Note>
        <strong>Inviting one person?</strong> Use your personal invite link at the bottom of this page. Anyone who joins through it is credited to you.
      </Note>
    </Block>
  );
}
