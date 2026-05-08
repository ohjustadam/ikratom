-- ============================================================
-- 0066_bill_local_meta
--
-- Structured local-event metadata for city/county/town ordinances
-- that aren't pulled from LegiScan/OpenStates. Lets the bill detail
-- page render a uniform "local action playbook" — calendar buttons,
-- mailto: links, dial-in phone numbers, join URLs, public-comment
-- deadlines — regardless of how the intel originally surfaced.
--
-- Free-form jsonb because intel formats vary wildly. AI extraction
-- normalizes whatever's in policy_alerts.body into this fixed shape:
--
--   {
--     "meeting_at": "2026-05-12T17:00:00-07:00",
--     "meeting_location": "City Hall, 501 Poli St, Ventura CA",
--     "livestream_urls": [{"label": "YouTube", "url": "https://..."}, ...],
--     "remote_url": "https://us02web.zoom.us/j/...",
--     "dial_in_phone": "+1-669-900-6833",
--     "dial_in_meeting_id": "840 9556 9075",
--     "public_comment_email": "cityclerk@cityofventura.ca.gov",
--     "public_comment_form_url": "https://www.cityofventura.ca.gov/publicinput",
--     "public_comment_deadline": "2026-05-12T15:00:00-07:00",
--     "public_comment_format_notes": "1000 chars max; include Agenda Item Number in subject",
--     "agenda_item_number": "C.1",
--     "officials_to_contact": [
--       { "title": "Mayor", "name": "John Hasten", "email": "..." }
--     ]
--   }
--
-- Every key is optional; the renderer hides sections gracefully when
-- a field isn't populated.
-- ============================================================

alter table public.bills
  add column if not exists local_meta jsonb,
  add column if not exists local_meta_extracted_at timestamptz;

create index if not exists ix_bills_local_meta_meeting
  on public.bills ((local_meta ->> 'meeting_at'))
  where local_meta is not null and (local_meta ->> 'meeting_at') is not null;

comment on column public.bills.local_meta is
  'Structured local-event metadata for non-state-legislative bills (city/county ordinances, BoP hearings, etc.). Generated from policy_alerts.body by extract-local-meta.mjs. Renderer-friendly: free-form keys, every field optional.';
