// api/_handlers/tier0-auto-attach-tick.js
// ============================================================================
// P194 (prompt 192 §1) — the Tier 0 auto-attach sweep.
//
//   GET  → DRY RUN. No writes, NOT flag-gated. Returns every candidate with the
//          person it would attach and the planner's verdict, so the flag can be
//          judged before it is flipped (the P140 `?generate=1` precedent: gating
//          the grade on the flag makes the layer ungradeable until after it
//          ships).
//   POST → writes, flag-gated TIER0_AUTO_ATTACH, bounded, resumable.
//
// WHAT IT DOES. P192 classified `decidability='auto'` — an EXACT domain↔owner-core
// match with exactly ONE eligible candidate — and left those cards in front of the
// operator because no sweep wrote them (hiding a card nobody attaches is the
// Class 7 failure). This is that sweep. The cards now leave the queue by being
// DONE.
//
// ⚠️ IT WRITES THROUGH THE HUMAN VERDICT'S OWN CODE, not a copy.
// `_shared/tier0-attach-effect.js::applyTier0Attach` is the single owner of the
// pivot write, the ledger row and the person→owner edge; `admin.js` calls the
// same function when Scott clicks. The shape gate (`validateTier0Verdict`) is
// re-run here at write time on a FRESHLY re-read row, exactly as the human path
// re-reads the card — a scan is a proposal, never an authorisation to write.
//
// ⚠️ WHY IT DOES NOT MINT AN `lcc_decisions` ROW. The lane's exclusion keys on
// `lcc_tier0_confirm_log(owner_entity_id, domain)`, so the ledger is what closes
// the card; a decision row is not needed to make the sweep work. And recording a
// "decided" verdict for a write nobody was asked about would put a human's name
// on an unattended action. `active_source='tier0_auto'` keeps the two
// distinguishable in the pivot forever.
//
// ⚠️ THE HONEST COUNT IS THE DRAIN, NOT THE TALLY. The run log records
// `cards_open_before` / `cards_open_after` alongside `attached`. A run where
// `attached > 0` and `cards_drained = 0` means the writes are not removing cards
// from the lane — which is precisely the failure that reads as success (P159a),
// and it is exactly what would have happened had P194 not also widened the lane
// view's `active_source` exclusion from `<> 'tier0_confirm'` to a SET: the first
// attach on an owner would have hidden that owner's OTHER open cards, so the
// drain would have OVERSTATED the work by silently deleting live questions.
// ============================================================================

import { randomUUID } from 'crypto';
import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import {
  buildTier0Card, tier0SubjectRef, validateTier0Verdict, rentBand,
  planTier0AutoAttach,
} from '../_shared/tier0-confirm-planner.js';
import {
  applyTier0Attach, tier0BatchTag, TIER0_SOURCE_AUTO,
} from '../_shared/tier0-attach-effect.js';

const FLAG = 'TIER0_AUTO_ATTACH';
const TRIAGE = 'v_lcc_tier0_owner_contact_lane_triage';
const RUN_LOG = 'lcc_tier0_auto_attach_run_log';
const DEFAULT_BATCH = 50;
// Inside lcc_cron_post's 60 s pg_net window, with room to close the run log.
const BUDGET_MS = 45_000;

const SELECT_COLS = 'owner_id,owner_name,owner_rent,owner_workspace_id,domain,'
  + 'n_candidates,n_eligible,n_excluded,n_link_evidence,n_person_evidence,'
  + 'match_arms,match_keys,people,rank_value,owner_domain_cards,'
  + 'match_strength,decidability';

// --------------------------------------------------------------------------
// Run log (P123 lifecycle): opened at entry, PATCHed on the way out. A row left
// reading 'started' is a handler that never came back — which pg_net cannot tell
// you, since it records only the HTTP attempt and prunes its response table to
// ~6 hours. Both writes are fail-soft: observability must never break the tick.
// --------------------------------------------------------------------------
async function openRunLog(row) {
  try {
    const r = await opsQuery('POST', RUN_LOG, row, { headers: { Prefer: 'return=representation' } });
    if (!r.ok) { console.error('[tier0-auto-attach] run-log open failed', r.status, r.data); return null; }
    const rec = Array.isArray(r.data) ? r.data[0] : r.data;
    return rec?.run_id ?? null;
  } catch (e) {
    console.error('[tier0-auto-attach] run-log open threw', String(e?.message || e));
    return null;
  }
}

async function closeRunLog(runId, row) {
  try {
    if (runId == null) { await openRunLog(row); return; }
    const r = await opsQuery('PATCH', `${RUN_LOG}?run_id=eq.${encodeURIComponent(runId)}`,
      row, { headers: { Prefer: 'return=minimal' } });
    if (r && r.ok === false) console.error('[tier0-auto-attach] run-log close failed', r.status, r.data);
  } catch (e) {
    console.error('[tier0-auto-attach] run-log close threw', String(e?.message || e));
  }
}

