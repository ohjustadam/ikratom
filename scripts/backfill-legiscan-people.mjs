import { createClient } from '@supabase/supabase-js';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const KEY = process.env.LEGISCAN_API_KEY;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
if (!KEY) { console.error('no LEGISCAN_API_KEY'); process.exit(1); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
async function pageAll(table, cols, tweak) { const out = []; let from = 0; const size = 1000;
  for (;;) { let q = sb.from(table).select(cols).range(from, from + size - 1); if (tweak) q = tweak(q);
    const { data, error } = await q; if (error) { console.error('QERR ' + table + ': ' + error.message); process.exit(1); }
    out.push(...data); if (!data || data.length < size) break; from += size; } return out; }
function normName(s) { if (!s) return ''; let t = String(s).toLowerCase().trim();
  if (t.includes(',')) { const p = t.split(','); t = (p[1] + ' ' + p[0]).trim(); }
  t = t.replace(/\b(rep|representative|sen|senator|dr|mr|mrs|ms|hon|honorable)\b\.?/g, ' ');
  t = t.replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, ' ');
  t = t.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim(); return t; }
function digits(s) { return String(s || '').replace(/\D/g, ''); }
function chamberType(s) { const t = String(s || '').toLowerCase(); if (t.includes('sen') || t.includes('upper')) return 'senate'; if (t.includes('house') || t.includes('assembly') || t.includes('lower') || t.includes('rep')) return 'house'; return ''; }
function roleChamber(r) { const t = String(r || '').toLowerCase(); if (t.includes('senate')) return 'senate'; if (t.includes('house')) return 'house'; return ''; }
async function ls(op, params) { const u = 'https://api.legiscan.com/?key=' + KEY + '&op=' + op + (params ? '&' + params : ''); try { const r = await fetch(u); return await r.json(); } catch (e) { return { status: 'ERROR' }; } }
function top(m) { let b = null, bn = -1; for (const [k, v] of m) { if (v > bn) { bn = v; b = k; } } return b; }
const bills = await pageAll('bills', 'id,state'); const billState = new Map(bills.map(b => [b.id, b.state]));
const votes = await pageAll('bill_votes', 'id,bill_id,chamber'); const vMeta = new Map(votes.map(v => [v.id, { state: billState.get(v.bill_id) || null, chamber: chamberType(v.chamber) }]));
const members = await pageAll('bill_vote_members', 'legiscan_people_id,bill_vote_id', q => q.not('legiscan_people_id', 'is', null));
const people = new Map();
for (const m of members) { const meta = vMeta.get(m.bill_vote_id) || {}; const pid = m.legiscan_people_id; if (!people.has(pid)) people.set(pid, { states: new Map(), chambers: new Map() }); const p = people.get(pid); if (meta.state) p.states.set(meta.state, (p.states.get(meta.state) || 0) + 1); if (meta.chamber) p.chambers.set(meta.chamber, (p.chambers.get(meta.chamber) || 0) + 1); }
const needByState = new Map();
for (const [pid, p] of people) { const st = top(p.states); if (!st) continue; if (!needByState.has(st)) needByState.set(st, new Set()); needByState.get(st).add(pid); }
const personInfo = new Map();
for (const st of needByState.keys()) { const need = needByState.get(st); const sl = await ls('getSessionList', 'state=' + st);
  const sessions = (sl && sl.sessions) ? sl.sessions.slice().sort((a, b) => (b.year_end || 0) - (a.year_end || 0)) : []; let fetched = 0;
  for (const s of sessions) { if (fetched >= 12) break; let rem = 0; for (const pid of need) if (!personInfo.has(pid)) rem++; if (rem === 0) break;
    const sp = await ls('getSessionPeople', 'id=' + s.session_id); fetched++; await sleep(100);
    const ppl = (sp && sp.sessionpeople && sp.sessionpeople.people) ? sp.sessionpeople.people : [];
    for (const per of ppl) { if (!personInfo.has(per.people_id)) personInfo.set(per.people_id, { name: per.name || ((per.first_name || '') + ' ' + (per.last_name || '')).trim(), district: per.district || '' }); } } }
const legs = await pageAll('legislators', 'id,full_name,state,district,role,legiscan_people_id');
const legIndex = new Map();
for (const l of legs) { const k = (l.state || '') + '|' + roleChamber(l.role); if (!legIndex.has(k)) legIndex.set(k, []); legIndex.get(k).push({ id: l.id, norm: normName(l.full_name), district: digits(l.district) }); }
const plan = [];
for (const [pid, p] of people) { const st = top(p.states), cham = top(p.chambers); const info = personInfo.get(pid); if (!info || !info.name) continue;
  const cands = legIndex.get((st || '') + '|' + cham) || []; const want = normName(info.name);
  let hits = cands.filter(c => c.norm === want);
  if (hits.length !== 1 && digits(info.district)) { const dh = cands.filter(c => c.district && c.district === digits(info.district)); if (dh.length === 1) hits = dh; }
  if (hits.length === 1) plan.push({ pid, legId: hits[0].id, name: info.name }); }
const byLeg = new Map(); for (const pl of plan) byLeg.set(pl.legId, (byLeg.get(pl.legId) || 0) + 1);
const writePlan = plan.filter(pl => byLeg.get(pl.legId) === 1);
const collisions = plan.filter(pl => byLeg.get(pl.legId) > 1);
console.log('matched: ' + plan.length + '   writePlan (collision-free): ' + writePlan.length + '   collisions skipped: ' + collisions.length);
if (!APPLY) { console.log('=== DRY RUN: no writes ==='); process.exit(0); }
console.log('=== APPLYING WRITES ===');
let legOk = 0, legErr = 0;
for (const batch of chunk(writePlan, 30)) { const res = await Promise.all(batch.map(pl => sb.from('legislators').update({ legiscan_people_id: pl.pid }).eq('id', pl.legId).is('legiscan_people_id', null))); for (const r of res) { if (r.error) { legErr++; if (legErr <= 5) console.log('  legErr: ' + r.error.message); } else legOk++; } }
console.log('legislators updated: ' + legOk + '  errors: ' + legErr);
let memOk = 0, memErr = 0;
for (const batch of chunk(writePlan, 30)) { const res = await Promise.all(batch.map(pl => sb.from('bill_vote_members').update({ legislator_id: pl.legId, legislator_name: pl.name }).eq('legiscan_people_id', pl.pid))); for (const r of res) { if (r.error) { memErr++; if (memErr <= 5) console.log('  memErr: ' + r.error.message); } else memOk++; } }
console.log('bill_vote_members pid-groups updated: ' + memOk + '  errors: ' + memErr);
const { count: linkedLegs } = await sb.from('legislators').select('*', { count: 'exact', head: true }).not('legiscan_people_id', 'is', null);
const { count: linkedMembers } = await sb.from('bill_vote_members').select('*', { count: 'exact', head: true }).not('legislator_id', 'is', null);
const { count: okLinked } = await sb.from('legislators').select('*', { count: 'exact', head: true }).eq('state', 'OK').not('legiscan_people_id', 'is', null);
console.log('=== READ-BACK ===');
console.log('legislators now linked: ' + linkedLegs);
console.log('bill_vote_members now attributed (legislator_id set): ' + linkedMembers);
console.log('OK legislators linked: ' + okLinked);
console.log('=== DONE ===');
