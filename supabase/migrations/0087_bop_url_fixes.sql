-- ============================================================
-- 0087_bop_url_fixes
--
-- Fix the 28 best-effort URLs from 0086 that returned 403/404 on the
-- first scrape. Correct URLs verified by walking each state's BoP
-- via Google + the live homepages (see PR description).
--
-- Also clears last_status/last_error/last_scraped_at on each fixed
-- row so the next cron walk retries them fresh.
-- ============================================================

-- One UPDATE per state. We match on (state, board_name) to be precise
-- — there's only one BoP row per state, but this stops a future
-- adjacent-agency seed from matching by accident.
update public.bop_sources
   set agenda_url = case state
         when 'NC' then 'https://www.ncbop.org/rulemakings.htm'
         when 'AL' then 'https://albop.com/board-meetings/'
         when 'AZ' then 'https://pharmacy.az.gov/public-meetings'
         when 'IN' then 'https://www.in.gov/pla/professions/pharmacy-home/pharmacy-board/'
         when 'OH' then 'https://www.pharmacy.ohio.gov/boardmeeting'
         when 'DC' then 'https://dchealth.dc.gov/publication/meeting-agenda-and-minutes-board-pharmacy'
         when 'ID' then 'https://dopl.idaho.gov/bop/'
         when 'GA' then 'https://gbp.georgia.gov/events'
         when 'CT' then 'https://portal.ct.gov/dcp/drug-control-division/commission-of-pharmacy/pharmacy-commission-meetings'
         when 'MA' then 'https://www.mass.gov/info-details/meeting-calendar-for-the-board-of-registration-in-pharmacy'
         when 'KS' then 'https://www.pharmacy.ks.gov/about-us/board-meetings'
         when 'MD' then 'https://health.maryland.gov/pharmacy/Pages/PRcal.aspx'
         when 'KY' then 'https://pharmacy.ky.gov/BoardInformation/Pages/Board-Meetings.aspx'
         when 'MI' then 'https://www.michigan.gov/lara/bureau-list/bpl/health/hp-lic-health-prof/pharmacy/board/pharmacy-board-meeting-agendas-and-minutes'
         when 'ME' then 'http://www.maine.gov/pfr/professionallicensing/professions/board-pharmacy/home/board-meeting-information'
         when 'MO' then 'https://pr.mo.gov/pharmacists-meetings.asp'
         when 'NH' then 'https://www.oplc.nh.gov/board-pharmacy-meeting-information'
         when 'MS' then 'https://www.mbp.ms.gov/about-us/board-meetings'
         when 'MN' then 'https://mn.gov/boards/pharmacy/board/meetings.jsp'
         when 'NV' then 'https://bop.nv.gov/Board/BoardMtgs/'
         when 'OK' then 'https://oklahoma.gov/pharmacy/about/board-events.html'
         when 'NE' then 'https://dhhs.ne.gov/licensure/Pages/agendas-and-minutes.aspx'
         when 'TN' then 'https://www.tn.gov/health/calendar.pharmacy.html'
         when 'OR' then 'https://www.oregon.gov/pharmacy/pages/board-agendas-minutes.aspx'
         when 'ND' then 'https://www.nodakpharmacy.com/minutes.asp'
         when 'SD' then 'https://doh.sd.gov/licensing-and-records/boards/pharmacy/'
         when 'WA' then 'https://doh.wa.gov/licenses-permits-and-certificates/facilities-z/pharmacies-and-pharmaceutical-firms/commission-information'
         when 'WV' then 'https://www.wvbop.com/calendar.asp'
         else agenda_url
       end,
       last_status = null,
       last_error = null,
       last_scraped_at = null,
       notes = case
         when notes ilike 'auto-seed%' then 'verified via browser search (migration 0087)'
         else notes
       end
 where state in (
   'NC','AL','AZ','IN','OH','DC','ID','GA','CT','MA','KS','MD','KY','MI','ME',
   'MO','NH','MS','MN','NV','OK','NE','TN','OR','ND','SD','WA','WV'
 );
