// ============================================================================
// REVIEW-LANES1 (2026-09-25) — the four review queues as Decision Center lanes.
//
//   fetchReviewLanes1Source(type, cap)   the cards (api/admin.js fetchFederatedSource delegates)
//   applyReviewLanes1Verdict(...)        runs the ONE writer the planner names
//                                        (api/admin.js handleDecisionVerdict delegates)
//   POST /api/decision-undo {decision_id}          runs the recorded undo, reopens the card
//   GET  /api/review-lanes-tick          dry-run: what the auto-resolvers would take + lane counts
//   POST /api/review-lanes-tick          apply the safe auto-resolvers, record the backlog metric
//
// The pure planning lives in api/_shared/review-lanes1.js. Nothing here writes a domain row
// itself; every write is a DB function (or the contact merge path) named by the planner.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import {
  REVIEW_LANES1_TYPES, isReviewLanes1Type, reviewLanes1SubjectRef,
  planReviewLanes1Verdict, planReviewLanes1Undo, unwrapRpc,
} from '../_shared/review-lanes1.js';

const DEFAULT_DEPS = { opsQuery, domainQuery };

/** One RPC on the named database. */
export async function runLaneRpc(deps, db, fn, args) {
  const d = deps || DEFAULT_DEPS;
  const r = db === 'ops'
    ? await d.opsQuery('POST', 'rpc/' + fn, args)
    : await d.domainQuery(db, 'POST', 'rpc/' + fn, args);
  return { ok: !!(r && r.ok), status: r && r.status, data: r && r.ok ? unwrapRpc(r.data) : (r && r.data) };
}

const rows = (r) => (r && r.ok && Array.isArray(r.data)) ? r.data : [];
const opsCount = async (d, path) => {
  const r = await d.opsQuery('GET', path + (path.includes('?') ? '&' : '?') + 'select=*&limit=1', undefined, { countMode: 'exact' });
  return (r && r.ok && typeof r.count === 'number') ? r.count : null;
};
const domCount = async (d, dom, path) => {
  const r = await d.domainQuery(dom, 'GET', path + (path.includes('?') ? '&' : '?') + 'select=*&limit=1',
    undefined, { Prefer: 'count=exact' });
  return (r && r.ok && typeof r.count === 'number') ? r.count : null;
};
const inList = (ids) => '(' + ids.map((x) => String(x).replace(/[^0-9A-Za-z-]/g, '')).join(',') + ')';

// ── sources ────────────────────────────────────────────────────────────────
async function listingSaleSource(d, cap) {
  const sel = 'v_{dom}_listing_sale_review_open?select=review_id,listing_id,sale_id,verdict,details,created_at,property_id,'
    + 'address,city,state,asking_price,on_market_date,on_market_date_confidence,capture_date,sale_property_id,'
    + 'sale_property_address,sale_date,sold_price,ask_to_sold_ratio,via_twin&order=created_at.asc&limit=' + cap;
  const [dia, gov] = await Promise.all(['dia', 'gov'].map((dom) => d.domainQuery(dom, 'GET', sel.replace('{dom}', dom))));
  const items = [];
  for (const [dom, r] of [['dia', dia], ['gov', gov]]) {
    for (const row of rows(r)) {
      const ctx = { domain: dom, ...row };
      items.push({
        subject_ref: reviewLanes1SubjectRef('listing_sale_review', ctx),
        subject_domain: dom,
        subject_property_id: row.property_id != null ? String(row.property_id) : null,
        subject_entity_id: null,
        rank_value: Number(row.sold_price) || Number(row.asking_price) || 0,
        context: ctx,
      });
    }
  }
  items.sort((a, b) => b.rank_value - a.rank_value);
  const [nd, ng] = await Promise.all([domCount(d, 'dia', 'v_dia_listing_sale_review_open'),
    domCount(d, 'gov', 'v_gov_listing_sale_review_open')]);
  return { items, total: (nd == null && ng == null) ? null : (nd || 0) + (ng || 0), parts: { dia: nd, gov: ng } };
}