/** Count of everything the operator is currently asked — the population to drain. */
async function countOpenCards() {
  try {
    const r = await opsQuery('GET', 'v_lcc_tier0_owner_contact_lane_open?select=owner_id&limit=1',
      null, { headers: { Prefer: 'count=exact' } });
    const cr = r?.headers?.get?.('content-range');
    if (cr && cr.includes('/')) {
      const n = Number(cr.split('/')[1]);
      if (Number.isFinite(n)) return n;
    }
  } catch (_e) { /* soft */ }
  return null;
}

async function fetchAutoRows(limit) {
  const r = await opsQuery('GET', `${TRIAGE}?select=${SELECT_COLS}`
    + '&decidability=eq.auto&order=owner_rent.desc&limit=' + Math.max(1, Math.min(1000, limit)));
  if (!r.ok) return { ok: false, detail: r.data, rows: [] };
  return { ok: true, rows: Array.isArray(r.data) ? r.data : [] };
}

/** Re-read ONE card at write time. A scan result is stale by definition. */
async function reReadRow(ownerId, domain) {
  const r = await opsQuery('GET', `${TRIAGE}?select=${SELECT_COLS}`
    + '&owner_id=eq.' + encodeURIComponent(ownerId)
    + '&domain=eq.' + encodeURIComponent(domain) + '&limit=1');
  return (r.ok && Array.isArray(r.data)) ? (r.data[0] || null) : null;
}

