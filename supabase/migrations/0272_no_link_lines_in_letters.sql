-- 0272_no_link_lines_in_letters.sql
--
-- Owner call 2026-10-21: letters to officials carry no "Source:" line (nor
-- "More detail:", "Background:", "Background and platform:" or "Briefing:").
-- A link to our own alert page is not a source, and any such line reads as a
-- form-letter fingerprint. The 38 live campaigns were cleaned by hand the same
-- day; this stops the auto-campaign trigger from writing the lines again.
--
-- The trigger's templates (0068 / 0142) still contain those lines, so rather
-- than rewriting every template the renderer strips them after substitution.
-- scripts/auto-campaign-from-alert.mjs applies the same rule (stripLinkLines).
--
-- Rollback: re-apply render_template_for_alert from
-- 0201_harden_campaign_source_url.sql.

create or replace function public.render_template_for_alert(p_template text, p_alert policy_alerts)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_locality_name text;
  v_out text;
begin
  if p_template is null then return null; end if;

  v_locality_name := case
    when p_alert.locality = 'FED' then 'the federal level'
    when p_alert.locality = 'ALL' then 'the national level'
    else p_alert.locality
  end;

  v_out := p_template;
  v_out := replace(v_out, '{{locality_name}}', v_locality_name);
  v_out := replace(v_out, '{{source_line}}', '');
  v_out := replace(v_out, '{{source_url}}', '');
  v_out := replace(v_out, '{{source_url_or_default}}', '');
  -- Drop every link line, then collapse the blank lines they leave behind.
  v_out := regexp_replace(v_out, E'\\n*[ \\t]*(Source|More detail|Background and platform|Background|Briefing):[^\\n]*', '', 'g');
  v_out := regexp_replace(v_out, E'\\n{3,}', E'\n\n', 'g');
  -- {{recipient_title}}, {{recipient_last_name}}, {{full_name}}, {{city}}, {{state}}
  -- are intentionally NOT replaced here: they are rendered per recipient at
  -- send time (src/modules/campaigns/templates.ts).
  return v_out;
end;
$function$;
