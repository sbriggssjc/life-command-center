// ============================================================================
// cadence-scan.js — Cadence Engine (Spine #4 + #6): "what needs a touch" scan
// and the pipeline digest (engine-composed HTML; PA delivers it).
// Place in mcp/cadence-scan.js (engine deploy context).
//
//   GET/POST /api/pipeline/cadence-scan                       JSON digest (team scope)
//   GET/POST /api/pipeline/cadence-scan?owner_email=<email>   JSON digest for one broker
//   GET/POST /api/pipeline/weekly-digest                      team-overview email { subject, html, text }
//   GET/POST /api/pipeline/weekly-digest?owner_email=<email>  per-broker "my deals" email
//
// Owner scope (owner_email | owner=<lcc_user_id> | owner_sf=<salesforce_owner_id>): a broker's digest = the
// deals THEY OWN. No arg = team overview (all in-scope, owner shown per line, labeled "not your to-dos").
// Activity coverage note: LCC ingests one mailbox today, so overdue flags are caveated until team-mail intake.
// (Design: docs/os/architecture/team-visibility-and-owner-scoping.md.)
// ============================================================================

import { STAGE_REGIME } from './opportunity-sync.js';

const INTERVAL_DAYS = { identified: 7, bov: 14, ela: 14, listing_signed: 14, off_market_listing: 14 };
const DEFAULT_A_INTERVAL = 14;
const DUE_SOON_WINDOW = 3;
const DAY = 86400000;
const daysBetween = (a, b) => Math.floor((a - b) / DAY);

// Interim honesty: LCC currently ingests one mailbox, so a deal another broker is working may look quiet here.
const COVERAGE_NOTE = 'Activity coverage: LCC currently ingests one mailbox — overdue flags reflect shared ' +
  'correspondence only, so a deal actively worked by another broker may show as quiet. Team-mailbox intake is planned.';

function dealLabel(name, city, state) {
  const s = String(name || '').trim();
  const tenant = s.split(/\s+-\s+/)[0].trim();
  const cty = String(city || '').replace(/\(.*\)/g, '').trim();
  if (tenant && tenant !== s && cty) return `${tenant} — ${cty}${state ? ', ' + state : ''}`;
  return s || '(unnamed deal)';
}

async function loadUsers({ opsQuery }) {
  const r = await opsQuery('GET', 'lcc_users?select=lcc_user_id,display_name,email,salesforce_owner_id&active=eq.true');
  const byId = new Map(), byEmail = new Map(), bySf = new Map();
  for (const u of (r.data || [])) {
    byId.set(u.lcc_user_id, u);
    if (u.email) byEmail.set(String(u.email).toLowerCase(), u);
    if (u.salesforce_owner_id) bySf.set(u.salesforce_owner_id, u);
  }
  return { byId, byEmail, bySf };
}