async function assetLinkSource(d, cap) {
  const r = await d.opsQuery('GET', 'lcc_asset_property_link_resolution?select=id,domain,entity_id,dropped_property_id,'
    + 'evidence,research_task_id,created_at,entities(name,address,metadata)'
    + '&verdict=eq.candidate&decided_at=is.null&order=id.asc&limit=' + cap);
  const ledger = rows(r);
  // One batched read of every candidate property so the card shows what each one IS.
  const byDom = { dia: new Set(), gov: new Set() };
  for (const l of ledger) for (const c of (l.evidence && l.evidence.candidates) || []) byDom[l.domain]?.add(String(c));
  const props = new Map();
  for (const dom of ['dia', 'gov']) {
    const ids = [...byDom[dom]].filter((x) => /^\d+$/.test(x));
    if (!ids.length) continue;
    const pr = await d.domainQuery(dom, 'GET', 'properties?select=property_id,address,city,state&property_id=in.' + inList(ids));
    for (const p of rows(pr)) props.set(dom + ':' + p.property_id, p);
  }
  const items = ledger.map((l) => {
    const ev = l.evidence || {};
    const cands = (ev.candidates || []).map((pid) => {
      const p = props.get(l.domain + ':' + pid);
      return { property_id: String(pid), exists: !!p, address: p?.address || null, city: p?.city || null,
        state: p?.state || null };
    });
    const e = l.entities || {};
    const ctx = { ledger_id: l.id, domain: l.domain, entity_id: l.entity_id, entity_name: e.name || null,
      entity_address: e.address || null, dropped_property_id: l.dropped_property_id,
      signals: ev.signals || [], note: ev.note || null, candidates: cands, research_task_id: l.research_task_id };
    return { subject_ref: reviewLanes1SubjectRef('asset_property_link_review', ctx), subject_domain: l.domain,
      subject_property_id: null, subject_entity_id: l.entity_id, rank_value: cands.length === 1 ? 2 : 1, context: ctx };
  });
  const total = await opsCount(d, 'lcc_asset_property_link_resolution?verdict=eq.candidate&decided_at=is.null');
  return { items, total };
}

async function ownerReviewSource(d, cap) {
  // already-linked candidates first (usually a gov-side duplicate owner), then the rest by score.
  const r = await d.opsQuery('GET', 'lcc_gov_owner_unification_review?select=review_id,recorded_owner_id,owner_name,'
    + 'candidate_unified_id,match_tier,match_score,reason,created_at&status=eq.open'
    + '&order=reason.desc,match_score.desc.nullslast,review_id.asc&limit=' + cap);
  const revs = rows(r);
  const cids = [...new Set(revs.map((x) => x.candidate_unified_id).filter(Boolean))];
  const cands = new Map();
  if (cids.length) {
    const cr = await d.opsQuery('GET', 'unified_contacts?select=unified_id,contact_class,company_name,first_name,last_name,'
      + 'email,phone,state,sf_account_id,recorded_owner_id&unified_id=in.' + inList(cids));
    for (const c of rows(cr)) cands.set(c.unified_id, c);
  }
  const oids = [...new Set([...revs.map((x) => x.recorded_owner_id),
    ...[...cands.values()].map((c) => c.recorded_owner_id)].filter(Boolean))];
  const owners = new Map();
  if (oids.length) {
    const orr = await d.opsQuery('GET', 'lcc_gov_recorded_owner_mirror?select=recorded_owner_id,name,state,survivor_id'
      + '&recorded_owner_id=in.' + inList(oids));
    for (const o of rows(orr)) owners.set(o.recorded_owner_id, o);
  }
  const items = revs.map((q) => {
    const c = cands.get(q.candidate_unified_id) || null;
    const own = owners.get(q.recorded_owner_id) || null;
    const cOwner = c && c.recorded_owner_id ? owners.get(c.recorded_owner_id) || null : null;
    const ctx = { review_id: q.review_id, recorded_owner_id: q.recorded_owner_id, owner_name: q.owner_name,
      owner_state: own?.state || null, reason: q.reason, match_tier: q.match_tier, match_score: q.match_score,
      candidate: c ? { unified_id: c.unified_id, contact_class: c.contact_class, company_name: c.company_name,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null, email: c.email, phone: c.phone,
        state: c.state, sf_account_id: c.sf_account_id,
        linked_owner_id: c.recorded_owner_id, linked_owner_name: cOwner?.name || null,
        linked_owner_live: cOwner ? cOwner.survivor_id === cOwner.recorded_owner_id : null } : null };
    return { subject_ref: reviewLanes1SubjectRef('gov_owner_contact_review', ctx), subject_domain: 'gov',
      subject_property_id: null, subject_entity_id: null, rank_value: Number(q.match_score) || 0, context: ctx };
  });
  const total = await opsCount(d, 'lcc_gov_owner_unification_review?status=eq.open');
  return { items, total };
}

