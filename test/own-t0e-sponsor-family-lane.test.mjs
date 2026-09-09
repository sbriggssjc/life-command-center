// OWN-T0e (2026-09-09) — the sponsor_family_confirm Decision Center lane.
//
// Layer 1 (behavioural): the pure planner — subject refs, the card, and the
// verdict gate with every refusal the design names (§4). Layer 2 (structural,
// comments stripped): the lane is registered in all four registries, the fetch
// reads the CACHE not the 20 s view, the verdict path carries exactly ONE
// registry write and never touches a portfolio fact / merge / domain table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPONSOR_FAMILY_VERDICTS, SPONSOR_FAMILY_CACHE_TABLE, SPONSOR_FAMILY_REGISTRY_TABLE,
  sponsorTokenIsValid, sponsorFamilySubjectRef, parseSponsorFamilySubjectRef,
  buildSponsorFamilyCard, validateSponsorFamilyVerdict, orderSponsorFamilyRows,
} from '../api/_shared/sponsor-family-planner.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const breadthRow = {
  group_key_id: A, sponsor_id: A, sponsor_name: 'Boyd Watterson', sponsor_side: 'breadth',
  tied_pair: null, sponsor_token: 'boyd', properties: 20, gov_properties: 20, dia_properties: 0,
  annual_rent: '31000000', spe_names: ['Boyd Ashburn LLC', 'BOYD SACRAMENTO GSA, LLC'], spe_ids: [B, C],
  member_ids: [A, B, C], member_names: ['Boyd Watterson', 'Boyd Ashburn LLC', 'BOYD SACRAMENTO GSA, LLC'],
  sponsor_props: 79, spe_props_max: 1, same_party_suspect: false, same_party_pairs: 0,
  already_confirmed: false, also_confirmed_for_contacts: true, token_entities_fleetwide: 129,
  token_is_generic_word: false, refreshed_at: '2026-09-09T11:56:56Z',
};
const tiedRow = {
  group_key_id: A, sponsor_id: null, sponsor_name: null, sponsor_side: 'tied',
  tied_pair: 'NGP ~ NGP V OXFORD MS LLC', sponsor_token: 'ngp', properties: 8, gov_properties: 8, dia_properties: 0,
  annual_rent: '4000000', spe_names: null, spe_ids: null, member_ids: [A, B, C],
  member_names: ['NGP', 'NGP V OXFORD MS LLC', 'NGP V DURHAM NC LLC'],
  sponsor_props: 1, spe_props_max: 1, same_party_suspect: false, same_party_pairs: 0,
  already_confirmed: false, also_confirmed_for_contacts: false, token_entities_fleetwide: 41,
  token_is_generic_word: false,
};

test('subject_ref names the question: sponsor on a decided group, group key on a tied one', () => {
  assert.equal(sponsorFamilySubjectRef(breadthRow), 't0e:' + A + ':boyd');
  assert.equal(sponsorFamilySubjectRef(tiedRow), 't0e:tied:' + A + ':ngp');
  assert.equal(sponsorFamilySubjectRef({ sponsor_side: 'breadth', sponsor_token: 'x' }), null, 'no sponsor id → no ref');
  assert.deepEqual(parseSponsorFamilySubjectRef('t0e:' + A + ':boyd'), { tied: false, sponsor_id: A, sponsor_token: 'boyd' });
  assert.deepEqual(parseSponsorFamilySubjectRef('t0e:tied:' + A + ':ngp'), { tied: true, group_key_id: A, sponsor_token: 'ngp' });
  assert.equal(parseSponsorFamilySubjectRef('t0:' + A + ':boyd.com'), null, 'a Tier 0 ref is a different lane');
});

