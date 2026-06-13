-- ============================================================
-- 0201_harden_campaign_source_url
--
-- INTENT
-- The auto-campaign Postgres trigger (auto_campaign_on_alert, 0068→0198)
-- renders a legislator-letter body in SQL via render_template_for_alert().
-- That function pasted policy_alerts.source_url verbatim into the letter's
-- "Source: {{source_url}}" line. For news-spawned alerts, source_url is a raw
-- Google-News redirect (news.google.com/rss/articles/…) because the resolver
-- (scripts/resolve-news-urls.mjs) runs in the DAILY cron while classification
-- runs HOURLY — so at alert-insert time the redirect hasn't been resolved yet.
-- Result: ugly, unprofessional Google redirects leaking into letters sent to
-- government officials (audit cited live campaign 449d76c8).
--
-- The JS classifier now stores a citation-safe URL (or null) instead of the
-- raw redirect (scripts/lib/source-url.mjs), but the trigger fires
-- synchronously on alert INSERT — so the render must ALSO be self-defending,
-- independent of when the URL gets resolved. This migration makes the render
-- function refuse Google redirects (and bare video embeds) and fall back to
-- our own clean /alerts/<id> page — exactly the owner directive: "use the
-- internal /news or the alert page, never a raw redirect."
--
-- Pure function redefinition. No schema/data change. Idempotent. Existing
-- campaign bodies are cleaned separately by scripts/clean-campaign-source-urls.mjs.
--
-- ROLLBACK: re-apply 0068's render_template_for_alert definition.
-- ============================================================

create or replace function public.render_template_for_alert(
  p_template text,
  p_alert public.policy_alerts
)
returns text
language plpgsql
immutable
as $$
declare
  v_locality_name text;
  v_alert_page text;
  v_clean_source text;
  v_source_line text;
  v_source_url text;
  v_out text;
begin
  if p_template is null then return null; end if;

  v_locality_name := case
    when p_alert.locality = 'FED' then 'the federal level'
    when p_alert.locality = 'ALL' then 'the national level'
    else p_alert.locality
  end;

  -- Our own clean, always-resolvable citation page for this alert.
  v_alert_page := 'https://www.ikratom.org/alerts/' || p_alert.id::text;

  -- A source_url is citation-safe ONLY if it's a real publisher link — never a
  -- Google-News redirect, never a bare video embed. Mirrors cleanSourceUrl()
  -- in src/lib/source-link.ts + scripts/lib/source-url.mjs.
  v_clean_source := case
    when p_alert.source_url ~* '^https?://'
     and p_alert.source_url !~* '^https?://(news\.google\.com|(www\.)?google\.com/url)'
     and p_alert.source_url !~* '/embed/'
      then p_alert.source_url
    else null
  end;

  -- Letters always get a usable link: the clean publisher URL when we have one,
  -- otherwise our internal alert page. A raw redirect can never appear.
  v_source_line := case
    when v_clean_source is not null then E'\n\nSource: ' || v_clean_source
    else E'\n\nMore detail: ' || v_alert_page
  end;
  v_source_url := coalesce(v_clean_source, v_alert_page);

  v_out := p_template;
  v_out := replace(v_out, '{{locality_name}}', v_locality_name);
  v_out := replace(v_out, '{{source_line}}', v_source_line);
  v_out := replace(v_out, '{{source_url}}', v_source_url);
  v_out := replace(v_out, '{{source_url_or_default}}', v_source_url);
  -- {{recipient_title}}, {{recipient_last_name}}, {{full_name}}, {{city}}, {{state}}
  -- are intentionally NOT replaced here — they're rendered per-recipient at
  -- mailto: build time by the existing campaigns/actions module.
  return v_out;
end;
$$;
