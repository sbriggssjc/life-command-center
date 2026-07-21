// api/_handlers/contacts-company-link.js
// ============================================================================
// Phase 1b worker — connect owners to people via company resolution.
// ----------------------------------------------------------------------------
//   GET  → dry-run: report the exact_unique auto-apply set (would-apply /
//          skipped-guard / distinct owner orgs / >=$1M / in-worklist) + the
//          exact_ambiguous + fuzzy review universe. NO writes.
//   POST → apply: attach the person→owner-org edge for each exact_unique
//          candidate via linkPersonToEntity (Unit 1), bounded by `limit` +
//          a wall-clock budget, then refresh the priority-queue cache.
//
// Idempotent: an applied edge drops the row out of the view (already-linked), so
// a re-POST processes only the remainder. Reversible: metadata.via batch tag.
// LCC-Opps only; no dia/gov writes; no new api/*.js (sub-route of operations.js).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import {
  DEFAULT_BATCH_TAG, planCompanyLink, countReviewLane, fetchExactUnique,
  classifyOwnerState, refreshQueue,
} from '../_shared/contacts-company-link.js';
import { linkPersonToEntity } from '../_shared/contact-attach.js';

const WALL_CLOCK_MS = 20000;

async function exactUniqueCount() {
  const r = await opsQuery('GET', 'v_lcc_contact_company_link_candidates?select=unified_id'
    + '&match_class=eq.exact_unique&limit=1', undefined, { countMode: 'exact' });
  return (r.ok && typeof r.count === 'number') ? r.count : null;
}

export async function handleContactsCompanyLinkTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const batchTag = (req.query.batch_tag && String(req.query.batch_tag)) || DEFAULT_BATCH_TAG;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000);
  const dryRun = req.method === 'GET';

  const [total, review, page] = await Promise.all([
    exactUniqueCount(), countReviewLane(), fetchExactUnique(limit),
  ]);
  if (!page.ok) return res.status(502).json({ error: 'load_failed', detail: page.detail });
  const rows = page.rows;

  // Plan each row (guard); tally would-apply vs skipped-guard.
  const planned = rows.map((row) => ({ row, plan: planCompanyLink(row, { batchTag }) }));
  const toApply = planned.filter((p) => p.plan.action === 'apply');
  const skippedGuard = planned.filter((p) => p.plan.action === 'skip');
  const skippedReasons = {};
  for (const s of skippedGuard) skippedReasons[s.plan.reason] = (skippedReasons[s.plan.reason] || 0) + 1;

  const ownerIds = toApply.map((p) => p.row.owner_org_id);
  const ownerState = await classifyOwnerState(ownerIds);
  const distinctOwners = new Set(ownerIds);
  const ownersGainingFirst = [...distinctOwners].filter((id) => !ownerState.hasPerson.has(id));
  const ownersInWorklist = [...distinctOwners].filter((id) => ownerState.inWorklist.has(id));
  const ownersGe1m = toApply.filter((p) => Number(p.row.rank_value) >= 1000000)
    .reduce((s, p) => (s.add(p.row.owner_org_id), s), new Set());

  const base = {
    ok: true,
    batch_tag: batchTag,
    exact_unique_total: total,
    would_apply: toApply.length,
    distinct_owner_orgs: distinctOwners.size,
    owners_gaining_first_contact: ownersGainingFirst.length,
    owners_in_worklist: ownersInWorklist.length,
    owners_ge_1m: ownersGe1m.size,
    skipped_guard: skippedGuard.length,
    skipped_reasons: skippedReasons,
    ambiguous_to_review: review.ambiguous,
    fuzzy_to_review: review.fuzzy,
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
    remaining_after: (typeof total === 'number') ? Math.max(0, total - edgesCreated) : null,
  });
}
