-- ============================================================
-- 0088_bop_reclassify
--
-- The original DIRECT_RE in scripts/lib/bop-engine.mjs had a bug:
-- the 7-OH alternative `7-?(?:hydroxy)?(?:mitragynine)?` had every
-- sub-group optional, so it collapsed to "any 7 followed by optional
-- dash". Titles like "June 7-8, 2006" classified as kratom_direct.
--
-- Engine + TS twin are fixed in this PR. This migration re-classifies
-- every existing bop_findings row using PG-side regex that mirrors the
-- corrected pattern, so the admin /admin/bop-monitor view starts clean.
-- Admin-reviewed rows (reviewed_at not null) are left alone — we
-- respect human classification once it's been entered.
-- ============================================================

with reclassed as (
  select
    id,
    case
      when title ~* '\m(kratom|mitragyna\w*|7\s*-?\s*OH|7\s*-?\s*hydroxy(mitragynine)?)\M'
        then 'kratom_direct'
      when title ~* '\m(novel\s+psychoactive|emerging\s+substance|schedule\s+[IVX]+|controlled\s+substance|botanical)\M'
        then 'kratom_adjacent'
      else 'unrelated'
    end as new_relevance,
    case
      when title ~* '\m(kratom|mitragyna\w*|7\s*-?\s*OH|7\s*-?\s*hydroxy(mitragynine)?|novel\s+psychoactive|emerging\s+substance|schedule\s+[IVX]+|controlled\s+substance|botanical)\M' then
        case
          when title ~* '\m(ban|prohibit|schedule\s+[IVX]+|add\s+to\s+schedule|controlled|adulterated|emergency\s+rule)\M'
            then 'hostile_proposal'
          when title ~* '\m(consumer\s+protection|labeling|age\s+limit|standards|kcpa)\M'
            then 'supportive'
          else 'discussion_only'
        end
      else 'unknown'
    end as new_severity
  from public.bop_findings
  where reviewed_at is null  -- don't override admin-reviewed rows
)
update public.bop_findings f
   set classified_relevance = r.new_relevance,
       classified_severity = r.new_severity
  from reclassed r
 where f.id = r.id;