async function computeScan(deps, { ownerLccId } = {}) {
  const { opsQuery, enc, WORKSPACE_ID } = deps;
  const now = new Date();
  const users = await loadUsers(deps);
  const tbUserIds = new Set([...users.byId.keys()]);

  const [oppRes, edgeRes] = await Promise.all([
    opsQuery('GET',
      `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=not.is.null&is_open=eq.true` +
      `&select=id,entity_id,sf_opp_id,stage,owner_user_id,amount,expected_close_date,vertical,metadata`),
    opsQuery('GET',
      `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&relationship_type=eq.deal_party` +
      `&metadata->>source=eq.sf_opp_team&select=from_entity_id`),
  ]);
  const tbTeamAssets = new Set((edgeRes.data || []).map(r => r.from_entity_id));
  let inScope = (oppRes.data || []).filter(d =>
    (d.owner_user_id && tbUserIds.has(d.owner_user_id)) ||
    tbTeamAssets.has(d.entity_id) ||
    d.metadata?.team_briggs_include === true);
  if (ownerLccId) inScope = inScope.filter(d => d.owner_user_id === ownerLccId);

  const ids = [...new Set(inScope.map(d => d.entity_id).filter(Boolean))];
  const entById = new Map();
  if (ids.length) {
    const er = await opsQuery('GET', `entities?id=in.(${ids.map(x => enc(x)).join(',')})&select=id,name,city,state`);
    for (const e of (er.data || [])) entById.set(e.id, e);
  }
  const lastTouch = new Map();
  if (ids.length) {
    const av = await opsQuery('GET',
      `activity_events?workspace_id=eq.${enc(WORKSPACE_ID)}&entity_id=in.(${ids.map(x => enc(x)).join(',')})` +
      `&category=in.(call,email)&order=occurred_at.desc&select=entity_id,occurred_at,category&limit=8000`);
    for (const a of (av.data || [])) if (a.entity_id && !lastTouch.has(a.entity_id)) lastTouch.set(a.entity_id, a);
  }

  const actionDue = [], contractual = [];
  for (const d of inScope) {
    const e = entById.get(d.entity_id) || {};
    const label = dealLabel(e.name, e.city, e.state);
    const owner = users.byId.get(d.owner_user_id)?.display_name || 'unassigned / other';
    const regime = STAGE_REGIME[d.stage] || 'A';
    if (regime === 'C') continue;
    if (regime === 'B') {
      contractual.push({ sf_opp_id: d.sf_opp_id, deal: label, owner, stage: d.stage,
        amount: d.amount, expected_close_date: d.expected_close_date });
      continue;
    }
    const interval = INTERVAL_DAYS[d.stage] || DEFAULT_A_INTERVAL;
    const lt = lastTouch.get(d.entity_id) || null;
    let due_date = null, days_overdue = null, status;
    if (!lt) { status = 'no_logged_activity'; }
    else {
      const due = new Date(new Date(lt.occurred_at).getTime() + interval * DAY);
      due_date = due.toISOString().slice(0, 10);
      days_overdue = daysBetween(now, due);
      status = days_overdue > 0 ? 'overdue' : (days_overdue >= -DUE_SOON_WINDOW ? 'due_soon' : 'on_track');
    }
    actionDue.push({ sf_opp_id: d.sf_opp_id, deal: label, owner, stage: d.stage, regime, interval_days: interval,
      last_touch_at: lt?.occurred_at || null, due_date, days_overdue, status,
      amount: d.amount, expected_close_date: d.expected_close_date, vertical: d.vertical });
  }
  const rank = { overdue: 0, no_logged_activity: 1, due_soon: 2, on_track: 3 };
  actionDue.sort((a, b) => (rank[a.status] - rank[b.status]) || ((b.days_overdue || 0) - (a.days_overdue || 0)));

  const summary = {
    in_scope_open: inScope.length, regime_a: actionDue.length, contractual: contractual.length,
    overdue: actionDue.filter(i => i.status === 'overdue').length,
    due_soon: actionDue.filter(i => i.status === 'due_soon').length,
    needs_first_touch: actionDue.filter(i => i.status === 'no_logged_activity').length,
    on_track: actionDue.filter(i => i.status === 'on_track').length,
  };
  const owner_label = ownerLccId ? (users.byId.get(ownerLccId)?.display_name || 'Unknown') : null;
  return { generated_at: now.toISOString(), owner_scoped: !!ownerLccId, owner_label,
    coverage_note: COVERAGE_NOTE, summary, action_due: actionDue, contractual };
}

// ── rendering ────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STAGE_LABEL = { bov: 'BOV', ela: 'ELA', listing_signed: 'Listing Signed', off_market_listing: 'Off-Market',
  loi_executed: 'LOI Executed', in_escrow: 'In Escrow', non_refundable: 'Non-Refundable', identified: 'Identified' };
const stageLabel = (s) => STAGE_LABEL[s] || s;

