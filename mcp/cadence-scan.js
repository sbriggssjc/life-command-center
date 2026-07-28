// ============================================================================
// cadence-scan.js — Cadence Engine (Spine #4 + #6): the "what needs a touch" scan
// and the weekly pipeline digest (engine-composed HTML; PA just delivers it).
// Place in mcp/cadence-scan.js (engine deploy context).
//
//   import { makeCadenceScanRoute } from './cadence-scan.js';
//   const cadence = makeCadenceScanRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.get('/api/pipeline/cadence-scan',   authenticate, cadence.scan);          // JSON digest
//   app.post('/api/pipeline/cadence-scan',  authenticate, cadence.scan);
//   app.get('/api/pipeline/weekly-digest',  authenticate, cadence.weeklyDigest);  // { subject, html, text }
//   app.post('/api/pipeline/weekly-digest', authenticate, cadence.weeklyDigest);
//
// Scope = in-scope open Team Briggs deals (owned OR partnership OR explicit include; default exclude).
// Regime A = touch cadence; Regime B = contractual (surfaced); Regime C = terminal (skipped).
// ============================================================================

import { STAGE_REGIME } from './opportunity-sync.js';

const INTERVAL_DAYS = { identified: 7, bov: 14, ela: 14, listing_signed: 14, off_market_listing: 14 };
const DEFAULT_A_INTERVAL = 14;
const DUE_SOON_WINDOW = 3;
const DAY = 86400000;
const daysBetween = (a, b) => Math.floor((a - b) / DAY);

// "Tenant - City - State" / "Tenant - City, State" -> a short label. Address-named deals fall back to the name.
function dealLabel(name, city, state) {
  const s = String(name || '').trim();
  const tenant = s.split(/\s+-\s+/)[0].trim();
  const cty = String(city || '').replace(/\(.*\)/g, '').trim();
  if (tenant && tenant !== s && cty) return `${tenant} — ${cty}${state ? ', ' + state : ''}`;
  return s || '(unnamed deal)';
}

