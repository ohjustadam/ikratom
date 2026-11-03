import { Block, Faq } from "./guide-ui";

/** The questions new members actually ask, answered in place. */
export function Troubleshooting() {
  return (
    <Block id="help" eyebrow="07 — Help" title="Common questions">
      <Faq
        items={[
          {
            q: "Do I have to connect my email?",
            a: "No. Without it, each letter opens in your own mail app, one office at a time. Connecting lets one click send to every office on the list, from your own mailbox.",
          },
          {
            q: "Can iKratom read my email?",
            a: "No. Connecting gives permission to send the letters you choose. We keep a copy of each letter you send through iKratom, so your history is accurate and nobody gets the same letter twice, and nothing else.",
          },
          {
            q: "One of my letters bounced. What happened?",
            a: "Usually an office changed its address. Officials' addresses come from their own websites and are rechecked against those pages, but they change. Forward the bounce to support@ikratom.org and we fix the address for everyone.",
          },
          {
            q: "Some officials only have a contact form. Why?",
            a: "Many offices, including most of Congress, don't publish an email address. For those, the campaign gives you a link to the office's own form and the letter to paste in.",
          },
          {
            q: "My group invite link isn't working.",
            a: "Ask the group's organizer for the link shown on the group's page right now. If that one fails too, open a ticket at /support and paste the link in.",
          },
          {
            q: "I'm not getting notifications.",
            a: "Install iKratom from /install and allow notifications when asked. On iPhone, add iKratom to your Home Screen first. Then check which alerts you chose in your notification settings.",
          },
          {
            q: "Will other members see my name?",
            a: "No. Other members only ever see your @username. Your real name appears only on the letters you send to officials.",
          },
          {
            q: "I'm a shop owner, doctor or researcher. Is there anything different for me?",
            a: "Pick that role when you sign up, and say it in the first line of every letter: a shop owner or a clinician carries real weight with legislators. The storefront kit at /spread helps a shop sign up its customers.",
          },
        ]}
      />
      <p className="text-sm">
        Still stuck? <a href="/support" className="text-emerald-400 hover:underline">Contact support</a>, or replay the tour from your dashboard.
      </p>
    </Block>
  );
}
