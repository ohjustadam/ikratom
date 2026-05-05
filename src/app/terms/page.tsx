import { siteConfig } from "@/config/site.config";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Terms of Service</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Last updated: 2026-05-05
        </p>
      </header>

      <div className="space-y-6 text-sm leading-relaxed text-zinc-300">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">1. What this is</h2>
          <p>
            {siteConfig.name} is a free, nonpartisan political action platform for the kratom
            community. By creating an account or using the service, you agree to these terms.
            We are not affiliated with any kratom advocacy organization, vendor, or trade group.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">2. What you can do here</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>Send emails to your elected officials about kratom policy</li>
            <li>Discuss legislation, news, and strategy with other advocates</li>
            <li>Access our library of vetted educational materials</li>
            <li>Organize through encrypted direct messages and groups</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">3. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Harass, threaten, or harm any person — including legislators, officials, or other users</li>
            <li>Send unlawful, deceptive, defamatory, or threatening messages through the platform</li>
            <li>Impersonate another person or misrepresent your affiliation</li>
            <li>Spam, scrape, or abuse rate-limited features (including campaign actions)</li>
            <li>Use automated means to bypass our spam-prevention systems</li>
            <li>Violate any applicable law in your message contents or actions</li>
            <li>Sell, transfer, or share your account credentials</li>
          </ul>
          <p className="mt-3">
            We may suspend or terminate accounts that violate these rules. Repeat offenders are
            permanently banned. Severe violations (threats, illegal content, mass harassment) may
            be reported to authorities.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">4. Your messages, your responsibility</h2>
          <p>
            When you send an email through {siteConfig.name}, the message comes from your own email
            address. <strong>You are the author and the sender.</strong> {siteConfig.name} does not
            review, approve, or filter the contents of constituent emails. We provide templates and
            recipient lookup, but the words and the act of sending are yours.
          </p>
          <p className="mt-2">
            Direct messages between users are end-to-end encrypted. We cannot read them and cannot
            moderate their content. If a user reports harassment, we can review metadata (who messaged
            whom, when) but not message bodies. Block features are available to all users.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">5. No warranty, no liability</h2>
          <p>
            {siteConfig.name} is provided <strong>"as is"</strong> with no warranties of any kind.
            Legislator contact information is synced from public sources (OpenStates, congress-legislators,
            Census, Gemini); we do our best to keep it current but cannot guarantee accuracy. Bill
            tracking, news scraping, and AI summaries are provided for informational purposes only and
            should not be relied on as legal advice.
          </p>
          <p className="mt-2">
            To the maximum extent permitted by law, {siteConfig.name} and its operators are not liable
            for any indirect, incidental, or consequential damages arising from your use of the service.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">6. Account termination + your right to leave</h2>
          <p>
            You can delete your account at any time from <a href="/account" className="text-emerald-400 hover:underline">/account</a>.
            Deletion is immediate and removes your profile, messages, threads, and campaign action
            history. You can also export your data first if you want a copy.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">7. Changes to these terms</h2>
          <p>
            We may update these terms occasionally. We&apos;ll notify active users in-app at least 30
            days before material changes take effect. Continued use after that constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">8. Contact</h2>
          <p>
            Questions, bugs, abuse reports:{" "}
            <a href={`mailto:${siteConfig.links.support}`} className="text-emerald-400 hover:underline">
              {siteConfig.links.support}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