test('the card carries the design columns, labels the duplicate-entity signal, and never invents a sponsor for a tie', () => {
  const c = buildSponsorFamilyCard(breadthRow);
  assert.equal(c.sponsor_side, 'breadth');
  assert.equal(c.annual_rent, 31000000);
  assert.equal(c.flips_unclassified_rival_pairs, 20);
  assert.equal(c.duplicate_entity_suspect, false);
  assert.equal(c.also_confirmed_for_contacts, true);
  assert.deepEqual(c.member_names, breadthRow.member_names);
  const dup = buildSponsorFamilyCard(Object.assign({}, breadthRow, { spe_props_max: 18 }));
  assert.equal(dup.duplicate_entity_suspect, true, 'an SPE holding >= 2 properties is the duplicate-entity signal');
  const t = buildSponsorFamilyCard(tiedRow);
  assert.equal(t.sponsor_id, null);
  assert.equal(t.sponsor_side, 'tied');
  assert.deepEqual(t.spe_names, []);
});

test('token validity mirrors the registry CHECKs (>= 3 chars, [a-z0-9])', () => {
  assert.equal(sponsorTokenIsValid('boyd'), true);
  assert.equal(sponsorTokenIsValid('ngp'), true);
  assert.equal(sponsorTokenIsValid('ab'), false);
  assert.equal(sponsorTokenIsValid('Boyd'), false);
  assert.equal(sponsorTokenIsValid('boyd-w'), false);
});

test('confirm_family on a decided group takes the card sponsor and refuses a disagreeing client id', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  const ok = validateSponsorFamilyVerdict(card, 'confirm_family', {}, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.sponsor_entity_id, A);
  assert.equal(ok.sponsor_token, 'boyd');
  const bad = validateSponsorFamilyVerdict(card, 'confirm_family', { sponsor_entity_id: B }, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /does not match/);
});

test('confirm_family on a TIED group requires a sponsor pick that is a member', () => {
  const card = buildSponsorFamilyCard(tiedRow);
  const none = validateSponsorFamilyVerdict(card, 'confirm_family', {}, {});
  assert.equal(none.ok, false);
  assert.match(none.error, /sponsor_entity_id required/);
  const stranger = validateSponsorFamilyVerdict(card, 'confirm_family', { sponsor_entity_id: '44444444-4444-4444-8444-444444444444' }, {});
  assert.equal(stranger.ok, false);
  assert.match(stranger.error, /not a member/);
  const ok = validateSponsorFamilyVerdict(card, 'confirm_family', { sponsor_entity_id: B }, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.sponsor_entity_id, B);
});

test('confirm_family refuses on the LIVE facts: already in the registry, or a tombstoned sponsor', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  const dup = validateSponsorFamilyVerdict(card, 'confirm_family', {}, { registry_has: true, sponsor_is_tombstone: false });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /already confirmed/);
  const tomb = validateSponsorFamilyVerdict(card, 'confirm_family', {}, { registry_has: false, sponsor_is_tombstone: true });
  assert.equal(tomb.ok, false);
  assert.match(tomb.error, /merged away/);
  const badTok = validateSponsorFamilyVerdict(buildSponsorFamilyCard(Object.assign({}, breadthRow, { sponsor_token: 'ab' })),
    'confirm_family', {}, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(badTok.ok, false);
  assert.match(badTok.error, /registry check/);
});

test('a generic-word token does NOT refuse — it is the human call, recorded on the card', () => {
  const card = buildSponsorFamilyCard(Object.assign({}, breadthRow, { sponsor_token: 'realty', token_is_generic_word: true }));
  const ok = validateSponsorFamilyVerdict(card, 'confirm_family', {}, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(ok.ok, true);
  assert.equal(card.token_is_generic_word, true);
});

test('same_party / not_family / research never need the live facts; same_party validates an optional duplicate id', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  for (const v of ['same_party', 'not_family', 'research']) {
    assert.equal(validateSponsorFamilyVerdict(card, v, {}, undefined).ok, true, v);
  }
  const sp = validateSponsorFamilyVerdict(card, 'same_party', { duplicate_entity_id: B }, undefined);
  assert.equal(sp.duplicate_entity_id, B);
  const bad = validateSponsorFamilyVerdict(card, 'same_party', { duplicate_entity_id: '44444444-4444-4444-8444-444444444444' }, undefined);
  assert.equal(bad.ok, false);
  assert.equal(validateSponsorFamilyVerdict(card, 'attach', {}, undefined).ok, false, 'a Tier 0 verdict is not a lane verdict');
  assert.deepEqual([...SPONSOR_FAMILY_VERDICTS], ['confirm_family', 'same_party', 'not_family', 'research']);
});

