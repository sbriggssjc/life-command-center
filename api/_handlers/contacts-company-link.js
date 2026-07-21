// api/_handlers/contacts-company-link.js
// ============================================================================
// Contact→company-link worker — connect owners to people via company resolution.
// ----------------------------------------------------------------------------
//   GET  → dry-run: report the auto_appliable set (edges_would_create /
//          owners_gaining_first_contact / owners_ge_1m / rent_covered /
//          remaining_in_lane) + a sample. NO writes.
//   POST → apply: attach the person→owner-org edge for each auto_appliable
//          candidate via linkPersonToEntity, bounded by `limit` + a wall-clock
//          budget, then refresh the priority-queue cache.
//
// The view flags auto_appliable (n_candidate_orgs=1 + aggressive descriptor-core
// equality + person guards). This worker re-applies the JS person/junk guards
// (planCompanyLink) AND an apply-time aggressive-core canary (the JS mirror of
// the SQL normalizer) so the two tiers can never drift.
//
// Idempotent: an applied edge drops the row out of the view (already-linked), so
// a re-POST processes only the remainder. Reversible: metadata.via batch tag.
// LCC-Opps only; no dia/gov writes; no new api/*.js (sub-route of operations.js).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import {
  DEFAULT_BATCH_TAG, planCompanyLink, countLane, fetchAutoAppliable,
  classifyOwnerState, refreshQueue, coreMatches,
} from '../_shared/contacts-company-link.js';
import { linkPersonToEntity } from '../_shared/contact-attach.js';

const WALL_CLOCK_MS = 20000;

export async function handleContactsCompanyLinkTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const batchTag = (req.query.batch_tag && String(req.query.batch_tag)) || DEFAULT_BATCH_TAG;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000);
  const dryRun = req.method === 'GET';

  const [lane, page] = await Promise.all([countLane(), fetchAutoAppliable(limit)]);
  if (!page.ok) return res.status(502).json({ error: 'load_failed', detail: page.detail });
  const rows = page.rows;

  // Plan each row (person/junk guard) + the apply-time aggressive-core canary
  // (the JS mirror of the SQL view normalizer — should always agree; a
  // disagreement means the tiers drifted and is surfaced, never silently applied).
  const planned = rows.map((row) => {
    const plan = planCompanyLink(row, { batchTag });
    const coreOk = coreMatches(row.company_name, row.owner_org_name);
    return { row, plan, coreOk };
  });
  const toApply = planned.filter((p) => p.plan.action === 'apply' && p.coreOk);
  const skippedGuard = planned.filter((p) => p.plan.action === 'skip');
  const coreMismatch = planned.filter((p) => p.plan.action === 'apply' && !p.coreOk);
  const skippedReasons = {};
  for (const s of skippedGuard) skippedReasons[s.plan.reason] = (skippedReasons[s.plan.reason] || 0) + 1;

  const ownerIds = toApply.map((p) => p.row.owner_org_id);
  const ownerState = await classifyOwnerState(ownerIds);
  const distinctOwners = new Set(ownerIds);
  const ownersGainingFirst = [...distinctOwners].filter((id) => !ownerState.hasPerson.has(id));
  const ownersInWorklist = [...distinctOwners].filter((id) => ownerState.inWorklist.has(id));
  const ownersGe1m = toApply.filter((p) => Number(p.row.rank_value) >= 1000000)
    .reduce((s, p) => (s.add(p.row.owner_org_id), s), new Set());
  const rentCovered = toApply.reduce((s, p) => s + (Number(p.row.rank_value) || 0), 0);

  const base = {
    ok: true,
    batch_tag: batchTag,
    auto_appliable_total: lane.auto,
    edges_would_create: toApply.length,
    distinct_owner_orgs: distinctOwners.size,
    owners_gaining_first_contact: ownersGainingFirst.length,
    owners_in_worklist: ownersInWorklist.length,
    owners_ge_1m: ownersGe1m.size,
    rent_covered: Math.round(rentCovered),
    skipped_guard: skippedGuard.length,
    skipped_reasons: skippedReasons,
    core_mismatch_canary: coreMismatch.length, // tier-drift canary — expected 0
    remaining_in_lane: lane.review,
    review_single: lane.review_single,
    review_multi: lane.review_multi,
  };

  if (dryRun) {
    base.dry_run = true;
    base.sample = toApply.slice(0, 20).map((p) => ({
      person: p.row.person_name, company: p.row.company_name,
      owner: p.row.owner_org_name,
      rank_value: p.row.rank_value != null ? Math.round(Number(p.row.rank_value)) : null,
    }));
    return res.status(200).json(base);
  }

  // POST → apply, bounded by the wall-clock budget.
  const started = Date.now();
  let edgesCreated = 0; let existed = 0; let failed = 0; let processed = 0;
  const linkedOwners = new Set();
  for (const { row, plan } of toApply) {
    if (Date.now() - started > WALL_CLOCK_MS) break;
    processed += 1;
    const r = await linkPersonToEntity(plan.edge);
    if (r.ok && r.existed) { existed += 1; linkedOwners.add(row.owner_org_id); }
    else if (r.ok) { edgesCreated += 1; linkedOwners.add(row.owner_org_id); }
    else { failed += 1; }
  }
  if (edgesCreated > 0) await refreshQueue();

  return res.status(200).json({
    ...base,
    dry_run: false,
    processed,
    edges_created: edgesCreated,
    already_existed: existed,
    failed,
    owner_orgs_linked: linkedOwners.size,
    remaining_after: (typeof lane.auto === 'number') ? Math.max(0, lane.auto - edgesCreated) : null,
  });
}
