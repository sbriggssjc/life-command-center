// DIA1b (2026-09) — the dialysis Overview NPI tile read a raw diff-vs-
// auto-resolved count (~1,100) as if it were actionable work; the actual
// gated lane (v_lcc_research_lane_summary on LCC Opps, research_type IN
// npi_missing_inventory/npi_new_registration) reads 81 open. This pins the
// tile preferring the gated lane count, keeping the raw diff as an explicit
// labelled secondary, and adds an "as of" freshness stamp to the two
// MV-backed Overview sections (mv_dia_overview_stats.computed_at).
//
// Source assertions run against COMMENT-STRIPPED source and anchor on
// brace-balanced function spans (never a line number / fixed-character
// window) — see uxt0-defect-sweep.test.mjs for the same discipline.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
}

function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `${name} not found`);
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0, end = -1;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${name}`);
  return src.slice(start, end);
}

const rawSrc = read('dialysis.js');
const dia = stripComments(rawSrc);

describe('DIA1b — NPI tile prefers the gated research lane over the raw diff', () => {
  const actionItems = sliceFn(dia, 'renderDiaActionItemsInner');
  const overview = sliceFn(dia, 'renderDiaOverview');

  it('loadDiaData fetches the gated lane summary (no new view/table)', () => {
    const load = sliceFn(dia, 'loadDiaData');
    assert.match(load, /\/api\/queue\?view=research_lanes/,
      'must read the existing research_lanes sub-route — no new aggregation view');
    assert.match(load, /npi_missing_inventory/);
    assert.match(load, /npi_new_registration/);
    assert.match(load, /diaData\.npiLaneOpen\s*=/);
    assert.match(load, /diaData\.npiLaneLoaded\s*=/,
      'a loaded flag must exist so "0 open" and "could not load" are never confused');
  });

  it('the Action Items NPI card prefers npiLaneOpen when loaded', () => {
    assert.match(actionItems, /npiLaneOpen\s*=\s*\([\s\S]*?diaData\.npiLaneLoaded/,
      'npiLaneOpen must be read from diaData.npiLaneLoaded, not defaulted to 0');
    assert.match(actionItems, /npiDisplayCount\s*=\s*npiLaneOpen\s*!=\s*null\s*\?\s*npiLaneOpen\s*:\s*npiRawActionable/,
      'the displayed count must fall back to the raw diff ONLY when the lane failed to load');
  });

  it('the raw diff is kept as an explicit, labelled secondary figure, never dropped', () => {
    assert.match(actionItems, /raw signals \(not all actionable\)/,
      'the raw count must be visibly labelled as raw/not-all-actionable when the lane count is shown');
    assert.match(actionItems, /npiRawActionable/, 'the raw diff variable must still be computed');
  });

  it('a failed lane load is visibly marked, not silently rendered as the raw count', () => {
    assert.match(actionItems, /raw — lane count unavailable/,
      'when the lane fetch fails, the fallback display must say so rather than looking like a real lane count');
  });

  it('the Overview "NPI Signals" info card mirrors the same preference', () => {
    assert.match(overview, /npiLaneOpenCount\s*=\s*\(diaData\.npiLaneLoaded/);
    assert.match(overview, /npiDisplayCount\s*=\s*npiLaneOpenCount\s*!=\s*null\s*\?\s*npiLaneOpenCount\s*:\s*npiActionableCount/);
  });
});

describe('DIA1b — lease backfill is labelled a raw backlog, not an actionable queue', () => {
  const actionItems = sliceFn(dia, 'renderDiaActionItemsInner');
  const overview = sliceFn(dia, 'renderDiaOverview');

  it('the Action Items lease-backfill card no longer implies pure actionability', () => {
    assert.match(actionItems, /raw backlog/i);
    assert.doesNotMatch(actionItems, /'?\s*need lease backfill/,
      'the old "need lease backfill" phrasing read as an actionable directive; ' +
      'the real completion rate (26 rows, all on one 2026-04-29 timestamp, 0 since) ' +
      'does not support that framing');
  });

  it('the Overview Research Pipeline card is labelled the same way', () => {
    assert.match(overview, /missing lease data.*raw backlog/,
      'the Lease Backfill info card sub-label must say it is a raw backlog');
  });
});

describe('DIA1b — MV-backed Overview sections carry a visible "as of" freshness stamp', () => {
  it('_diaMvAsOfLabel / _diaMvAsOfLine exist and read mv.computed_at only', () => {
    const label = sliceFn(dia, '_diaMvAsOfLabel');
    assert.match(label, /computed_at/);
    // Never fabricate a "just now" when the timestamp is missing/unparseable.
    assert.match(label, /return null/);
  });

  it('Portfolio at a Glance calls the as-of line', () => {
    const body = sliceFn(dia, 'renderDiaPortfolioGlanceInner');
    assert.match(body, /_diaMvAsOfLine\(mv\)/,
      'the Portfolio-at-a-Glance section must surface the MV refresh timestamp');
  });

  it('Lease Expiration Risk calls the as-of line', () => {
    const body = sliceFn(dia, 'renderDiaLeaseExpRiskInner');
    assert.match(body, /_diaMvAsOfLine\(mv\)/,
      'the Lease-Expiration-Risk section must surface the MV refresh timestamp');
  });
});

describe('DIA1c — Operators Tracked reads the canonical count and its own honest residue', () => {
  // DIA1b pinned the OLD caption ("not canonicalized") as a guard against
  // silently rewording a mislabeled tile without fixing the underlying data.
  // DIA1c (Scott's decision S2) actually fixed the data layer instead: the
  // mv_dia_overview_stats.operators_tracked column itself is now
  // COUNT(DISTINCT properties.operator_id) — folded through the operator
  // registry + alias table, so "US Renal Care" / "Us Renal Care Inc" collapse
  // to one operator everywhere. The old wording is now false and must not
  // reappear; the caption must instead be DRIVEN by the new honest residue
  // column (mv.operators_unresolved), never a hardcoded claim of cleanliness.
  it('never re-states the DIA1b "not canonicalized" caveat — the fold is real now', () => {
    const body = sliceFn(dia, 'renderDiaPortfolioGlanceInner');
    assert.doesNotMatch(body, /not canonicalized/,
      'DIA1c folded operator identity at the data layer (properties.operator_id, ' +
      'mv_dia_overview_stats.operators_tracked = COUNT(DISTINCT operator_id)); ' +
      'the tile must not claim the old raw-text caveat any more');
  });

  it('the sub-label is driven by mv.operators_unresolved, never a hardcoded "clean" claim', () => {
    const body = sliceFn(dia, 'renderDiaPortfolioGlanceInner');
    assert.match(body, /Operators Tracked[\s\S]*?operators_unresolved/,
      'the caption must read the honest residue column (properties with a raw ' +
      'operator name that resolved to neither an operator_id nor a known ' +
      'category/payer/non_operator classification) rather than asserting the ' +
      'count is canonical without checking whether anything is still unresolved');
  });

  it('operators_tracked itself is read straight off the view, not re-derived client-side', () => {
    const body = sliceFn(dia, 'renderDiaPortfolioGlanceInner');
    assert.match(body, /n\(mv\.operators_tracked\)/,
      'the canonical count is computed once, in mv_dia_overview_stats (DIA1c), ' +
      'and the client must not re-count distinct operator strings itself');
  });
});
