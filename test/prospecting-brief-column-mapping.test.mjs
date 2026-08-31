// C10 — the prospecting brief read columns `v_bd_cadence_dashboard` does not have.
//
// `handleProspectingBrief` mapped the view onto display fields using the names
// `c.name`, `c.contact_name`, `c.company_name`, `c.org_name`, `c.annual_rent`
// and `c.priority_signal`. NONE of those is a column on that view. PostgREST
// returned its 37 real columns, JS read `undefined` off the rest, and every row
// of the call sheet rendered:
//
//   1. Unknown — unknown [mixed]
//      Email: eric.dowling@boydwatterson.com
//      Portfolio value: rent unknown | Days overdue: 43
//      Signal: none | Phase: prospecting
//
// Four of the six meaningful fields were dead. Nothing errored, nothing logged,
// and the row COUNT was correct throughout — the failure looked exactly like a
// working surface with thin data.
//
// It is also why C8's benefit was invisible: C8 had just put Easterly
// ($114.9M / 85 properties), NGP Capital and USAA Real Estate onto this sheet
// and every one of them rendered as "Unknown".
//
// GUARD DESIGN
// ------------
// Two structural invariants, neither of which pins a line number or greps for a
// literal that moves (CLAUDE.md block-slice footgun):
//
//   1. Every `c.<field>` the lcc_queue MAP reads must be a real column on
//      `v_bd_cadence_dashboard`. This is the defect itself.
//   2. Every `c.<field>` the lcc_queue RENDERER reads must be a key the map
//      actually produces. This is the same defect one layer down, and it is how
//      `priority_signal` survived: the renderer read a field nothing ever set.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING. The fix's own comments name
// `annual_rent`, `priority_signal`, `name` and `contact_name` while explaining
// what went wrong, so a detector that reads raw source would find the banned
// tokens present and pass over a real regression — the A5c / N18 lesson, where
// a migration header discussing a hazard satisfied the grep for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../api/operations.js', import.meta.url)), 'utf8');

// The live column list of public.v_bd_cadence_dashboard on LCC Opps
// (xengecqvemvfknjvbvrq), verified against information_schema 2026-08-31.
// Base view: migration 20260522260000; contact_id/contact_email 20260719124500;
// rank_value/rank_property_count/review_flag 20260616150000;
// is_resolved_owner/is_brokerage 20260831120000 (C8).
const VIEW_COLUMNS = new Set([
  'cadence_id', 'entity_id', 'entity_name', 'owner_role', 'workspace_id',
  'domain', 'phase', 'priority_tier', 'current_touch', 'next_touch_due',
  'next_touch_type', 'next_touch_template', 'days_until_next', 'days_overdue',
  'last_touch_at', 'last_touch_type', 'last_touch_template', 'emails_sent',
  'emails_opened', 'emails_replied', 'calls_made', 'calls_connected',
  'meetings_scheduled', 'consecutive_unopened', 'unsubscribe_status',
  'bd_opportunity_id', 'owner_user_id', 'total_property_count',
  'current_property_count', 'is_cross_vertical', 'contact_id', 'contact_email',
  'rank_value', 'rank_property_count', 'review_flag', 'is_resolved_owner',
  'is_brokerage',
]);

function stripComments(js) {
  // Block comments first, then line comments. Keeps newlines so that any
  // future line-based reasoning stays honest.
  return js
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// Slice a region between two STABLE identity tokens, never a line number.
function between(src, startToken, endToken, label) {
  const a = src.indexOf(startToken);
  assert.notEqual(a, -1, `${label}: start anchor not found — "${startToken}". ` +
    'If the handler was restructured, re-anchor this guard rather than deleting it.');
  const b = src.indexOf(endToken, a + startToken.length);
  assert.notEqual(b, -1, `${label}: end anchor not found — "${endToken}"`);
  return src.slice(a + startToken.length, b);
}

const CLEAN = stripComments(SRC);

const MAP_BODY = between(CLEAN,
  'contacts = queueResult.data.map(c => ({', '}));', 'lcc_queue map');

const RENDER_BODY = between(CLEAN,
  '? contacts.map((c, i) => {', "}).join('\\n\\n')", 'lcc_queue renderer');

function readsOf(region) {
  return [...region.matchAll(/\bc\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
}

test('C10: every column the prospecting-brief map reads exists on v_bd_cadence_dashboard', () => {
  const reads = readsOf(MAP_BODY);
  assert.ok(reads.length >= 8,
    `expected the map to read several view columns, saw ${reads.length} — ` +
    'the region anchors are probably stale');

  const bogus = [...new Set(reads)].filter(f => !VIEW_COLUMNS.has(f));
  assert.deepEqual(bogus, [],
    'handleProspectingBrief reads column(s) that do NOT exist on ' +
    `v_bd_cadence_dashboard: ${bogus.join(', ')}. ` +
    'PostgREST does not error on this — the field silently renders as its ' +
    'fallback on every row (C10). Map onto a real column, or add the column ' +
    'to the view and to VIEW_COLUMNS here in the same change.');
});

test('C10: the renderer only reads fields the map actually produces', () => {
  // Keys the map sets, e.g. `name:` / `rank_value:` at the head of a line.
  const produced = new Set(
    [...MAP_BODY.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]));

  assert.ok(produced.size >= 8,
    `expected the map to produce several fields, saw ${produced.size}`);

  const reads = readsOf(RENDER_BODY);
  assert.ok(reads.length >= 5,
    `expected the renderer to read several fields, saw ${reads.length}`);

  const unset = [...new Set(reads)].filter(f => !produced.has(f));
  assert.deepEqual(unset, [],
    `the call-sheet renderer reads field(s) the map never sets: ${unset.join(', ')}. ` +
    'This is how `priority_signal` rendered "none" on every row for months — ' +
    'an undefined field is indistinguishable from a measured absence (P180).');
});

test('C10: rank_value is not relabelled as annual rent', () => {
  // rank_value is COALESCE(NULLIF(current_annual_rent_total,0),
  // connected_property_value) — relationship-derived for a large minority of
  // rows (C9a). Presenting it as annual rent, or suffixing it "/yr", asserts an
  // annual figure we do not have.
  const produced = [...MAP_BODY.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]);
  assert.ok(!produced.includes('annual_rent'),
    'the prospecting-brief map must not expose rank_value under the name ' +
    '`annual_rent` — it is portfolio value, not owned annual rent (C9a).');
  assert.ok(!/\/yr/.test(RENDER_BODY),
    'the call sheet must not suffix the portfolio value with "/yr" — for a ' +
    'connected-property value there is no annual basis to claim (C9a).');
});