async function hubConflictSource(d, cap) {
  const r = await d.opsQuery('GET', 'v_lcc_contact_hub_conflict_open?select=*&order=conflict_log_id.asc&limit=' + cap);
  const items = rows(r).map((row) => {
    const ctx = { ...row };
    return { subject_ref: reviewLanes1SubjectRef('contact_hub_conflict', ctx), subject_domain: 'gov',
      subject_property_id: null, subject_entity_id: null, rank_value: row.sf_account_id || row.holder_sf_account_id ? 2 : 1,
      context: ctx };
  });
  const total = await opsCount(d, 'v_lcc_contact_hub_conflict_open');
  return { items, total };
}

/**
 * The cards for one lane. `self_clearing: true` — every verdict also closes the source row, so the
 * source count IS the open count; callers must not subtract decided subjects a second time.
 */
export async function fetchReviewLanes1Source(type, cap, deps) {
  const d = deps || DEFAULT_DEPS;
  const n = Math.max(1, Math.min(Number(cap) || 50, 400));
  let out;
  if (type === 'listing_sale_review') out = await listingSaleSource(d, n);
  else if (type === 'asset_property_link_review') out = await assetLinkSource(d, n);
  else if (type === 'gov_owner_contact_review') out = await ownerReviewSource(d, n);
  else if (type === 'contact_hub_conflict') out = await hubConflictSource(d, n);
  else return { items: [], total: null, self_clearing: true };
  return { ...out, self_clearing: true };
}

// ── verdicts ───────────────────────────────────────────────────────────────
/**
 * Apply a verdict. Returns { ok, status, body, effects } — the caller records effects (which carry
 * the undo call) on the decision. A failed write returns ok:false and the caller keeps it open.
 */
export async function applyReviewLanes1Verdict({ type, verdict, context, payload, user }, deps) {
  const d = deps || DEFAULT_DEPS;
  const by = (user && (user.display_name || user.email || user.id)) || null;
  const plan = planReviewLanes1Verdict(type, verdict, context, payload, by);
  if (plan.error) return { ok: false, status: 400, body: { error: plan.error, allowed: plan.allowed, candidates: plan.candidates } };

  if (plan.kind === 'contact_merge') {
    const snap = await runLaneRpc(d, plan.snapshot.db, plan.snapshot.fn, plan.snapshot.args);
    if (!snap.ok || !snap.data || snap.data.ok !== true) {
      return { ok: false, status: snap.ok ? 409 : 502, body: { error: (snap.data && snap.data.error) || 'snapshot_failed', detail: snap.data } };
    }
    const merge = d.mergeUnifiedContacts
      || (await import('./contacts-handler.js')).mergeUnifiedContacts;
    const m = await merge({ keep_id: snap.data.keep_id, merge_id: snap.data.drop_id, user });
    const undo = planReviewLanes1Undo(type, verdict, context, snap.data, by);
    if (!m.ok) {
      // The snapshot exists, so whatever the merge path managed to write is still undoable.
      return { ok: false, status: m.status || 502,
        body: { error: 'contact_merge_failed', detail: m.body }, effects: { writer: 'contact_merge', snapshot: snap.data, undo } };
    }
    return { ok: true, status: 200, body: { ok: true, verdict, merged: m.body },
      effects: { writer: 'mergeUnifiedContacts', snapshot: snap.data, merged: m.body, undo } };
  }

  const res = await runLaneRpc(d, plan.db, plan.fn, plan.args);
  if (!res.ok) return { ok: false, status: 502, body: { error: 'writer_failed', writer: plan.fn, detail: res.data } };
  if (!res.data || res.data.ok !== true) {
    return { ok: false, status: 409, body: { error: (res.data && res.data.error) || 'writer_refused', writer: plan.fn, detail: res.data } };
  }
  return { ok: true, status: 200, body: { ok: true, verdict, result: res.data },
    effects: { writer: plan.fn, result: res.data, undo: planReviewLanes1Undo(type, verdict, context, res.data, by) } };
}

