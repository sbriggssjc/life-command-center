// C13g-min-lane (2026-09-09) — the entity_type_review Decision Center lane over
// C13g-min's retype write (lcc_retype_entity, migration 20261101120000).
//
// Layer 1 (behavioural): the pure planner — subject refs, the card, and the
// verdict gate with every refusal. Layer 2 (structural, comments stripped):
// the lane is registered in all four registries, the fetch reads the LIVE
// view, and the verdict path carries exactly ONE mutating write
// (rpc/lcc_retype_entity) and never PATCHes `entities` directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ENTITY_RETYPE_VERDICTS, ENTITY_RETYPE_SOURCE_VIEW,
  entityRetypeSubjectRef, parseEntityRetypeSubjectRef,
  buildEntityRetypeCard, validateEntityRetypeVerdict, orderEntityRetypeRows,
} from '../api/_shared/entity-retype-planner.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const baseRow = {
  entity_id: A, name: 'Gardner Tanenbaum Holdings', current_facts: 13, current_rent: '6170000',
  has_salesforce_contact: true, has_salesforce_account: false, n_rca_contact_ids: 2, n_costar_contact_ids: 0,
  looks_like_person_warning: false, has_org_marker: false, relationship_count: 4, resolved_owner_of: 13,
  blocks_own_t0e_sponsor_id: B, blocks_own_t0e_token: 'gardner',
};

test('subject_ref is scoped to one entity and round-trips', () => {
  assert.equal(entityRetypeSubjectRef(baseRow), 'etype:' + A);
  assert.equal(entityRetypeSubjectRef({}), null, 'no entity_id -> no ref');
  assert.deepEqual(parseEntityRetypeSubjectRef('etype:' + A), { entity_id: A });
  assert.equal(parseEntityRetypeSubjectRef('t0e:' + A + ':boyd'), null, 'a different lane\'s ref is not this one');
});

test('the card carries every view column and treats the name-shape flags as warnings, never gates', () => {
  const c = buildEntityRetypeCard(baseRow);
  assert.equal(c.entity_id, A);
  assert.equal(c.current_rent, 6170000);
  assert.equal(c.has_salesforce_contact, true);
  assert.equal(c.n_rca_contact_ids, 2);
  assert.equal(c.blocks_own_t0e_sponsor_id, B);
  assert.equal(c.blocks_own_t0e_token, 'gardner');
  // looks_like_person_warning=true does NOT change what the card reports; it is
  // a plain boolean the UI renders as a warning badge, never consulted by the gate.
  const flagged = buildEntityRetypeCard(Object.assign({}, baseRow, { looks_like_person_warning: true }));
  assert.equal(flagged.looks_like_person_warning, true);
  const noBlock = buildEntityRetypeCard(Object.assign({}, baseRow, { blocks_own_t0e_sponsor_id: null, blocks_own_t0e_token: null }));
  assert.equal(noBlock.blocks_own_t0e_sponsor_id, null);
});

test('validateEntityRetypeVerdict refuses an unknown verdict and a card with no entity_id', () => {
  assert.equal(validateEntityRetypeVerdict(null, 'retype_organization', {}, {}).ok, false);
  const card = buildEntityRetypeCard(baseRow);
  const r = validateEntityRetypeVerdict(card, 'bogus_verdict', {}, {});
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown verdict/);
});

test('retype_organization refuses a not-found entity, a tombstone, and a card whose recorded type moved on', () => {
  const card = buildEntityRetypeCard(baseRow);
  assert.match(validateEntityRetypeVerdict(card, 'retype_organization', {}, { not_found: true }).error, /not found/);
  assert.match(validateEntityRetypeVerdict(card, 'retype_organization', {}, { is_tombstone: true }).error, /tombstone/);
  assert.match(validateEntityRetypeVerdict(card, 'retype_organization', {}, { recorded_type: 'organization' }).error, /card is stale/);
  const ok = validateEntityRetypeVerdict(card, 'retype_organization', {}, { recorded_type: 'person' });
  assert.equal(ok.ok, true);
  assert.equal(ok.entity_id, A);
  assert.equal(ok.reason, null, 'no reason given -> null, never fabricated');
});

