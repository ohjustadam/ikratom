-- ============================================================
-- 0093_bop_reclassify_v2
--
-- The classifier tightening in this PR drops bare "controlled
-- substance" / "schedule [IVX]+" matches that were firing on every
-- generic state pharmacy license + permit page (false-positive
-- adjacent findings). Reality check from prod: live /bop-watch
-- surfaced one real RI Kratom Licensing direct match (good!) and
-- seven generic license-page adjacents (noise).
--
-- This migration re-runs classification on every unreviewed
-- bop_findings row using the new (tighter) regexes via PG-side
-- patterns that mirror the JS. Reviewed rows are left alone.
-- ============================================================

with reclassed as (
  select
    id,
    case
      when title ~* '\m(kratom|mitragyna\w*|7\s*-?\s*OH|7\s*-?\s*hydroxy(mitragynine)?)\M'
        then 'kratom_direct'
      when title ~* '\m(novel\s+psychoactive\s+substance|emerging\s+(drug|substance)|scheduling\s+petition|new\s+controlled\s+substance|botanical\s+(medicine|substance)|herbal\s+supplement)\M'
        then 'kratom_adjacent'
      else 'unrelated'
    end as new_relevance,
    case
      when title ~* '\m(kratom|mitragyna\w*|7\s*-?\s*OH|7\s*-?\s*hydroxy(mitragynine)?|novel\s+psychoactive\s+substance|emerging\s+(drug|substance)|scheduling\s+petition|new\s+controlled\s+substance|botanical\s+(medicine|substance)|herbal\s+supplement)\M' then
        case
          when title ~* '\m(ban|prohibit|add\s+to\s+schedule|emergency\s+rule|criminaliz|adulterated|illegal\s+drug)\M'
            then 'hostile_proposal'
          when title ~* '\m(consumer\s+protection|labeling|age\s+limit|kratom\s+consumer\s+protection|kcpa)\M'
            then 'supportive'
          else 'discussion_only'
        end
      else 'unknown'
    end as new_severity
  from public.bop_findings
  where reviewed_at is null
)
update public.bop_findings f
   set classified_relevance = r.new_relevance,
       classified_severity = r.new_severity
  from reclassed r
 where f.id = r.id;
