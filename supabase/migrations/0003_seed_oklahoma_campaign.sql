-- Seed: First Oklahoma campaign (introduction-style; no specific bill yet)
-- Campaigns can be created in /admin once we have specific bills tracked.

insert into public.campaigns (
  slug,
  title,
  blurb,
  body_md,
  state,
  target_roles,
  subject_template,
  body_template,
  active
) values (
  'ok-introduce-yourself',
  'Tell your Oklahoma legislators kratom matters',
  'A short, respectful introduction from a constituent who values continued legal access to kratom in Oklahoma. Builds the muscle for when a real bill drops.',
  E'Why this matters\n\nOklahoma already passed the Kratom Consumer Protection Act (KCPA), which is a win — it means quality standards, age restrictions, and consumer protection without an outright ban.\n\nBut KCPA states are still targets for repeal efforts and for harmful 7-OH legislation. The legislators who hear from constituents *before* a bill drops are the ones who remember us when one does.\n\nThis is a relationship-building action. You\'re introducing yourself as a constituent who pays attention to kratom policy. That puts your name on the radar so when the next vote comes, you\'re someone they already know.\n\nWhat the email says\n\n• You\'re a constituent (your address is included so they can verify district)\n• You support continued legal access to kratom under KCPA\n• You ask them to oppose any bill that bans kratom or restricts the 7-OH alkaloid in ways that would gut KCPA\n• You leave the door open for follow-up\n\nThe message is firm, factual, and respectful — not partisan, not aggressive. That\'s what gets read.',
  'OK',
  array['state_senate', 'state_house'],
  'Constituent input on kratom policy in Oklahoma',
  E'Dear Senator and Representative,\n\nMy name is {{full_name}} and I am a constituent in {{city}}, {{state}} {{zip}}. I am writing to introduce myself as someone who pays attention to kratom-related legislation in Oklahoma.\n\nI strongly support Oklahoma\'s Kratom Consumer Protection Act, which strikes the right balance — it sets quality standards, protects minors, and keeps kratom legal for adults who use it responsibly. It is a model other states should follow.\n\nI am writing now, before any specific bill comes before you, to ask three things:\n\n1. Please oppose any future legislation that would ban kratom outright or repeal Oklahoma\'s KCPA.\n\n2. Please be skeptical of bills that target the 7-hydroxymitragynine (7-OH) alkaloid in ways that would gut the protections KCPA provides. Targeting a single alkaloid often functions as a backdoor ban.\n\n3. If kratom-related legislation does come up, please reach out to constituents like me. We are happy to share our experience and answer questions.\n\nThank you for your time and your service to Oklahoma.\n\nSincerely,\n{{full_name}}\n{{street}}\n{{city}}, {{state}} {{zip}}',
  true
)
on conflict (slug) do update set
  title = excluded.title,
  blurb = excluded.blurb,
  body_md = excluded.body_md,
  state = excluded.state,
  target_roles = excluded.target_roles,
  subject_template = excluded.subject_template,
  body_template = excluded.body_template,
  active = excluded.active;