test('retype_organization carries the operator\'s reason through when given', () => {
  const card = buildEntityRetypeCard(baseRow);
  const ok = validateEntityRetypeVerdict(card, 'retype_organization', { reason: '  holds 13 facts, no real person does  ' }, { recorded_type: 'person' });
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, 'holds 13 facts, no real person does', 'trimmed');
  const blank = validateEntityRetypeVerdict(card, 'retype_organization', { reason: '   ' }, { recorded_type: 'person' });
  assert.equal(blank.reason, null, 'a blank reason is not a reason');
});

test('keep_person and research never consult the live entity facts', () => {
  const card = buildEntityRetypeCard(baseRow);
  assert.equal(validateEntityRetypeVerdict(card, 'keep_person', {}, { not_found: true, is_tombstone: true }).ok, true,
    'keep_person is record-only and cannot be refused by a live check');
  assert.equal(validateEntityRetypeVerdict(card, 'research', {}, {}).ok, true);
});

test('ordering: a card that blocks an OWN-T0e confirm sorts first, rent desc within, and a null rent sorts last', () => {
  const rows = [
    { name: 'no-block-low', current_rent: 5, blocks_own_t0e_sponsor_id: null },
    { name: 'no-block-null', current_rent: null, blocks_own_t0e_sponsor_id: null },
    { name: 'blocker-low', current_rent: 1, blocks_own_t0e_sponsor_id: B },
    { name: 'no-block-high', current_rent: 999, blocks_own_t0e_sponsor_id: null },
  ];
  assert.deepEqual(orderEntityRetypeRows(rows).map((r) => r.name), ['blocker-low', 'no-block-high', 'no-block-low', 'no-block-null']);
});

test('the verdict vocabulary is exactly three, closed', () => {
  assert.deepEqual([...ENTITY_RETYPE_VERDICTS].sort(), ['keep_person', 'research', 'retype_organization']);
  assert.equal(ENTITY_RETYPE_SOURCE_VIEW, 'v_lcc_entity_retype_candidates');
});

