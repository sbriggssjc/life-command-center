// ============================================================================
// MB-b — GET /api/market-brief-tab: read-only data for the homepage Market
// Briefs tab (#/briefs/<lane>, spec §2/MB4).
//
// Read-only, no writes. Ships flag-gated (MARKET_BRIEF_RENDER, spec §7 —
// "each step flag-gated OFF until verified live"): while off, the response
// says so plainly (`enabled:false`) rather than a 404/500 or a silently
// empty page, so the client can render an honest "not live yet" state
// instead of a broken one.
//
// Renders from v_market_brief_live / market_brief_issues ONLY — shares the
// exact same fetch/diff functions the daily email block uses
// (market-brief-render.js), so the tab and the email can never disagree
// about what "live" or "changed" means.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { buildLaneTabContext, KNOWN_LANES, LANE_LABELS } from '../_shared/market-brief-render.js';

const FLAG = 'MARKET_BRIEF_RENDER';

export async function handleMarketBriefTab(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const q = req.query || {};
  const lane = String(q.lane || 'dialysis').toLowerCase();

  if (!KNOWN_LANES.includes(lane)) {
    return res.status(400).json({ ok: false, error: `unknown lane '${lane}'`, available_lanes: KNOWN_LANES });
  }

  const flagRow = await fetchFeatureFlag(FLAG);
  const enabled = flagEnabled(FLAG, flagRow);

  if (!enabled) {
    return res.status(200).json({
      ok: true, enabled: false, lane, lane_label: LANE_LABELS[lane] || lane,
      sections: {}, archive: [], changed_since_last_issue: [],
      hint: `Set ${FLAG}=true (env or feature_flags_registry) once the producers have been verified live (spec §5).`,
    });
  }

  try {
    const ctx = await buildLaneTabContext(lane);
    return res.status(200).json({
      ok: true,
      enabled: true,
      lane,
      lane_label: LANE_LABELS[lane] || lane,
      has_facts: ctx.hasFacts,
      sections: ctx.sections,
      archive: ctx.archive,
      changed_since_last_issue: ctx.changedSinceLastIssue,
    });
  } catch (err) {
    return res.status(200).json({ ok: false, enabled: true, lane, error: err?.message || String(err) });
  }
}
