-- 0142 — Neutral campaign templates + bill_id anchor guard for auto-campaign trigger.
--
-- Owner directive 2026-05-14:
--   1. 'our templates should NOT infer any user is against kratom OR 7oh.
--      ...the idea is neutrality.'
--   2. 'we shouldnt be creating campaigns to call gov officials just
--      because a news article. there should be something actionablly
--      happening.'
--
-- Two changes:
--
-- A) Replace the 4 campaign_templates rows seeded by migration 0068.
--    The OLD copy asserted user positions like 'I support enforcement
--    against 7-hydroxymitragynine-enriched...products' and 'we oppose
--    conflating...' — that bakes a stance into every auto-generated
--    campaign. The NEW copy asks legislators to (a) name which products
--    are within scope, (b) cite evidence, (c) make process transparent —
--    taking no position on whether the underlying restriction is correct.
--    Users with an explicit profile stance can opt into a stance-specific
--    variant later via campaign editor; this default is neutral.
--
-- B) Update the auto_campaign_on_alert trigger function to skip alerts
--    that lack a bill_id AND aren't of an explicitly-actionable kind
--    (bop_hearing / ag_enforcement / fda_action / dea_action). The pre-fix
--    trigger would create a campaign for any approved alert with
--    action_required=true, including generic news-break alerts about
--    other-state events — producing 200+ duplicate cross-state campaigns
--    that the admin had to manually reject. These have already been bulk-
--    rejected; this guard prevents recurrence.
--
-- Rollback:
--   - The trigger function can be restored from 0068 verbatim.
--   - Template restoration requires manual UPDATE per row (no DOWN script).

-- ============================================================
-- A) Replace templates with neutral copy
-- ============================================================
delete from public.campaign_templates
 where subject_template like 'Re: kratom-related ordinance in {{locality_name}} %'
    or subject_template like 'Public comment on kratom-related agenda item %'
    or subject_template like 'Concern about scope of kratom enforcement %'
    or subject_template like 'Kratom policy in {{locality_name}} %';

insert into public.campaign_templates (alert_kind, title_match, priority, subject_template, body_template) values

