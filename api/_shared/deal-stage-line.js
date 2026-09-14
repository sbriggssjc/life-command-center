// api/_shared/deal-stage-line.js
// ============================================================================
// W7.4 — DETERMINISTIC deal stage-awareness line for the dossier header.
//
// 100% deterministic, NO LLM. Derived purely from the milestone-cues rows the
// W7.2 tick already writes (the collapse-aware `lcc_deal_milestone` set surfaced
// in the packet's deal.milestones). The rank ladder is the SAME one the collapse
// rule uses (api/_shared/deal-milestone-cues via deal-milestone-collapse), so the
// header and the collapse decision never disagree.
//
// "Stage awareness" =
//   • the LATEST (highest-rank) milestone the deal has reached, correspondence-aware;
//   • a REGRESSION flag when a prior-stage milestone RE-OCCURRED after a later one
//     (the Banning-style second-LOI-after-a-later-stage case) — i.e. the newest
//     dated milestone ranks BELOW the deal's high-water rank.
//
// Pure + testable: deriveStageLine(milestones) -> { line, latest_key, ... }.
// ============================================================================

import { stageRank } from './deal-milestone-collapse.js';

// Human labels for the canonical milestone keys (fallback: the key itself).
const KEY_LABEL = {
  prospecting: 'Prospecting',
  bov: 'BOV',
  ela: 'ELA signed',
  marketing: 'Marketing',
  offers: 'Offers',
  loi: 'LOI',
  psa: 'PSA',
  escrow: 'Escrow',
  diligence: 'Due diligence',
  financing: 'Financing',
  close: 'Closed',
};

function labelFor(key) {
  const k = String(key || '').trim().toLowerCase();
  return KEY_LABEL[k] || (k ? k.toUpperCase() : 'Unknown');
}

function toTime(d) {
  const t = d ? new Date(d).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
}

/**
 * Derive the deterministic stage line from a deal's milestone rows.
 * @param {Array} milestones  [{ milestone_key|key, date|occurred_on, last_seen_on?, status? }]
 * @returns {{
 *   line: string|null,
 *   latest_key: string|null,      highest-rank milestone reached
 *   latest_label: string|null,
 *   latest_on: string|null,
 *   high_water_rank: number,
 *   newest_key: string|null,      most-recently-dated milestone
 *   newest_on: string|null,
 *   regressed: boolean,
 *   regression_note: string|null
 * }}
 */
export function deriveStageLine(milestones) {
  const rows = (Array.isArray(milestones) ? milestones : [])
    .filter((m) => m && (m.milestone_key || m.key))
    .map((m) => {
      const key = String(m.milestone_key || m.key).trim().toLowerCase();
      // last_seen_on captures a rolled-up repeat; use the freshest date we have.
      const on = m.last_seen_on || m.date || m.occurred_on || null;
      return { key, rank: stageRank(key), on, t: toTime(m.last_seen_on || m.date || m.occurred_on) };
    });

  if (!rows.length) {
    return {
      line: null, latest_key: null, latest_label: null, latest_on: null,
      high_water_rank: 0, newest_key: null, newest_on: null, regressed: false, regression_note: null,
    };
  }

  // High-water = the furthest stage the deal EVER reached (max rank).
  let hw = rows[0];
  for (const r of rows) { if (r.rank > hw.rank) hw = r; }

  // Newest = the most-recently-dated milestone; on a date TIE prefer the HIGHER
  // rank (a same-day psa+escrow batch must resolve to escrow, not false-flag a
  // regression). Undated sorts last.
  let newest = rows[0];
  for (const r of rows) {
    if (r.t == null) continue;
    if (newest.t == null || r.t > newest.t || (r.t === newest.t && r.rank > newest.rank)) newest = r;
  }

  // Regression: the newest dated milestone ranks strictly BELOW the high-water
  // mark AND is a real, later-in-time touch (not the same row).
  const regressed = newest.t != null && hw.rank > 0 && newest.rank > 0 &&
    newest.rank < hw.rank &&
    (hw.t == null || newest.t >= hw.t);

  const latestLabel = labelFor(hw.key);
  let line = `Stage: ${latestLabel}`;
  if (hw.on) line += ` (as of ${String(hw.on).slice(0, 10)})`;
  let regression_note = null;
  if (regressed) {
    regression_note = `Regression flag — ${labelFor(newest.key)} re-occurred${newest.on ? ` ${String(newest.on).slice(0, 10)}` : ''} after reaching ${latestLabel}.`;
    line += ` · ${regression_note}`;
  }

  return {
    line,
    latest_key: hw.key,
    latest_label: latestLabel,
    latest_on: hw.on || null,
    high_water_rank: hw.rank,
    newest_key: newest.key,
    newest_on: newest.on || null,
    regressed,
    regression_note,
  };
}

export const __test__ = { KEY_LABEL, labelFor };