// ── undo ───────────────────────────────────────────────────────────────────
export async function undoReviewLanes1Decision(decision, user, deps) {
  const d = deps || DEFAULT_DEPS;
  if (!decision) return { ok: false, status: 404, body: { error: 'decision_not_found' } };
  if (!isReviewLanes1Type(decision.decision_type)) return { ok: false, status: 400, body: { error: 'undo_not_supported_for_type' } };
  if (decision.status !== 'decided') return { ok: false, status: 409, body: { error: 'decision_not_decided', status: decision.status } };
  const effects = decision.effects || {};
  const undo = effects.undo || null;
  let result = null;
  if (undo) {
    const r = await runLaneRpc(d, undo.db, undo.fn, undo.args);
    if (!r.ok || !r.data || r.data.ok !== true) {
      return { ok: false, status: r.ok ? 409 : 502, body: { error: (r.data && r.data.error) || 'undo_failed', undo: undo.fn, detail: r.data } };
    }
    result = r.data;
  }
  const history = Array.isArray(decision.metadata?.undo_history) ? decision.metadata.undo_history : [];
  const reopen = await d.opsQuery('PATCH', 'lcc_decisions?id=eq.' + Number(decision.id), {
    status: 'open', verdict: null, verdict_payload: null, decided_at: null, decided_by: null,
    effects: null, updated_at: new Date().toISOString(),
    metadata: { ...(decision.metadata || {}), undo_history: [...history, {
      verdict: decision.verdict, decided_at: decision.decided_at, effects,
      undone_at: new Date().toISOString(), undone_by: user && user.id, undo_result: result }] },
  });
  if (!reopen || !reopen.ok) {
    return { ok: false, status: 502, body: { error: 'undo_applied_but_reopen_failed', undo_result: result, detail: reopen && reopen.data } };
  }
  return { ok: true, status: 200, body: { ok: true, decision_id: decision.id, undone: decision.verdict, undo_result: result } };
}

export async function handleDecisionUndo(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const id = Number((req.body || {}).decision_id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'decision_id required' });
  const dR = await opsQuery('GET', 'lcc_decisions?id=eq.' + id + '&select=*&limit=1');
  const decision = (dR.ok && Array.isArray(dR.data)) ? dR.data[0] : null;
  const out = await undoReviewLanes1Decision(decision, user);
  return res.status(out.status).json(out.body);
}

// ── tick: auto-resolve the safe classes, then record the backlog metric ─────
/** MERGELOG-GAP candidates a merge ledger has since settled: the ledger's survivor is one of the candidates. */
export async function planAssetLedgerAutoRelinks(d) {
  const lr = await d.opsQuery('GET', 'lcc_asset_property_link_resolution?select=id,domain,dropped_property_id,evidence'
    + '&verdict=eq.candidate&decided_at=is.null&domain=eq.dia&limit=500');
  const ledger = rows(lr);
  if (!ledger.length) return [];
  const ids = [...new Set(ledger.map((l) => l.dropped_property_id).filter((x) => /^\d+$/.test(String(x))))];
  if (!ids.length) return [];
  const rr = await d.domainQuery('dia', 'GET', 'v_dia_property_redirect_resolved?select=dropped_property_id,final_survivor_id,reversed_at'
    + '&dropped_property_id=in.' + inList(ids));
  const surv = new Map();
  for (const r of rows(rr)) if (r.final_survivor_id != null && !r.reversed_at) surv.set(String(r.dropped_property_id), String(r.final_survivor_id));
  const plan = [];
  for (const l of ledger) {
    const s = surv.get(String(l.dropped_property_id));
    const cands = ((l.evidence && l.evidence.candidates) || []).map(String);
    if (s && cands.includes(s)) plan.push({ ledger_id: l.id, kept: s });
  }
  return plan;
}