// ── OWN-T0e-b: same_party + merge_now ─────────────────────────────────────
test('same_party without merge_now is record-only and never names a winner it was not given', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  const r = validateSponsorFamilyVerdict(card, 'same_party', { duplicate_entity_id: B }, undefined);
  assert.equal(r.ok, true);
  assert.equal(r.merge_now, false);
  assert.equal(r.sponsor_entity_id, A);
});

test('merge_now requires a named duplicate that is a member, distinct from the sponsor, live, and same-typed', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  const okLive = { sponsor_is_tombstone: false, duplicate_is_tombstone: false, sponsor_type: 'organization', duplicate_type: 'organization' };
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true }, okLive).error, /requires duplicate_entity_id/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: '44444444-4444-4444-8444-444444444444' }, okLive).error, /not a member/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: A }, okLive).error, /is the sponsor itself/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B },
    Object.assign({}, okLive, { duplicate_is_tombstone: true })).error, /already merged away/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B },
    Object.assign({}, okLive, { sponsor_is_tombstone: true })).error, /merged away/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B },
    Object.assign({}, okLive, { duplicate_type: 'person' })).error, /entity_type differs/);
  const ok = validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B }, okLive);
  assert.equal(ok.ok, true);
  assert.equal(ok.merge_now, true);
  assert.equal(ok.sponsor_entity_id, A, 'winner is the card sponsor');
  assert.equal(ok.duplicate_entity_id, B, 'loser is the named duplicate');
  // a missing type on either side does NOT refuse (unknown is not a mismatch)
  assert.equal(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B },
    { sponsor_type: 'organization', duplicate_type: null }).ok, true);
});

test('merge_now on a TIED group takes the operator-named survivor, which must be a member and not the duplicate', () => {
  const card = buildSponsorFamilyCard(tiedRow);
  const live = { sponsor_type: 'organization', duplicate_type: 'organization' };
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B }, live).error, /sponsor_entity_id required/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B, sponsor_entity_id: B }, live).error, /is the sponsor itself/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B, sponsor_entity_id: '44444444-4444-4444-8444-444444444444' }, live).error, /not a member/, 'a stranger survivor is refused');
  const ok = validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B, sponsor_entity_id: C }, live);
  assert.equal(ok.ok, true);
  assert.equal(ok.sponsor_entity_id, C);
  assert.equal(ok.duplicate_entity_id, B);
});

