# Values & operating principles

The non-negotiable beliefs that shape every decision. When two options
look equivalent on engineering merit, pick the one that better honors
these values.

---

## Communication is the weapon

> "Good communication is the key to any spec ops or any other unit and/or companies, families... good communication. Transparent communication. Being open and honest in our platform is key."

The platform exists because the kratom community is **disorganized in
the worst sense** — many voices, no shared signal. Every feature should
either:

1. **Reduce signal-to-noise** — auto-classify bills, group similar
   actions, surface what matters, suppress what doesn't.
2. **Speed up coordination** — push notifications, realtime chat,
   audit trails so people know what's been done.
3. **Make the act of speaking up effortless** — one-click sends,
   prefilled templates, voice rooms, mass-share buttons.

If a feature doesn't measurably help one of these three, it's a
distraction.

---

## Democratic weapon of agency

> "We are a democratic weapon of agency."

We're not a campaign organization. We're not a lobbying group. We're
not a vendor association. **We're infrastructure for individual
people to wield democratic power.**

This means:
- We never speak for the user. They send their own emails, with their
  own voice, from their own account.
- We never take a partisan position. Bill X being hostile is a fact
  about its text, not a political opinion.
- We never gate participation. Free tier, public data, no membership
  fees, no required org affiliation.
- We never moderate ideology — only behavior (spam, harassment).

When tempted to add a feature that "speaks for the community" or "takes
a position," ask: who decided that's the community's position? If it's
not 100% of advocates, it's not ours to declare.

---

## Aesthetic: cockpit over dashboard

The user experience should feel like **strapping into a fighter jet
cockpit**. Not driving a car. Not browsing a website.

Concretely:
- **Information density** — heads-up display, multiple data streams visible at once
- **Real-time feel** — pulsing presence dots, live counters, activity tickers
- **Mission framing** — "Strike team," "war room," "intel," "deploy"
- **Calm under pressure** — colors that don't panic, typography that reads fast, feedback that's instant
- **Status awareness** — at any moment the user should be able to glance at a screen and know: what's hostile, what's friendly, what needs them now, what's been handled

Anti-patterns:
- Generic "engage with our community" SaaS aesthetic
- Marketing-style hero pages with stock photos
- Pop-ups, modals, or anything that interrupts decision-making
- Animation-for-animation's-sake

---

## Recruitment as core feature

> "Shop owners and medical professionals are first-class users — features should make it easy for them to opt in to advocacy."

Plus:
> "Especially since we are welcoming in farmers and distros."

Tiers we explicitly recruit:
1. **Individual advocates** — the foundation. One human, one voice.
2. **Shop owners (US retail)** — counter materials, QR codes, attribution.
3. **Discord community admins** — webhook integrations, recruitment links.
4. **SE Asian farmers + distributors** — multi-language, source-of-supply voice.
5. **Medical professionals** — verified credentials (when verifiable), amplified voice on health-policy bills.
6. **Vendor businesses** — dual-signature accounts, opt-in verification.

Each tier needs:
- A specific value-prop ("here's what you uniquely get")
- A specific onboarding flow ("here's the 5 minutes that gets you set up")
- A specific way to credit attribution ("here's how your contribution shows up")

---

## Underground network mentality

The kratom community has been failed by mainstream advocacy
organizations for two decades. Top-down political orgs are
co-opted, captured, or compromised. **The platform serves the
underground network — peer-to-peer, distributed, resilient.**

What this looks like in practice:
- Discord integrations so existing communities don't have to migrate
- Encrypted DMs so coordination can be private
- Multi-language so the supply chain isn't excluded
- Open source / well-documented so a fork is always possible
- No single point of failure (multiple email providers, multiple AI providers, multi-region DNS)
- No vendor lock-in (you can self-host, you can export your data)

If we ever feel pressure to centralize, capture, or gate-keep — that's
the signal that we've drifted from the value.

---

## Future-proofing as discipline

> "We need a design that is ahead of its time."

This shows up in:

**Technical:**
- Document every non-obvious decision in `DECISIONS.md`
- Keep `AGENTS.md` current as the cold-start brief for future engineers / AI sessions
- File-header standard explaining purpose + gotchas
- Every server action audit-logged
- Every migration includes intent + rollback notes

**Architectural:**
- Multi-provider routing (email, AI) so single-vendor failures don't take us down
- Free-tier first means we *can* operate without funding — pressure-tested
- Self-extracting docs (`npm run docs:schema`) keep the ground truth current
- Open / portable data — every table CSV-exportable

**UI:**
- Avoid TODAY'S design clichés (gradient buttons, generic Tailwind cards) when they don't serve the mission
- Aim for the visual language of mission control, not SaaS
- Density over whitespace where data is the value

**Cultural:**
- Don't worship features — worship problems solved
- The platform should feel like it was built for the next 10 years, not the current Twitter cycle

---

## When in doubt

Ask: **does this make it easier for one more person to take one more
political action they otherwise wouldn't have?**

If yes → ship it.
If no → don't.
If unclear → that's the question to answer, not just the feature spec.
