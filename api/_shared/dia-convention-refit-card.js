// ============================================================================
// Rent Intelligence Engine — Phase 5h convention auto-refit runner + Teams note
// Life Command Center
//
// Runs the dia SQL refit dia_refit_tenant_conventions (quarterly empirical
// re-fit of tenant_lease_conventions from structured lease_escalations), then
// posts a Teams note so convention DRIFT is visible, not silent. A material
// annualized drift (>25 bps) writes a NEW versioned convention row for
// empirical/fallback rows (FMC's flagged placeholder graduates when its n
// clears); an approved_standard divergence is SURFACED, never auto-overridden.
//
// Non-blocking / drop-in for a cron / admin sub-route (pg_cron
// 'dia-convention-refit' already schedules the SQL quarterly; this runner adds
// the Teams note when driven from JS).
// ============================================================================

import { sendTeamsAlert } from './teams-alert.js';

const DOMAIN = 'dialysis';

/**
 * @param {function} domainQuery - _shared/domain-db.js helper (domain, method, path, body)
 * @param {object} [opts] { dryRun=false, minN=20, driftThreshold=0.0025, postCard=true }
 * @returns {Promise<{ok:boolean, verdict?:object, cardPosted?:boolean, reason?:string}>}
 */
export async function runConventionRefit(domainQuery, opts = {}) {
  try {
    if (typeof domainQuery !== 'function') return { ok: false, reason: 'no_domain_query' };
    const dryRun = opts.dryRun === true;
    const runRes = await domainQuery(DOMAIN, 'POST', 'rpc/dia_refit_tenant_conventions', {
      p_dry_run: dryRun,
      p_batch: null,
      p_min_n: opts.minN != null ? Number(opts.minN) : 20,
      p_drift_threshold: opts.driftThreshold != null ? Number(opts.driftThreshold) : 0.0025,
    });
    const verdict = runRes && runRes.ok ? (Array.isArray(runRes.data) ? runRes.data[0] : runRes.data) : null;
    if (!verdict) return { ok: false, reason: 'no_verdict', status: runRes?.status };

    let cardPosted = false;
    const moved = Number(verdict.refit_written) + Number(verdict.graduated) + Number(verdict.divergence_surfaced);
    if (!dryRun && opts.postCard !== false && moved > 0) {
      cardPosted = await surfaceRefitCard(domainQuery, verdict).catch((e) => {
        console.warn('[convention-refit] teams note failed', e?.message); return false;
      });
    }
    return { ok: true, verdict, cardPosted };
  } catch (err) {
    console.error('[convention-refit] runner error (non-blocking)', err?.message);
    return { ok: false, reason: 'threw', error: err?.message };
  }
}

async function surfaceRefitCard(domainQuery, verdict) {
  const res = await domainQuery(DOMAIN, 'GET',
    `dia_convention_refit_log?select=tenant_canonical,action,drift_bps,old_bump_pct,new_bump_pct,old_source,n_sample` +
    `&batch=eq.${encodeURIComponent(verdict.batch)}&order=action`);
  const rows = res?.ok && Array.isArray(res.data) ? res.data : [];
  if (!rows.length) return false;

  const facts = rows.map((r) => [
    `${r.tenant_canonical} — ${r.action}`,
    `${r.old_bump_pct}→${r.new_bump_pct} annualized (${Math.round(Number(r.drift_bps))} bps, n=${r.n_sample}, was ${r.old_source})`,
  ]);
  await sendTeamsAlert({
    title: `Tenant lease conventions re-fit — ${verdict.graduated} graduated, ${verdict.refit_written} refit, ${verdict.divergence_surfaced} divergence(s)`,
    summary:
      `Quarterly empirical re-fit of tenant escalation conventions. New versioned rows were written for ` +
      `empirical/fallback tenants on material annualized drift (>25 bps); approved-standard divergences are ` +
      `surfaced for human review (not auto-overridden). History is never mutated.`,
    facts,
    severity: 'info',
  });
  return true;
}
