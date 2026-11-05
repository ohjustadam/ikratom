import { Block, ListBox } from "./guide-ui";

/** Privacy, how the platform protects members, and how to write letters that work. */
export function SafetyGuide() {
  return (
    <>
      <Block id="safety" eyebrow="05 — Privacy and safety" title="You stay anonymous to everyone but your own officials">
        <ul className="space-y-3 text-sm">
          {[
            ["@username only.", "In chat, the forum, groups, profiles and messages, other members see your @username. Never your real name, never your email."],
            ["Your address is private.", "It matches you to your officials and is never shown to anyone. Change or remove it in your account at any time."],
            ["Letters go out as you.", "A letter to an official carries your real name and city, because that is what makes you a constituent. It is sent from your own mailbox, not from iKratom."],
            ["Private messages are end-to-end encrypted.", "The keys live on your device. Not even iKratom can read them."],
            ["Two-step sign-in.", "Turn on an authenticator app in your account's security settings so a stolen password is not enough."],
            ["If you live where kratom is banned,", "safe mode keeps your home state out of letters you send to officials in other states."],
          ].map(([lead, rest]) => (
            <li key={lead} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <strong className="text-zinc-100">{lead}</strong> {rest}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          iKratom is independent and nonpartisan. It is not run by any vendor or advocacy organization, and it carries no vendor advertising. Letters are screened before they leave, every post can be reported, and moderators review what is flagged. The full policy is in{" "}
          <a href="/privacy" className="text-emerald-400 hover:underline">our privacy policy</a>.
        </p>
      </Block>

      <Block id="practice" eyebrow="06 — How to actually move legislators" title="Good practice, and what to avoid">
        <div className="grid gap-5 lg:grid-cols-2">
          <ListBox
            tone="good"
            title="✅ Do"
            items={[
              "Open with one personal sentence: who you are, where you live, why kratom matters to you.",
              "Make one specific ask: \"Please vote no on HB 1234.\"",
              "Write to your own officials. Your address is your authority.",
              "Tell your story. Legislators remember people, not statistics.",
              "Email and call. Offices tally calls separately.",
              "When a staffer replies, thank them. A relationship outlasts one letter.",
              "Act with your group in the same week, so the messages land together.",
            ]}
          />
          <ListBox
            tone="bad"
            title="❌ Don't"
            items={[
              "Send the template untouched. Offices filter identical letters as form mail.",
              "Make demands with no bill number and no ask.",
              "Attack an official, their staff or their family, even jokingly.",
              "Write to another state's officials as if you lived there.",
              "Write the same office again and again in one week.",
              "Mention a shop, a brand or a product. It reads as an advert and hurts everyone.",
              "Repeat a claim you can't source. Pro-kratom misinformation discredits the cause too.",
            ]}
          />
        </div>
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">⚠ These get an account banned</p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-200">
            <li>· More than one account per person, or operating other people&apos;s identities</li>
            <li>· Threats, harassment or doxxing of anyone, including officials and their staff</li>
            <li>· Vendor advertising in letters, posts, groups or messages</li>
            <li>· False stories or invented medical claims</li>
            <li>· Bots, scraping, or automating actions</li>
            <li>· Sharing anyone&apos;s private information, especially a minor&apos;s</li>
          </ul>
        </div>
        <p className="text-sm">
          A hundred real constituents writing one good letter each beats a thousand copies. That is what made the DEA withdraw its 2016 plan to schedule kratom, and it is what works now.
        </p>
      </Block>
    </>
  );
}