// ── structural ──────────────────────────────────────────────────────────────
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const admin = strip(readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8'));

function block(src, startNeedle, endRe) {
  const start = src.indexOf(startNeedle);
  assert.ok(start > 0, 'missing ' + startNeedle);
  const rest = src.slice(start);
  const m = endRe.exec(rest);
  assert.ok(m, 'no end for ' + startNeedle);
  return rest.slice(0, m.index);
}

test('registered in all four registries (admin set, ops set, lane meta + tile, review lane map)', () => {
  const ops = strip(readFileSync(new URL('../ops.js', import.meta.url), 'utf8'));
  const dc = strip(readFileSync(new URL('../dc-lanes.js', import.meta.url), 'utf8'));
  const rs = strip(readFileSync(new URL('../review-shared.js', import.meta.url), 'utf8'));
  assert.match(admin, /'entity_type_review',/);
  assert.match(admin, /case 'entity_type_review': return entityRetypeSubjectRef\(s\);/);
  assert.match(ops, /'entity_type_review',\s*'sponsor_family_confirm',\s*\]\);/, 'in _DC_FEDERATED');
  assert.match(ops, /\{ dt: 'entity_type_review', label: [^}]+renderFederatedLane\('entity_type_review'\)/);
  assert.match(dc, /entity_type_review: \{ title:/);
  assert.match(dc, /_dcFedType === 'entity_type_review'/);
  assert.match(dc, /dcFed\(' \+ i \+ ',\\'retype_organization\\'\)/);
  assert.match(dc, /dcFed\(' \+ i \+ ',\\'keep_person\\'\)/);
  assert.match(dc, /nx\.action === 'sponsor_family_lane'/, 'a successful retype can forward to the sponsor-family lane');
  assert.match(rs, /entity_type_review:\s*\{ lane: 'entity_merge'/);
});

test('the fetch branch reads the live view and never the sponsor-family cache', () => {
  const b = block(admin, "if (type === 'entity_type_review') {", /\n {2}if \(type === 'owner_reconcile'\)/);
  assert.match(b, /ENTITY_RETYPE_SOURCE_VIEW \+ '\?select=\*&limit=1000'/);
  assert.doesNotMatch(b, /SPONSOR_FAMILY_CACHE_TABLE/, 'this lane does not read the OWN-T0e cache');
  assert.match(b, /orderEntityRetypeRows\(/);
  assert.match(b, /out\.complete = out\.items\.length === ordered\.length/);
  assert.match(b, /truncated: rows\.length >= 1000/, 'a full page is flagged, never read as a total');
  assert.equal(ENTITY_RETYPE_SOURCE_VIEW, 'v_lcc_entity_retype_candidates');
});

test('the verdict path carries exactly ONE mutating write — rpc/lcc_retype_entity — and never PATCHes entities directly', () => {
  const b = block(admin, "if (decision.decision_type === 'entity_type_review') {", /\n {4}if \(decision\.decision_type === 'sponsor_family_confirm'\) \{/);
  const posts = (b.match(/opsQuery\('POST', [^,]+/g) || []).map((x) => x.replace(/\s+$/, ''));
  assert.deepEqual(posts.sort(), ["opsQuery('POST', 'rpc/lcc_retype_entity'"].sort(), 'exactly one write, the RPC');
  assert.equal((b.match(/rpc\/lcc_retype_entity/g) || []).length, 1, 'ONE call site, never a loop');
  assert.match(b, /p_entity: entityId, p_to: 'organization', p_decision_id: decisionId/);
  assert.equal((b.match(/opsQuery\('(PATCH|DELETE)'/g) || []).length, 0, 'no PATCH/DELETE — the RPC is the single writer');
  assert.doesNotMatch(b, /entities\?[^\n]*\n[\s\S]{0,200}PATCH/i);
  assert.equal((b.match(/domainQuery\(/g) || []).length, 0, 'no gov/dia write');
  assert.doesNotMatch(b, /lcc_entity_portfolio_facts|recorded_owners|true_owners|lcc_merge_entity/);
  // the card is re-read from the view AT VERDICT TIME (P188), never trusted from the request
  assert.match(b, /ENTITY_RETYPE_SOURCE_VIEW \+ '\?select=\*&entity_id=eq\./);
  // live facts are read before the gate runs, and the gate is the planner's
  assert.match(b, /entities\?select=id,merged_into_entity_id,entity_type&id=eq\./);
  assert.match(b, /validateEntityRetypeVerdict\(card, verdict, payload, live\)/);
  // reversal is named in the ledger row so an operator can find it
  assert.match(b, /reverse: 'select lcc_unretype_entity\(/);
  // the entity check is scoped to retype_organization only — keep_person/research
  // must not spend a round-trip on a live entities read
  assert.match(b, /if \(verdict === 'retype_organization'\) \{\s*\n\s*const entR = await opsQuery/);
});

test('the migration is the single source for the write, its reversal, and the privilege revoke', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261101120000_lcc_c13g_min_entity_retype.sql', import.meta.url), 'utf8')
    .replace(/^\s*--.*$/gm, '');
  assert.match(sql, /create or replace function lcc_retype_entity\(/);
  assert.match(sql, /create or replace function lcc_unretype_entity\(p_entity uuid\)/);
  assert.match(sql, /create or replace view v_lcc_entity_retype_candidates as/);
  assert.match(sql, /revoke all on function lcc_retype_entity\(uuid, text, uuid, text, text\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function lcc_unretype_entity\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /has_function_privilege\('anon', 'lcc_retype_entity/);
  assert.match(sql, /has_function_privilege\('anon', 'lcc_unretype_entity/);
  assert.match(sql, /if p_to is distinct from 'organization' then/, 'destination is a closed allowlist, not coerced');
  assert.match(sql, /if v_row\.entity_type::text is distinct from 'person' then/, 'source must be person');
});
