-- ============================================================
-- 0086_bop_all_states
--
-- Extends migration 0085 to seed every U.S. state Board of Pharmacy
-- (plus DC). Daily cron will walk all of them; per-source error
-- isolation in the engine means a 404/timeout on any one source
-- just stamps last_status='error' for that row and moves on.
--
-- All seeded with enabled=true (the owner explicitly wants daily
-- coverage of every state). The first cron run will turn the
-- per-source last_status into either 'ok' / 'no_findings' / 'error'
-- — admin sees which need URL fixes from /admin/bop-monitor.
--
-- The original 8 seeded in 0085 are also flipped to enabled=true.
-- ============================================================

-- Flip the original 8 from 0085 on now that the engine is proven.
update public.bop_sources
   set enabled = true
 where enabled = false
   and state in ('NC','FL','AR','AL','IN','IL','AZ','OH');

-- Bulk seed every other state we don't already cover. Each row is
-- best-effort URL guess based on public BoP listings. If a URL 404s
-- after first scrape, admin fixes it in the UI — better than missing
-- coverage entirely.
insert into public.bop_sources
  (state, board_name, surface, kind, agenda_url, adapter, enabled, notes)
values
  ('AK','AK Board of Pharmacy','Board Page','agenda',
   'https://www.commerce.alaska.gov/web/cbpl/professionallicensing/boardofpharmacy.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('CA','CA State Board of Pharmacy','Meetings & News','agenda',
   'https://www.pharmacy.ca.gov/about/meetings.shtml',
   'generic_html', true, 'auto-seed; verify URL'),
  ('CO','CO State Board of Pharmacy','Board Page','agenda',
   'https://dpo.colorado.gov/Pharmacy',
   'generic_html', true, 'auto-seed; verify URL'),
  ('CT','CT Commission of Pharmacy','News','news',
   'https://portal.ct.gov/DCP/Drug-Control-Division/Drug-Control/Drug-Control-Division',
   'generic_html', true, 'auto-seed; verify URL'),
  ('DE','DE Board of Pharmacy','Meetings','meeting',
   'https://dpr.delaware.gov/boards/pharmacy/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('DC','DC Board of Pharmacy','Board Page','agenda',
   'https://dchealth.dc.gov/page/board-pharmacy-bop',
   'generic_html', true, 'auto-seed; verify URL'),
  ('GA','GA State Board of Pharmacy','Meetings','meeting',
   'https://gbp.georgia.gov/board-meetings',
   'generic_html', true, 'auto-seed; verify URL'),
  ('HI','HI Board of Pharmacy','Board Page','agenda',
   'https://cca.hawaii.gov/pvl/boards/pharmacy/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('IA','IA Board of Pharmacy','News & Meetings','meeting',
   'https://pharmacy.iowa.gov/board/board-meetings',
   'generic_html', true, 'auto-seed; verify URL'),
  ('ID','ID State Board of Pharmacy','News','news',
   'https://bop.idaho.gov/news/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('KS','KS State Board of Pharmacy','Board Page','agenda',
   'https://pharmacy.ks.gov/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('KY','KY Board of Pharmacy','Meetings','meeting',
   'https://pharmacy.ky.gov/Pages/board-meetings.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('LA','LA Board of Pharmacy','News','news',
   'https://www.pharmacy.la.gov/news',
   'generic_html', true, 'auto-seed; verify URL'),
  ('MA','MA Board of Registration in Pharmacy','Board Page','agenda',
   'https://www.mass.gov/orgs/board-of-registration-in-pharmacy',
   'generic_html', true, 'auto-seed; verify URL'),
  ('MD','MD Board of Pharmacy','Public Notices','news',
   'https://health.maryland.gov/pharmacy/Pages/publicnotices.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('ME','ME Board of Pharmacy','Board Page','agenda',
   'https://www.maine.gov/pfr/professionallicensing/professions/pharmacists/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('MI','MI Board of Pharmacy','Board Page','agenda',
   'https://www.michigan.gov/lara/bureau-list/bpl/health/hp-lic-health-prof/pharmacy',
   'generic_html', true, 'auto-seed; verify URL'),
  ('MN','MN Board of Pharmacy','News','news',
   'https://mn.gov/boards/pharmacy/about/news/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('MO','MO Board of Pharmacy','News','news',
   'https://pr.mo.gov/pharmacists-news.asp',
   'generic_html', true, 'auto-seed; verify URL'),
  ('MS','MS Board of Pharmacy','News','news',
   'https://www.mbp.ms.gov/news/Pages/default.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('MT','MT Board of Pharmacy','Board Page','agenda',
   'https://boards.bsd.dli.mt.gov/pharmacy/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('NE','NE Board of Pharmacy','Board Page','agenda',
   'https://dhhs.ne.gov/licensure/Pages/Pharmacy.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('NH','NH Board of Pharmacy','Board Page','agenda',
   'https://www.oplc.nh.gov/pharmacy',
   'generic_html', true, 'auto-seed; verify URL'),
  ('NJ','NJ Board of Pharmacy','News & Notices','news',
   'https://www.njconsumeraffairs.gov/pharm/Pages/notices.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('NM','NM Board of Pharmacy','Meetings','meeting',
   'https://www.rld.nm.gov/boards-and-commissions/individual-boards-and-commissions/pharmacy/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('NV','NV State Board of Pharmacy','Meetings','meeting',
   'https://bop.nv.gov/Meetings/Board_Meeting_Agendas_and_Minutes/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('NY','NY Board of Pharmacy','Board Page','agenda',
   'https://www.op.nysed.gov/professions/pharmacy',
   'generic_html', true, 'auto-seed; verify URL'),
  ('ND','ND State Board of Pharmacy','News','news',
   'https://www.nodakpharmacy.com/news.asp',
   'generic_html', true, 'auto-seed; verify URL'),
  ('OK','OK State Board of Pharmacy','Meetings','meeting',
   'https://oklahoma.gov/pharmacy/about-us/meetings.html',
   'generic_html', true, 'auto-seed; verify URL'),
  ('OR','OR Board of Pharmacy','News & Meetings','meeting',
   'https://www.oregon.gov/pharmacy/Pages/Board-Meetings.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('PA','PA State Board of Pharmacy','Board Page','agenda',
   'https://www.dos.pa.gov/ProfessionalLicensing/BoardsCommissions/Pharmacy/Pages/default.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('RI','RI Board of Pharmacy','Board Page','agenda',
   'https://health.ri.gov/licenses/detail.php?id=232',
   'generic_html', true, 'auto-seed; verify URL'),
  ('SC','SC Board of Pharmacy','Meetings','meeting',
   'https://llr.sc.gov/bop/Meetings.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('SD','SD Board of Pharmacy','News','news',
   'https://pharmacy.sd.gov/news/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('TN','TN Board of Pharmacy','Board Page','agenda',
   'https://www.tn.gov/health/health-program-areas/health-professional-boards/pharmacy-board.html',
   'generic_html', true, 'auto-seed; verify URL'),
  ('TX','TX State Board of Pharmacy','Meetings','meeting',
   'https://www.pharmacy.texas.gov/agencyinfo/meeting.asp',
   'generic_html', true, 'auto-seed; verify URL'),
  ('UT','UT Pharmacy Board','News','news',
   'https://dopl.utah.gov/pharmacy/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('VA','VA Board of Pharmacy','Board Page','agenda',
   'https://www.dhp.virginia.gov/Boards/Pharmacy/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('VT','VT Board of Pharmacy','News','news',
   'https://sos.vermont.gov/pharmacists/',
   'generic_html', true, 'auto-seed; verify URL'),
  ('WA','WA Pharmacy Quality Assurance Commission','Board Page','agenda',
   'https://doh.wa.gov/licenses-permits-and-certificates/boards-commissions-and-councils/pharmacy-quality-assurance-commission',
   'generic_html', true, 'auto-seed; verify URL'),
  ('WI','WI Pharmacy Examining Board','Board Page','agenda',
   'https://dsps.wi.gov/Pages/BoardsCouncils/Pharmacy/Default.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('WV','WV Board of Pharmacy','News','news',
   'https://www.pharmacy.wv.gov/News/Pages/default.aspx',
   'generic_html', true, 'auto-seed; verify URL'),
  ('WY','WY State Board of Pharmacy','Board Page','agenda',
   'https://pharmacyboard.wyo.gov/',
   'generic_html', true, 'auto-seed; verify URL')
on conflict (state, board_name, surface) do nothing;

comment on table public.bop_sources is
  'State Board of Pharmacy (and adjacent agency) surfaces the BoP scraper engine walks daily. All 50 states + DC seeded as of migration 0086. URLs are best-effort and may need admin verification via /admin/bop-monitor (a 404 surfaces as last_status=error).';