async function computeScan({ opsQuery, enc, WORKSPACE_ID }) {
  const now = new Date();

  const [tbRes, oppRes, edgeRes] = await Promise.all([
    opsQuery('GET', 'lcc_users?select=lcc_user_id&active=eq.true'),
    opsQuery('GET',
      `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=not.is.null&is_open=eq.true` +
      `&select=id,entity_id,sf_opp_id,stage,owner_user_id,amount,expected_close_date,vertical,metadata`),
    opsQuery('GET',
      `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&relationship_type=eq.deal_party` +
      `&metadata->>source=eq.sf_opp_team&select=from_entity_id`),
  ]);
  const tbUsers = new Set((tbRes.data || []).map(r => r.lcc_user_id));
  const tbTeamAssets = new Set((edgeRes.data || []).map(r => r.from_entity_id));
  const inScope = (oppRes.data || []).filter(d =>
    (d.owner_user_id && tbUsers.has(d.owner_user_id)) ||
    tbTeamAssets.has(d.entity_id) ||
    d.metadata?.team_briggs_include === true);

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
    const regime = STAGE_REGIME[d.stage] || 'A';
    if (regime === 'C') continue;
    if (regime === 'B') {
      contractual.push({ sf_opp_id: d.sf_opp_id, deal: label, stage: d.stage,
        amount: d.amount, expected_close_date: d.expected_close_date });
      continue;
    }
    const interval = INTERVAL_DAYS[d.stage] || DEFAULT_A_INTERVAL;
    const lt = lastTouch.get(d.entity_id) || null;
    let due_date = null, days_overdue = null, status;
    if (!lt) {
      status = 'no_logged_activity';
    } else {
      const due = new Date(new Date(lt.occurred_at).getTime() + interval * DAY);
      due_date = due.toISOString().slice(0, 10);
      days_overdue = daysBetween(now, due);
      status = days_overdue > 0 ? 'overdue' : (days_overdue >= -DUE_SOON_WINDOW ? 'due_soon' : 'on_track');
    }
    actionDue.push({ sf_opp_id: d.sf_opp_id, deal: label, stage: d.stage, regime, interval_days: interval,
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
  return { generated_at: now.toISOString(), summary, action_due: actionDue, contractual };
}

// ── Weekly digest rendering (self-contained inline-styled HTML for email) ────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STAGE_LABEL = {
  bov: 'BOV', ela: 'ELA', listing_signed: 'Listing Signed', off_market_listing: 'Off-Market',
  loi_executed: 'LOI Executed', in_escrow: 'In Escrow', non_refundable: 'Non-Refundable', identified: 'Identified',
};
const stageLabel = (s) => STAGE_LABEL[s] || s;

function row(i) {
  const days = i.days_overdue;
  const when = i.last_touch_at
    ? `last touch ${i.last_touch_at.slice(0, 10)}${days > 0 ? ` · <b>${days}d overdue</b>` : days != null ? ` · due ${i.due_date}` : ''}`
    : 'no logged activity yet';
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(i.deal)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;">${esc(stageLabel(i.stage))}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;">${when}</td>
  </tr>`;
}

function section(title, color, items) {
  if (!items.length) return '';
  return `<h3 style="margin:18px 0 6px;color:${color};font:600 15px system-ui,Arial;">${title} (${items.length})</h3>
    <table style="border-collapse:collapse;width:100%;font:13px system-ui,Arial;">${items.map(row).join('')}</table>`;
}

function renderHtml(scan) {
  const a = scan.action_due, s = scan.summary;
  const overdue = a.filter(i => i.status === 'overdue');
  const dueSoon = a.filter(i => i.status === 'due_soon');
  const needsFirst = a.filter(i => i.status === 'no_logged_activity');
  const onTrack = a.filter(i => i.status === 'on_track');
  const contractRows = scan.contractual.map(c =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(c.deal)}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;">${esc(stageLabel(c.stage))}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;">verify PSA milestone timeline</td></tr>`).join('');
  return `<div style="max-width:680px;margin:0 auto;font:14px system-ui,Arial;color:#222;">
    <h2 style="margin:0 0 4px;">Team Briggs — Pipeline Cadence</h2>
    <p style="margin:0 0 14px;color:#666;font-size:13px;">${esc(scan.generated_at.slice(0,10))} · ${s.in_scope_open} open deals in scope · <b style="color:#c0392b;">${s.overdue} overdue</b>, ${s.due_soon} due soon, ${s.needs_first_touch} need a first touch, ${s.on_track} on track</p>
    ${section('🔴 Overdue — reach out', '#c0392b', overdue)}
    ${section('🟡 Due soon', '#b7791f', dueSoon)}
    ${section('⚪ No logged activity yet', '#555', needsFirst)}
    ${section('🟢 On track', '#2e7d32', onTrack)}
    ${scan.contractual.length ? `<h3 style="margin:18px 0 6px;color:#2c5282;font:600 15px system-ui,Arial;">📋 Contractual (${scan.contractual.length})</h3>
      <table style="border-collapse:collapse;width:100%;font:13px system-ui,Arial;">${contractRows}</table>` : ''}
    <p style="margin:18px 0 0;color:#999;font-size:11px;">LCC cadence engine · notify-only · scoped to Team Briggs deals (owned + partnership).</p>
  </div>`;
}

function renderText(scan) {
  const a = scan.action_due, s = scan.summary;
  const line = i => `- ${i.deal} [${stageLabel(i.stage)}] ${i.last_touch_at ? (i.days_overdue > 0 ? i.days_overdue + 'd overdue' : 'due ' + i.due_date) : 'no activity yet'}`;
  const grp = (t, f) => { const x = a.filter(f); return x.length ? `\n${t}:\n${x.map(line).join('\n')}\n` : ''; };
  return `Team Briggs — Pipeline Cadence (${scan.generated_at.slice(0,10)})\n` +
    `${s.in_scope_open} open deals · ${s.overdue} overdue, ${s.due_soon} due soon, ${s.needs_first_touch} need first touch, ${s.on_track} on track\n` +
    grp('OVERDUE', i => i.status === 'overdue') +
    grp('DUE SOON', i => i.status === 'due_soon') +
    grp('NO ACTIVITY YET', i => i.status === 'no_logged_activity') +
    grp('ON TRACK', i => i.status === 'on_track') +
    (scan.contractual.length ? `\nCONTRACTUAL:\n${scan.contractual.map(c => `- ${c.deal} [${stageLabel(c.stage)}]`).join('\n')}\n` : '');
}

export function makeCadenceScanRoute({ opsQuery, enc, WORKSPACE_ID }) {
  const deps = { opsQuery, enc, WORKSPACE_ID };
  return {
    scan: async (req, res) => {
      try { const s = await computeScan(deps); return res.status(200).json({ ok: true, ...s, action_due: s.action_due.slice(0, 100) }); }
      catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
    },
    weeklyDigest: async (req, res) => {
      try {
        const s = await computeScan(deps);
        const subject = `Team Briggs pipeline — ${s.summary.overdue} overdue, ${s.summary.due_soon} due soon`;
        return res.status(200).json({ ok: true, subject, html: renderHtml(s), text: renderText(s), summary: s.summary });
      } catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
    },
  };
}