export async function handleTier0AutoAttachTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const started = Date.now();
  const dryRun = req.method !== 'POST';
  const triggerSource = String(req.query.source || (dryRun ? 'manual' : 'api'));
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || DEFAULT_BATCH));

  let flagOn = false;
  try { flagOn = flagEnabled(await fetchFeatureFlag(FLAG)); } catch (_e) { flagOn = false; }

  const batchTag = 't0auto_' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
    + '_' + randomUUID().slice(0, 8);

  const runLogId = dryRun ? null : await openRunLog({
    status: 'started', trigger_source: triggerSource, batch_tag: batchTag,
    flag_enabled: flagOn, dry_run: false, batch_limit: limit,
  });

  try {
    const cardsOpenBefore = await countOpenCards();
    const scan = await fetchAutoRows(limit + 1);
    if (!scan.ok) {
      await closeRunLog(runLogId, {
        status: 'failed', ok: false, finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started, error_count: 1, detail: { scan_error: scan.detail },
      });
      return res.status(502).json({ error: 'triage_read_failed', detail: scan.detail });
    }
    const capped = scan.rows.length > limit;
    const rows = capped ? scan.rows.slice(0, limit) : scan.rows;

    // ---- plan (pure) -----------------------------------------------------
    // The SAME function decides the dry-run listing and the write set, so what
    // is graded is what runs.
    const planned = [];
    const skipped = [];
    for (const row of rows) {
      const plan = planTier0AutoAttach(row);
      if (plan.eligible) planned.push({ row, plan });
      else skipped.push({ owner_name: row.owner_name, domain: row.domain, reason: plan.reason });
    }

    // ---- GET: dry run ----------------------------------------------------
    if (dryRun) {
      return res.status(200).json({
        ok: true, mode: 'dry_run', writes: 0,
        flag: FLAG, flag_enabled: flagOn,
        note: flagOn
          ? 'Flag is ON — POST would write these.'
          : 'Flag is OFF — POST is a no-op. This grade is ungated on purpose, so the '
            + 'population can be read before the flag is flipped.',
        population: {
          auto_candidates: rows.length, planned: planned.length, skipped: skipped.length,
          capped, cards_open_now: cardsOpenBefore,
          rent_total: planned.reduce((a, p) => a + (Number(p.row.owner_rent) || 0), 0),
        },
        // Everything needed to read each row and say yes or no.
        proposals: planned.map(({ row, plan }) => ({
          owner_name: row.owner_name, owner_entity_id: row.owner_id, domain: row.domain,
          owner_rent: Number(row.owner_rent) || 0,
          rent_band: rentBand(row.owner_rent).band,
          match_arms: row.match_arms, match_keys: row.match_keys,
          person_name: plan.person.person_name, person_email: plan.person.email,
          person_role_bucket: plan.person.role_bucket || null,
          person_title: plan.person.title || null,
          person_company: plan.person.company || null,
          link_evidence: plan.person.link_evidence || [],
          person_evidence: plan.person.person_evidence || [],
          // The single most useful fact for judging the row (P188).
          evidence_headline: row.n_link_evidence > 0
            ? 'A candidate’s stated employer matches this owner.'
            : 'No candidate’s employer is on file as this owner — the match is the domain alone.',
          other_open_cards_for_this_owner: Math.max(0, (Number(row.owner_domain_cards) || 1) - 1),
        })),
        skipped,
      });
    }

    // ---- POST: write -----------------------------------------------------
    if (!flagOn) {
      await closeRunLog(runLogId, {
        status: 'completed', ok: true, finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started, auto_candidates: rows.length,
        planned: planned.length, attached: 0, failed_writes: 0,
        cards_open_before: cardsOpenBefore, cards_open_after: cardsOpenBefore,
        detail: { skipped_reason: 'flag_off' },
      });
      // A flag that is off is a state someone CHOSE; it is surfaced by
      // feature_flags_registry and Dormant Capabilities, so it raises no alert.
      return res.status(200).json({ ok: true, skipped: 'flag_off', flag: FLAG, writes: 0,
        would_attach: planned.length });
    }

    let attached = 0; let failedWrites = 0; let ownerHasContact = 0; let gateSkips = 0;
    let budgetStopped = false;
    const results = [];
    const errors = [];

    for (const { row } of planned) {
      if (Date.now() - started >= BUDGET_MS) { budgetStopped = true; break; }

      // Re-read at write time. Between the scan and now the owner may have
      // gained a contact, the person may have been renamed or merged away, or
      // the card may have been decided by a human in the Decision Center.
      const fresh = await reReadRow(row.owner_id, row.domain);
      if (!fresh) { gateSkips++; results.push({ owner_name: row.owner_name, domain: row.domain, outcome: 'card_gone' }); continue; }
      const freshPlan = planTier0AutoAttach(fresh);
      if (!freshPlan.eligible) {
        gateSkips++;
        results.push({ owner_name: row.owner_name, domain: row.domain, outcome: 'skipped:' + freshPlan.reason });
        continue;
      }
      // Re-run the SAME verdict gate a human click runs. Belt and braces on
      // purpose: this is the field the entire outreach chain reads.
      const gate = validateTier0Verdict(freshPlan.card, 'attach',
        { person_entity_id: freshPlan.person.person_id });
      if (!gate.ok) {
        gateSkips++;
        results.push({ owner_name: row.owner_name, domain: row.domain, outcome: 'gate:' + gate.error });
        continue;
      }

      const eff = await applyTier0Attach({
        card: freshPlan.card, person: gate.person,
        ownerId: fresh.owner_id, domain: fresh.domain,
        subjectRef: tier0SubjectRef(fresh.owner_id, fresh.domain),
        source: TIER0_SOURCE_AUTO,
        actor: null,
        rentBandName: rentBand(fresh.owner_rent).band,
        workspaceIdFallback: fresh.owner_workspace_id || null,
        batchTag,
      });

      if (eff.action === 'no_longer_actionable') {
        ownerHasContact++;
        results.push({ owner_name: fresh.owner_name, domain: fresh.domain,
          outcome: 'no_longer_actionable', existing_source: eff.existing_source });
      } else if (eff.ok) {
        attached++;
        results.push({ owner_name: fresh.owner_name, domain: fresh.domain, outcome: 'attached',
          person_name: gate.person.person_name, person_email: gate.person.email,
          relationship: eff.relationship, log_id: eff.log_id });
      } else {
        failedWrites++;
        errors.push({ owner_name: fresh.owner_name, domain: fresh.domain, error: eff.action, detail: eff.detail });
        results.push({ owner_name: fresh.owner_name, domain: fresh.domain, outcome: 'failed:' + eff.action });
      }
    }

    if (attached > 0) {
      try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
    }
    const cardsOpenAfter = await countOpenCards();

    await closeRunLog(runLogId, {
      status: 'completed', ok: failedWrites === 0, finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      auto_candidates: rows.length, planned: planned.length,
      skipped_not_auto: skipped.length, skipped_gate: gateSkips,
      skipped_owner_has_contact: ownerHasContact,
      attached, failed_writes: failedWrites,
      cards_open_before: cardsOpenBefore, cards_open_after: cardsOpenAfter,
      capped, budget_stopped: budgetStopped, error_count: errors.length,
      detail: { batch_tag: batchTag, errors: errors.slice(0, 10) },
    });

    return res.status(200).json({
      ok: failedWrites === 0, mode: 'write', flag_enabled: true, batch_tag: batchTag,
      // The STATE DELTA first; the tallies are secondary and labelled.
      cards_open_before: cardsOpenBefore, cards_open_after: cardsOpenAfter,
      cards_drained: (cardsOpenBefore != null && cardsOpenAfter != null)
        ? cardsOpenBefore - cardsOpenAfter : null,
      attached,
      // Re-discovery tallies — never read these as throughput (P159a).
      skipped_owner_already_had_contact: ownerHasContact,
      skipped_gate: gateSkips, failed_writes: failedWrites,
      capped, budget_stopped: budgetStopped,
      run_log_id: runLogId, results,
      reverse: 'update owner_contact_pivot p set active_contact_entity_id = l.prior_active_contact_entity_id,'
        + ' active_contact_name = l.prior_active_contact_name, active_source = l.prior_active_source'
        + " from lcc_tier0_confirm_log l where l.batch_tag = '" + batchTag + "'"
        + ' and l.reverted_at is null and p.entity_id = l.owner_entity_id;',
    });
  } catch (err) {
    await closeRunLog(runLogId, {
      status: 'failed', ok: false, finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started, error_count: 1,
      detail: { message: String(err?.message || err) },
    });
    console.error('[tier0-auto-attach-tick]', err?.message || err);
    return res.status(500).json({ error: 'tier0_auto_attach_failed', message: err?.message });
  }
}

export default handleTier0AutoAttachTick;