test('ordering: breadth-decided groups first, rent desc within, and a null rent sorts last', () => {
  const rows = [
    { sponsor_side: 'tied', annual_rent: 9e9, sponsor_name: 't' },
    { sponsor_side: 'breadth', annual_rent: null, sponsor_name: 'b-null' },
    { sponsor_side: 'breadth', annual_rent: 5, sponsor_name: 'b5' },
    { sponsor_side: 'breadth', annual_rent: 50, sponsor_name: 'b50' },
  ];
  assert.deepEqual(orderSponsorFamilyRows(rows).map((r) => r.sponsor_name), ['b50', 'b5', 'b-null', 't']);
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
  assert.match(admin, /'sponsor_family_confirm',/);
  assert.match(admin, /case 'sponsor_family_confirm': return sponsorFamilySubjectRef\(s\);/);
  assert.match(ops, /'sponsor_family_confirm',\n\]\);/, 'in _DC_FEDERATED');
  assert.match(ops, /\{ dt: 'sponsor_family_confirm', label: [^}]+renderFederatedLane\('sponsor_family_confirm'\)/);
  assert.match(dc, /sponsor_family_confirm: \{ title:/);
  assert.match(dc, /_dcFedType === 'sponsor_family_confirm'/);
  assert.match(dc, /onclick="dcSponsorFamilyConfirm\(/);
  assert.match(dc, /window\.dcSponsorFamilyConfirm = dcSponsorFamilyConfirm/);
  assert.match(dc, /nx\.action === 'merge_lane'/, 'same_party forwards to the merge lane');
  assert.match(dc, /window\.dcSponsorFamilyMergeNow = dcSponsorFamilyMergeNow/, 'OWN-T0e-b merge-now helper exported');
  assert.match(dc, /const payload = \{ merge_now: true, duplicate_entity_id: dup \}/, 'merge_now rides the payload with the named duplicate');
  assert.match(dc, /if \(typeof window\.confirm === 'function' && !window\.confirm\([^\n]*\) return;/, 'a second confirm guards the one entity-moving verdict');
  assert.match(rs, /sponsor_family_confirm:\s*\{ lane: 'ownership'/);
});

test('the fetch branch reads the CACHE table, never the 20 s view, and re-derives already_confirmed live', () => {
  const b = block(admin, "if (type === 'sponsor_family_confirm') {", /\n {2}if \(type === 'owner_reconcile'\)/);
  assert.match(b, /SPONSOR_FAMILY_CACHE_TABLE \+ '\?select=\*&limit=1000'/);
  assert.doesNotMatch(b, /v_lcc_ownt0e_sponsor_family_proposals\b/, 'the view is not a request path');
  assert.match(b, /SPONSOR_FAMILY_REGISTRY_TABLE \+ '\?select=sponsor_entity_id,sponsor_token/);
  assert.match(b, /rows\.filter\(\(r\) => !\(r\.sponsor_id && reg\.has\(String\(r\.sponsor_id\)/, 'registry membership filters the list');
  assert.match(b, /cache_truncated: rows\.length >= 1000/, 'a full page is flagged, never read as a total');
  assert.match(b, /orderSponsorFamilyRows\(/);
  assert.match(b, /out\.complete = out\.items\.length === ordered\.length/);
  assert.equal(SPONSOR_FAMILY_CACHE_TABLE, 'lcc_ownt0e_sponsor_family_proposals_cache');
  assert.equal(SPONSOR_FAMILY_REGISTRY_TABLE, 'lcc_ownership_sponsor_family');
});

test('the verdict path carries exactly ONE write — a POST to the registry — and touches nothing else', () => {
  const b = block(admin, "if (decision.decision_type === 'sponsor_family_confirm') {", /\n {4}return res\.status\(400\)\.json\(\{ error: 'unsupported_decision_type'/);
  const posts = (b.match(/opsQuery\('POST', [^,]+/g) || []).map((x) => x.replace(/\s+$/, ''));
  // OWN-T0e-b added the merge path: the registry INSERT, the single lcc_merge_entity
  // call, and the two cache refreshes the merge lane also issues. Nothing else.
  assert.deepEqual(posts.sort(), [
    "opsQuery('POST', 'rpc/lcc_merge_entity'",
    "opsQuery('POST', 'rpc/lcc_refresh_buyer_spe_resolved'",
    "opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved'",
    "opsQuery('POST', SPONSOR_FAMILY_REGISTRY_TABLE",
  ].sort(), 'exactly: one registry write, one merge, two refreshes');
  assert.equal((b.match(/rpc\/lcc_merge_entity/g) || []).length, 1, 'ONE merge call site, never a loop');
  assert.match(b, /\{ p_loser: gate\.duplicate_entity_id, p_winner: gate\.sponsor_entity_id \}/, 'loser = named duplicate, winner = sponsor');
  assert.match(b, /if \(action === 'same_party' && gate\.merge_now\)/, 'merge only on the planner\'s merge_now');
  assert.match(b, /duplicate_is_tombstone: candidateDup \? \(!dupEnt \|\| dupEnt\.merged_into_entity_id != null\)/, 'loser liveness read live');
  assert.match(b, /entity_type&id=eq\./, 'entity_type read live for the same-type guard');
  assert.equal((b.match(/opsQuery\('(PATCH|DELETE)'/g) || []).length, 0, 'no PATCH/DELETE');
  assert.equal((b.match(/domainQuery\(/g) || []).length, 0, 'no gov/dia write');
  assert.doesNotMatch(b, /lcc_entity_portfolio_facts|recorded_owners|true_owners/);
  // live guards are READ before the gate runs, and the gate is the planner's
  assert.match(b, /entities\?select=id,merged_into_entity_id,entity_type&id=eq\./);
  assert.match(b, /validateSponsorFamilyVerdict\(card, verdict, payload, live\)/);
  // the card is re-read from the cache by the SAME key the subject_ref names
  assert.match(b, /SPONSOR_FAMILY_CACHE_TABLE \+ '\?select=\*'/);
  assert.match(b, /sponsor_is_tombstone: !ent \|\| ent\.merged_into_entity_id != null/, 'unreadable entity fails CLOSED');
  // the registry row carries the decision id so DELETE-by-notes reverses it
  assert.match(b, /notes = 'decision:' \+ decisionId/);
  assert.match(b, /token_is_generic_word: card\.token_is_generic_word/, 'generic-token confirms are recorded, not refused');
});

test('the migration restates the whole view, appends the three id columns LAST, and locks the cache to service_role', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260909120000_lcc_own_t0e_proposals_member_ids.sql', import.meta.url), 'utf8')
    .replace(/^\s*--.*$/gm, '');
  assert.match(sql, /create or replace view public\.v_lcc_ownt0e_sponsor_family_proposals as/);
  assert.match(sql, /lcc_ownership_sponsor_token\(/, 'the ONE sanctioned proposer');
  assert.match(sql, /g\.member_ids,\s*\n\s*g\.spe_ids,\s*\n\s*g\.member_names\s*\nfrom grp g/, 'appended last');
  assert.match(sql, /create table if not exists public\.lcc_ownt0e_sponsor_family_proposals_cache/);
  assert.match(sql, /revoke all on table public\.lcc_ownt0e_sponsor_family_proposals_cache from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.lcc_ownt0e_refresh_proposals\(\) from public, anon, authenticated/);
  assert.match(sql, /cron\.schedule\('lcc-ownt0e-proposals-refresh', '27 \*\/4 \* \* \*'/);
  // invoker-rights: the function header runs straight from `returns int` to `language plpgsql`
  // to `as $fn$` with no definer clause (the COMMENT names "SECURITY DEFINER" while saying
  // it is absent — so the assertion reads the header, not the file, per OCR1c)
  assert.match(sql, /lcc_ownt0e_refresh_proposals\(\)\s*\nreturns int\s*\nlanguage plpgsql\s*\nas \$fn\$/);
  // read-side only: no registry insert, no merge CALL, no fact update. The view
  // COMMENT names lcc_merge_entity in prose, so the merge check is on a call shape.
  // (the view COMMENT says "a confirm is one human INSERT into lcc_ownership_sponsor_family"
  //  in prose, so the check is on the STATEMENT shape — a column list or VALUES after the name)
  assert.doesNotMatch(sql, /insert into (public\.)?lcc_ownership_sponsor_family\s*(\(|values|select)/i, 'no registry write');
  assert.doesNotMatch(sql, /(select|perform)\s+lcc_merge_entity\(/i, 'no merge call');
  assert.doesNotMatch(sql, /update (public\.)?lcc_entity_portfolio_facts/i, 'no fact update');
});
