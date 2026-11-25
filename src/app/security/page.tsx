import { siteConfig } from "@/config/site.config";

export const metadata = {
  alternates: { canonical: "/security" },
  title: "Security",
  description: "What iKratom protects for you, what you can do, and how to report a problem.",
};

// Plain words about WHAT we protect, never HOW. Do not add detail about our
// defenses here: this page is public. The how lives in SECURITY.md (code-level)
// and private/ (anything operational).
export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Security</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: 2026-11-25</p>
      </header>

      <div className="space-y-6 text-sm leading-relaxed text-zinc-300">
        <section className="rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
          <h2 className="mb-2 text-lg font-semibold text-emerald-300">In short</h2>
          <p>
            You should be able to speak up for something you care about without handing over more
            than you have to. This page says what we look after and what you can do. We keep how
            our protections work to ourselves, so they keep working.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">What we look after</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Your account.</strong> Every page and every sign-in travels over an encrypted
              connection, and you can switch on two-step sign-in with an authenticator app.
            </li>
            <li>
              <strong>Your private messages.</strong> Direct messages are scrambled on your device
              before they leave it. We cannot read them.
            </li>
            <li>
              <strong>Who you are.</strong> Other members see your @username only. Your name, email
              and address are not shown to other members.
            </li>
            <li>
              <strong>Your own mailbox.</strong> Letters to officials go out from your email, not
              ours. Connecting Gmail uses Google&apos;s own sign-in, so we never see your Google
              password, and you can disconnect your mailbox from your account at any time.
            </li>
            <li>
              <strong>Your information.</strong> We do not sell it, show ads or use advertising
              trackers. The details are in the{" "}
              <a href="/privacy" className="text-emerald-400 hover:underline">Privacy Policy</a>{" "}
              and the{" "}
              <a href="/cookies" className="text-emerald-400 hover:underline">Cookie Policy</a>.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">What you can do</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>Use a password you use nowhere else, and turn on two-step sign-in in your account.</li>
            <li>
              Nobody at iKratom will ever ask you for your password, by email or by message. If
              someone does, it is not us.
            </li>
            <li>Sign out on a shared or public device.</li>
            <li>Check the address in your browser says <span className="font-mono">www.ikratom.org</span> before you sign in.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">Found a problem?</h2>
          <p>
            Tell us at{" "}
            <a href={`mailto:${siteConfig.links.support}?subject=Security`} className="text-emerald-400 hover:underline">
              {siteConfig.links.support}
            </a>{" "}
            with &ldquo;Security&rdquo; in the subject. Say what you saw, where, and how we can see
            it too. We read every report, reply, and credit you if you would like that.
          </p>
          <p className="mt-3">To keep everyone safe while you look, please:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Do not open or change other members&apos; data.</li>
            <li>Do not run automated scans against sign-in or the site&apos;s data endpoints.</li>
            <li>Do not do anything that slows the site down for others.</li>
            <li>Give us reasonable time to fix it before you share it publicly.</li>
          </ul>
          <p className="mt-3 text-zinc-400">
            The same details for security tools are at{" "}
            <a href="/.well-known/security.txt" className="text-emerald-400 hover:underline">
              /.well-known/security.txt
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