async function laneBacklogRows(d) {
  const oldest = async (db, view, filter = '', col = 'created_at') => {
    const path = view + '?select=' + col + '&order=' + col + '.asc&limit=1' + (filter ? '&' + filter : '');
    const r = db === 'ops' ? await d.opsQuery('GET', path) : await d.domainQuery(db, 'GET', path);
    const x = rows(r)[0];
    return x ? x[col] : null;
  };
  const minTs = (...ts) => ts.filter(Boolean).sort()[0] || null;
  const [lsDia, lsGov, lsDiaOld, lsGovOld, ap, apOld, gor, gorOld, hc, hcOld] = await Promise.all([
    domCount(d, 'dia', 'v_dia_listing_sale_review_open'), domCount(d, 'gov', 'v_gov_listing_sale_review_open'),
    oldest('dia', 'v_dia_listing_sale_review_open'), oldest('gov', 'v_gov_listing_sale_review_open'),
    opsCount(d, 'lcc_asset_property_link_resolution?verdict=eq.candidate&decided_at=is.null'),
    oldest('ops', 'lcc_asset_property_link_resolution', 'verdict=eq.candidate&decided_at=is.null'),
    opsCount(d, 'lcc_gov_owner_unification_review?status=eq.open'),
    oldest('ops', 'lcc_gov_owner_unification_review', 'status=eq.open'),
    opsCount(d, 'v_lcc_contact_hub_conflict_open'),
    oldest('ops', 'v_lcc_contact_hub_conflict_open'),
  ]);
  const sum = (a, b) => (a == null && b == null) ? null : (a || 0) + (b || 0);
  return [
    { lane_key: 'listing_sale_review', decision_type: 'listing_sale_review', open_count: sum(lsDia, lsGov), oldest_open_at: minTs(lsDiaOld, lsGovOld) },
    { lane_key: 'asset_property_link_review', decision_type: 'asset_property_link_review', open_count: ap, oldest_open_at: apOld },
    { lane_key: 'gov_owner_contact_review', decision_type: 'gov_owner_contact_review', open_count: gor, oldest_open_at: gorOld },
    { lane_key: 'contact_hub_conflict', decision_type: 'contact_hub_conflict', open_count: hc, oldest_open_at: hcOld },
  ];
}

export async function runReviewLanesTick({ apply }, deps) {
  const d = deps || DEFAULT_DEPS;
  const dry = !apply;
  const out = { mode: apply ? 'apply' : 'dry_run', auto: {}, errors: [] };
  const take = async (key, db, fn, args) => {
    const r = db === 'ops' ? await d.opsQuery('POST', 'rpc/' + fn, args) : await d.domainQuery(db, 'POST', 'rpc/' + fn, args);
    if (!r || !r.ok) { out.errors.push({ key, fn, detail: r && r.data }); out.auto[key] = null; return; }
    const list = Array.isArray(r.data) ? r.data : [];
    const byClass = {};
    for (const x of list) byClass[x.auto_class] = (byClass[x.auto_class] || 0) + 1;
    out.auto[key] = { n: list.length, by_class: byClass };
  };
  await take('listing_sale_review:dia', 'dia', 'dia_autoresolve_listing_sale_reviews', { p_dry_run: dry });
  await take('listing_sale_review:gov', 'gov', 'gov_autoresolve_listing_sale_reviews', { p_dry_run: dry });
  await take('gov_owner_contact_review', 'ops', 'lcc_autoresolve_gov_owner_reviews', { p_dry_run: dry });

  const relinks = await planAssetLedgerAutoRelinks(d);
  out.auto.asset_property_link_review = { n: relinks.length, by_class: relinks.length ? { redirect_ledger_names_a_candidate: relinks.length } : {} };
  if (apply) {
    for (const x of relinks) {
      const r = await runLaneRpc(d, 'ops', 'lcc_decide_asset_property_link',
        { p_ledger_id: Number(x.ledger_id), p_decision: 'relink', p_kept: x.kept, p_decided_by: 'auto:redirect_ledger' });
      if (!r.ok || !r.data || r.data.ok !== true) out.errors.push({ key: 'asset_relink', ledger_id: x.ledger_id, detail: r.data });
    }
  }

  const backlog = await laneBacklogRows(d);
  const autoN = (k) => {
    const v = k === 'listing_sale_review'
      ? [out.auto['listing_sale_review:dia'], out.auto['listing_sale_review:gov']]
      : [out.auto[k]];
    return v.every((x) => x == null) ? null : v.reduce((a, x) => a + ((x && x.n) || 0), 0);
  };
  for (const b of backlog) b.auto_resolved = apply ? autoN(b.lane_key) : null;
  out.backlog = backlog;
  if (apply) {
    const r = await runLaneRpc(d, 'ops', 'lcc_record_review_lane_backlog', { p_rows: backlog });
    out.health = r.ok ? r.data : { error: r.data };
    if (!r.ok) out.errors.push({ key: 'backlog', detail: r.data });
  }
  return out;
}

export async function handleReviewLanesTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const out = await runReviewLanesTick({ apply: req.method === 'POST' });
  return res.status(out.errors.length ? 207 : 200).json({ ok: out.errors.length === 0, ...out });
}

export { REVIEW_LANES1_TYPES, isReviewLanes1Type, reviewLanes1SubjectRef, pgFilterVal };
