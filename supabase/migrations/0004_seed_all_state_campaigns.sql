-- Seed: "Introduce yourself" campaign for every state (50 + DC).
-- OK already exists from 0003 (with KCPA-aware copy) — we skip it here.
-- Each campaign uses {{state}} and {{full_name}} etc. so the same template
-- personalizes per user. Status-specific variants (banned / KCPA / legal)
-- can be added later via admin.

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
)
select
  lower(s.abbr) || '-introduce-yourself' as slug,
  'Tell your ' || s.name || ' legislators kratom matters' as title,
  'A short, respectful introduction from a constituent. Builds the muscle for when a real bill drops in ' || s.name || '.' as blurb,
  E'Why this matters\n\nLegislators remember the constituents who reach out *before* a bill comes up for a vote. Once a vote is scheduled, your email is one of hundreds in their inbox that week. A message sent today, while no bill is pending, gets read — and puts your name on the radar for when one drops.\n\nThis is a relationship-building action. You''re introducing yourself as a ' || s.name || ' constituent who pays attention to kratom policy.\n\nWhat the email says\n\n• You''re a constituent (your address is included so they can verify district)\n• You support sensible regulation that keeps kratom legal for adults — the model laid out in the Kratom Consumer Protection Act\n• You ask them to oppose any bill that would ban kratom or use 7-OH alkaloid restrictions as a backdoor ban\n• You leave the door open for follow-up\n\nThe message is firm, factual, and respectful — not partisan. That''s what gets read.' as body_md,
  s.abbr as state,
  array['state_senate', 'state_house'] as target_roles,
  'Constituent input on kratom policy in ' || s.name as subject_template,
  E'Dear Senator and Representative,\n\nMy name is {{full_name}} and I am a constituent in {{city}}, {{state}} {{zip}}. I am writing to introduce myself as someone who pays attention to kratom-related legislation in our state.\n\nI support sensible regulation that keeps kratom legal for adults while ensuring quality standards and protecting minors — the model laid out in the Kratom Consumer Protection Act, which several states have adopted.\n\nI am writing now, before any specific bill comes before you, to ask three things:\n\n1. Please oppose any legislation that would ban kratom outright.\n\n2. Please be skeptical of bills that target the 7-hydroxymitragynine (7-OH) alkaloid in ways that would function as a backdoor ban on kratom as a whole.\n\n3. If kratom-related legislation does come up, please reach out to constituents like me. We are happy to share our experience and answer questions.\n\nThank you for your time and your service to {{state}}.\n\nSincerely,\n{{full_name}}\n{{street}}\n{{city}}, {{state}} {{zip}}' as body_template,
  true as active
from public.states s
where s.abbr <> 'OK'  -- OK keeps its KCPA-specific copy from 0003
on conflict (slug) do nothing;