function row(i, showOwner) {
  const days = i.days_overdue;
  const when = i.last_touch_at
    ? `last touch ${i.last_touch_at.slice(0, 10)}${days > 0 ? ` · <b>${days}d overdue</b>` : days != null ? ` · due ${i.due_date}` : ''}`
    : 'no logged activity yet';
  const cell = 'padding:6px 10px;border-bottom:1px solid #eee;';
  return `<tr><td style="${cell}">${esc(i.deal)}</td>` +
    (showOwner ? `<td style="${cell}color:#555;">${esc(i.owner)}</td>` : '') +
    `<td style="${cell}color:#555;">${esc(stageLabel(i.stage))}</td>` +
    `<td style="${cell}color:#555;">${when}</td></tr>`;
}
function section(title, color, items, showOwner) {
  if (!items.length) return '';
  return `<h3 style="margin:18px 0 6px;color:${color};font:600 15px system-ui,Arial;">${title} (${items.length})</h3>` +
    `<table style="border-collapse:collapse;width:100%;font:13px system-ui,Arial;">${items.map(i => row(i, showOwner)).join('')}</table>`;
}
function renderHtml(scan) {
  const a = scan.action_due, s = scan.summary, showOwner = !scan.owner_scoped;
  const heading = scan.owner_scoped ? `Your Pipeline — ${esc(scan.owner_label)}` : 'Team Briggs — Pipeline (all owners)';
  const scopeNote = scan.owner_scoped ? 'your deals' : '<b>team pipeline — owner shown per row, not your personal to-dos</b>';
  const contractRows = scan.contractual.map(c => {
    const cell = 'padding:6px 10px;border-bottom:1px solid #eee;';
    return `<tr><td style="${cell}">${esc(c.deal)}</td>` + (showOwner ? `<td style="${cell}color:#555;">${esc(c.owner)}</td>` : '') +
      `<td style="${cell}color:#555;">${esc(stageLabel(c.stage))}</td><td style="${cell}color:#555;">verify PSA milestone timeline</td></tr>`;
  }).join('');
  return `<div style="max-width:720px;margin:0 auto;font:14px system-ui,Arial;color:#222;">
    <h2 style="margin:0 0 4px;">${heading}</h2>
    <p style="margin:0 0 6px;color:#666;font-size:13px;">${esc(scan.generated_at.slice(0,10))} · ${scopeNote} · ${s.in_scope_open} open · <b style="color:#c0392b;">${s.overdue} overdue</b>, ${s.due_soon} due soon, ${s.needs_first_touch} need a first touch, ${s.on_track} on track</p>
    <p style="margin:0 0 12px;padding:6px 10px;background:#fff8e1;border-left:3px solid #f0ad4e;color:#7a5b00;font-size:12px;">${esc(scan.coverage_note)}</p>
    ${section('🔴 Overdue — reach out', '#c0392b', a.filter(i => i.status === 'overdue'), showOwner)}
    ${section('🟡 Due soon', '#b7791f', a.filter(i => i.status === 'due_soon'), showOwner)}
    ${section('⚪ No logged activity yet', '#555', a.filter(i => i.status === 'no_logged_activity'), showOwner)}
    ${section('🟢 On track', '#2e7d32', a.filter(i => i.status === 'on_track'), showOwner)}
    ${scan.contractual.length ? `<h3 style="margin:18px 0 6px;color:#2c5282;font:600 15px system-ui,Arial;">📋 Contractual (${scan.contractual.length})</h3>
      <table style="border-collapse:collapse;width:100%;font:13px system-ui,Arial;">${contractRows}</table>` : ''}
    <p style="margin:18px 0 0;color:#999;font-size:11px;">LCC cadence engine · notify-only · Team Briggs deals (owned + partnership).</p>
  </div>`;
}
function renderText(scan) {
  const a = scan.action_due, s = scan.summary;
  const line = i => `- ${i.deal}${scan.owner_scoped ? '' : ' {' + i.owner + '}'} [${stageLabel(i.stage)}] ${i.last_touch_at ? (i.days_overdue > 0 ? i.days_overdue + 'd overdue' : 'due ' + i.due_date) : 'no activity yet'}`;
  const grp = (t, f) => { const x = a.filter(f); return x.length ? `\n${t}:\n${x.map(line).join('\n')}\n` : ''; };
  return `${scan.owner_scoped ? 'Your Pipeline — ' + scan.owner_label : 'Team Briggs — Pipeline (all owners)'} (${scan.generated_at.slice(0,10)})\n` +
    `${s.in_scope_open} open · ${s.overdue} overdue, ${s.due_soon} due soon, ${s.needs_first_touch} need first touch, ${s.on_track} on track\n${scan.coverage_note}\n` +
    grp('OVERDUE', i => i.status === 'overdue') + grp('DUE SOON', i => i.status === 'due_soon') +
    grp('NO ACTIVITY YET', i => i.status === 'no_logged_activity') + grp('ON TRACK', i => i.status === 'on_track') +
    (scan.contractual.length ? `\nCONTRACTUAL:\n${scan.contractual.map(c => `- ${c.deal}${scan.owner_scoped ? '' : ' {' + c.owner + '}'} [${stageLabel(c.stage)}]`).join('\n')}\n` : '');
}

async function resolveOwner(deps, q) {
  if (!q) return null;
  const users = await loadUsers(deps);
  const email = q.owner_email && String(q.owner_email).toLowerCase();
  if (email && users.byEmail.has(email)) return users.byEmail.get(email).lcc_user_id;
  if (q.owner_sf && users.bySf.has(q.owner_sf)) return users.bySf.get(q.owner_sf).lcc_user_id;
  if (q.owner && users.byId.has(q.owner)) return q.owner;
  return null;   // unrecognized owner arg -> treat as team scope
}

export function makeCadenceScanRoute({ opsQuery, enc, WORKSPACE_ID }) {
  const deps = { opsQuery, enc, WORKSPACE_ID };
  // Owner args may arrive via the query string (direct GET) OR the JSON body (the root proxy always
  // POSTs a body and drops the query string — see api/ai-read.js). Merge both, body wins.
  const ownerArgs = (req) => ({ ...(req.query || {}), ...(req.body || {}) });
  const wantsOwner = (q) => q.owner_email || q.owner || q.owner_sf;
  return {
    scan: async (req, res) => {
      try {
        const q = ownerArgs(req);
        const ownerLccId = wantsOwner(q) ? await resolveOwner(deps, q) : null;
        const s = await computeScan(deps, { ownerLccId });
        return res.status(200).json({ ok: true, ...s, action_due: s.action_due.slice(0, 200) });
      } catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
    },
    weeklyDigest: async (req, res) => {
      try {
        const q = ownerArgs(req);
        const ownerLccId = wantsOwner(q) ? await resolveOwner(deps, q) : null;
        const s = await computeScan(deps, { ownerLccId });
        const scope = s.owner_scoped ? s.owner_label : 'Team';
        const subject = `${scope} pipeline — ${s.summary.overdue} overdue, ${s.summary.due_soon} due soon`;
        return res.status(200).json({ ok: true, subject, html: renderHtml(s), text: renderText(s), owner_scoped: s.owner_scoped, summary: s.summary });
      } catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
    },
  };
}