-- City ordinance (bill_event w/ "city" in title) — highest priority
('bill_event', '%city%', 100,
 'Re: kratom ordinance in {{locality_name}} — please clarify scope',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing as a constituent regarding the recent kratom-related ordinance activity in {{locality_name}}.\n\n' ||
 E'Kratom is not a single substance. Policy language often refers to it as one thing, but the science and the marketplace recognize at least five distinct classes:\n' ||
 E'- Natural leaf kratom (the unmodified plant)\n' ||
 E'- Mitragynine (the dominant natural alkaloid)\n' ||
 E'- 7-hydroxymitragynine (a trace natural alkaloid often concentrated or isolated in modern products)\n' ||
 E'- Mitragynine pseudoindoxyl (an oxidation metabolite)\n' ||
 E'- Synthetic / semi-synthetic alkaloid analogues\n\n' ||
 E'Each has a different pharmacology, history of use, and risk profile. Policy that treats them as identical can either over-restrict (capturing traditional plant use that has decades of relatively safe consumption data) or under-restrict (leaving concentrated or synthetic products under-regulated).\n\n' ||
 E'I respectfully ask that any local action explicitly state which of these classes it targets, what testing or labeling standards apply, and what public process led to the decision.\n\n' ||
 E'Background and platform: https://www.ikratom.org{{source_line}}\n\n' ||
 E'Thank you for your time.\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

-- BoP hearing
('bop_hearing', null, 90,
 'Public comment on kratom-related agenda item — {{locality_name}} Board of Pharmacy',
 E'Dear Board members,\n\n' ||
 E'I submit this public comment regarding kratom-related items on the upcoming agenda.\n\n' ||
 E'I respectfully ask the Board to make explicit which products are within scope of any proposed action. Kratom-related products on the US market today include the natural leaf, mitragynine, 7-hydroxymitragynine in concentrated form, mitragynine pseudoindoxyl, and synthetic / semi-synthetic alkaloid analogues. These differ in pharmacology, history, and risk.\n\n' ||
 E'Whichever direction the Board chooses, I ask that the rule:\n' ||
 E'- Name the specific compounds and product forms being addressed\n' ||
 E'- Cite the evidence underlying that scope\n' ||
 E'- Make the rationale and public process publicly available\n\n' ||
 E'Source: {{source_url_or_default}}\nBackground: https://www.ikratom.org\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

-- AG enforcement
('ag_enforcement', null, 80,
 'Kratom enforcement in {{locality_name}} — request for scope clarification',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing regarding the recent kratom-related enforcement action in {{locality_name}}.\n\n' ||
 E'I respectfully request that the agency clarify exactly which products and compounds the enforcement covers. "Kratom" as a category includes the natural leaf, mitragynine, 7-hydroxymitragynine in concentrated forms, mitragynine pseudoindoxyl, and synthetic analogues — each pharmacologically distinct. Enforcement language that does not specify which of these is in scope creates regulatory uncertainty for consumers, retailers, and downstream policy.\n\n' ||
 E'I take no position in this letter on whether the underlying restriction is correct — I am asking for clarity on what it actually covers, the evidence supporting that scope, and how it was decided.\n\n' ||
 E'Source: {{source_url}}\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

-- FDA action
('fda_action', null, 80,
 'Kratom enforcement in {{locality_name}} — request for scope clarification',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing regarding the recent kratom-related FDA action affecting {{locality_name}}.\n\n' ||
 E'I respectfully request the FDA clarify which specific kratom products and compounds the action covers. The category includes natural leaf, mitragynine, 7-hydroxymitragynine in concentrated forms, mitragynine pseudoindoxyl, and synthetic analogues — each pharmacologically distinct and used differently. Language that does not specify scope creates downstream regulatory uncertainty across states.\n\n' ||
 E'I take no position in this letter on the underlying restriction — I am asking that the agency make the scope, evidence, and rationale public.\n\n' ||
 E'Source: {{source_url}}\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

-- DEA action
('dea_action', null, 80,
 'Kratom enforcement in {{locality_name}} — request for scope clarification',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing regarding the recent kratom-related DEA action affecting {{locality_name}}.\n\n' ||
 E'I respectfully request the agency clarify exactly which compounds and product forms are within scope. The category labeled "kratom" includes natural leaf, mitragynine, 7-hydroxymitragynine in concentrated forms, mitragynine pseudoindoxyl, and synthetic alkaloid analogues, each distinct in pharmacology and risk.\n\n' ||
 E'I take no position in this letter on the underlying scheduling — I ask that the action be specific about scope, cite its evidence, and make the rationale publicly available.\n\n' ||
 E'Source: {{source_url}}\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

-- Default fallback (alert_kind null) — generic state/news event
(null, null, 0,
 'Kratom policy in {{locality_name}} — request for evidence-based scope',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing as a constituent regarding recent kratom-related policy activity in {{locality_name}}.\n\n' ||
 E'Effective kratom policy depends on which products it targets. "Kratom" today refers to a family of products with significantly different chemistry: natural leaf, mitragynine, 7-hydroxymitragynine (as a trace natural alkaloid AND as a concentrated product), pseudoindoxyl, and synthetic / semi-synthetic analogues. The right policy may differ for each.\n\n' ||
 E'I respectfully ask that any legislation:\n' ||
 E'- State the specific compounds and product classes within scope\n' ||
 E'- Cite the evidence base for the chosen approach\n' ||
 E'- Allow a transparent comment period and recorded vote\n\n' ||
 E'I''m not writing to tell you which way to vote. I''m writing to ask that the decision rest on a clear factual record so constituents can evaluate it on its merits.\n\n' ||
 E'Source: {{source_url}}\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}');

-- ============================================================
-- B) Trigger guard: require bill_id OR explicitly-actionable kind
-- ============================================================
create or replace function public.auto_campaign_on_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_targets record;
  v_tpl public.campaign_templates;
  v_subject text;
  v_body text;
  v_blurb text;
  v_state text;
  v_slug text;
  v_campaign_id uuid;
begin
  -- Only fire when the alert is approved + actionable + has no campaign yet.
  if new.moderation_status <> 'approved' then return new; end if;
  if new.action_required <> true then return new; end if;
  if new.campaign_id is not null then return new; end if;

  -- 2026-05-14 guard: campaigns need a concrete anchor. Either a bill_id
  -- (legislation actively moving) or an alert kind that IS itself the
  -- action (board hearing, AG enforcement, FDA/DEA action). Otherwise the
  -- trigger generated cross-state duplicate campaigns from every news
  -- headline, producing 200+ noise rows in the admin queue.
  if new.bill_id is null and new.kind not in ('bop_hearing', 'ag_enforcement', 'fda_action', 'dea_action') then
    return new;
  end if;

  -- On UPDATE, only fire when one of the trigger predicates *flipped* —
  -- otherwise editing an alert's body would re-fire and create dupes.
  if tg_op = 'UPDATE' then
    if old.moderation_status = 'approved'
       and old.action_required = true
       and old.campaign_id is null
    then
      return new;
    end if;
  end if;

  -- Pick targets + template
  select * into v_targets from public.pick_targets_for_alert(new);
  v_tpl := public.pick_template_for_alert(new);
  if v_tpl.subject_template is null then
    raise warning 'auto_campaign_on_alert: no template found for alert % (kind=%)', new.id, new.kind;
    return new;
  end if;

  v_subject := public.render_template_for_alert(v_tpl.subject_template, new);
  v_body := public.render_template_for_alert(v_tpl.body_template, new);
  v_blurb := left(coalesce(split_part(new.body, E'\n', 1), ''), 260);
  v_state := case when new.locality ~ '^[A-Z]{2}$' then new.locality else null end;
  v_slug := public.build_alert_campaign_slug(new);

  insert into public.campaigns (
    slug, state, title, blurb,
    subject_template, body_template,
    target_legislator_ids, target_roles, target_locality,
    mobilization_type, allow_non_residents, auto_generated,
    review_state, active,
    starts_at, ends_at,
    ai_personalize
  ) values (
    v_slug, v_state, left(new.title, 200), nullif(v_blurb, ''),
    left(v_subject, 998), v_body,
    case when array_length(v_targets.target_legislator_ids, 1) > 0
         then v_targets.target_legislator_ids else null end,
    case when array_length(v_targets.target_roles, 1) > 0
         then v_targets.target_roles else null end,
    v_targets.target_locality,
    'solidarity', true, true,
    'pending_review', false,
    now(), new.expires_at,
    false
  )
  returning id into v_campaign_id;

  new.campaign_id := v_campaign_id;
  return new;
exception
  when unique_violation then
    raise warning 'auto_campaign_on_alert: slug collision for alert %, skipping', new.id;
    return new;
  when others then
    raise warning 'auto_campaign_on_alert failed for alert %: %', new.id, sqlerrm;
    return new;
end;
$$;
