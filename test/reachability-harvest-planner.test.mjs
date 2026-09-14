// W9.2 (Prompt 88) — tests for the contact-reachability internal-harvest planner
// + structural guards over admin.js / the migration (mirrors the U3/U5 test shape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  HARVEST_ARM_DETERMINISTIC, HARVEST_ARM_LLM,
  HARVEST_SOURCE_DETERMINISTIC, HARVEST_SOURCE_LLM,
  normDomain, domainContactColumn, contactSubjectRef, valueGateTargets,
  quoteVerbatimInEvidence, MIN_QUOTE_CHARS,
  looksLikeEmail, looksLikePhone, harvestValueValid, harvestValueNormalized, valueInQuote,
  assembleEvidence, evidenceIsEmpty, evidenceHash, harvestScoredKeyFor,
  buildReachabilityPrompt, parseHarvestJson, normalizeHarvestProposal,
  validateHarvestProposal, isProposableHarvest, HARVEST_MIN_CONFIDENCE,
  buildDeterministicProposal, scoreHarvestWithBudget,
  // W9.4 comms-harvest arm
  HARVEST_SOURCE_COMMS, parseHeaderAddress, isInternalEmail, isGenericInbox,
  commsRowHarvestable, commsRowEntityAnchors, extractSignaturePhones, signatureRegion,
  commsNewContactSubjectRef, buildCommsHeaderProposal,
  // Prompt 104 — create_contact precision (fan-out cap)
  HARVEST_MINT_FANOUT_MAX, createContactKey, createContactOwnerKey,
  createContactFanoutMap, createContactFanoutSuppressed,
  // Prompt 136 — the advancing target window
  HARVEST_TARGET_SCAN_PAGE, HARVEST_TARGET_SCAN_MAX, HARVEST_TARGET_SCAN_HARD_MAX,
  HARVEST_TARGET_MARKER_TTL_DAYS, harvestTargetScanCeiling,
  targetMarkerKey, targetMarkerIsActive, targetEvidenceSignal,
  selectHarvestTargets, planHarvestTargetMarkers,
} from '../api/_shared/reachability-harvest-planner.js';
import {
  isBrokerageEmail, isBrokerageContact, isBrokerageOwnerName,
} from '../api/_shared/comms-owner-attribution.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const adminJs = readFileSync(join(repoRoot, 'api/admin.js'), 'utf8');
const migration = readFileSync(join(repoRoot, 'supabase/migrations/20260826120000_lcc_w9_2_reachability_harvest.sql'), 'utf8');
const plannerJs = readFileSync(join(repoRoot, 'api/_shared/reachability-harvest-planner.js'), 'utf8');
const dcLanesJs = readFileSync(join(repoRoot, 'dc-lanes.js'), 'utf8');

// ---------------------------------------------------------------------------
test('domain column mapping + subject_ref are domain-aware and stable', () => {
  assert.equal(normDomain('dialysis'), 'dia');
  assert.equal(normDomain('government'), 'gov');
  assert.equal(domainContactColumn('dia', 'email'), 'contact_email');
  assert.equal(domainContactColumn('dia', 'phone'), 'contact_phone');
  assert.equal(domainContactColumn('gov', 'email'), 'email');
  assert.equal(domainContactColumn('gov', 'phone'), 'phone');
  assert.equal(contactSubjectRef('deterministic', 'dialysis', 'abc', 'email'), 'rh:deterministic:dia:abc:email');
  assert.equal(contactSubjectRef('llm', 'gov', 'x9', 'phone'), 'rh:llm:gov:x9:phone');
});

test('value-gate orders valued targets first, in rank order; zero-rank stable last', () => {
  const rows = [
    { target_contact_id: 'c', rank_value: 0 },
    { target_contact_id: 'a', rank_value: 2000001 },
    { target_contact_id: 'b', rank_value: 5 },
    { target_contact_id: 'd', rank_value: 0 },
  ];
  const out = valueGateTargets(rows).map((r) => r.target_contact_id);
  assert.deepEqual(out, ['a', 'b', 'c', 'd']);
});

// ---------------------------------------------------------------------------
test('value validity: real emails/phones pass, garbage fails', () => {
  assert.ok(looksLikeEmail('John.Doe@example.com'));
  assert.ok(!looksLikeEmail('not-an-email'));
  assert.ok(!looksLikeEmail('john@localhost'));
  assert.ok(looksLikePhone('(918) 555-1212'));
  assert.ok(looksLikePhone('1-918-555-1212'));
  assert.ok(!looksLikePhone('555-12'));
  assert.equal(harvestValueNormalized('email', ' John@X.COM '), 'john@x.com');
  assert.ok(harvestValueValid('email', 'a@b.co'));
  assert.ok(!harvestValueValid('phone', '12'));
});

test('verbatim validator: substring accepted, paraphrase rejected, min-length floor', () => {
  const ev = 'owner_contact_name: John Doe; owner_contact_email: john.doe@acme.com';
  assert.ok(quoteVerbatimInEvidence('owner_contact_email: john.doe@acme.com', ev));
  assert.ok(!quoteVerbatimInEvidence('john doe can be reached at his acme address', ev));
  assert.ok(!quoteVerbatimInEvidence('short', 'a short'));       // below MIN_QUOTE_CHARS
  assert.ok(MIN_QUOTE_CHARS >= 8);
});

test('valueInQuote: email substring; phone matched on digit-run', () => {
  const q = 'seller_name: Jane Roe; seller_email: jane@roe.com; phone (918) 555-0000';
  assert.ok(valueInQuote('email', 'jane@roe.com', q));
  assert.ok(!valueInQuote('email', 'other@roe.com', q));
  assert.ok(valueInQuote('phone', '9185550000', q));
  assert.ok(valueInQuote('phone', '(918) 555-0000', q));
  assert.ok(!valueInQuote('phone', '9185559999', q));
});

// ---------------------------------------------------------------------------
test('evidence assembly is bounded; empty short-circuits; hash is stable + evidence-sensitive', () => {
  const a = assembleEvidence([{ source: 'intake', ref: '1', text: 'owner_contact_email: a@b.com' }]);
  assert.equal(a.blocks.length, 1);
  assert.ok(!evidenceIsEmpty(a));
  assert.ok(evidenceIsEmpty(assembleEvidence([{ source: 'x', text: '   ' }])));
  const h1 = evidenceHash(a, 'email|John');
  const h2 = evidenceHash(a, 'email|John');
  const h3 = evidenceHash(a, 'phone|John');
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test('windowed-scan cursor keys are deterministic + re-scored only when evidence changes', () => {
  const a = assembleEvidence([{ source: 'intake', text: 'owner_contact_email: a@b.com' }]);
  const k1 = harvestScoredKeyFor('llm', 'dia', 'c1', 'email', evidenceHash(a, 'email|X'));
  const k2 = harvestScoredKeyFor('llm', 'dialysis', 'c1', 'email', evidenceHash(a, 'email|X'));
  assert.equal(k1, k2);   // normDomain collapses dia/dialysis → same marker (idempotent resume)
  const a2 = assembleEvidence([{ source: 'intake', text: 'owner_contact_email: changed@b.com' }]);
  const k3 = harvestScoredKeyFor('llm', 'dia', 'c1', 'email', evidenceHash(a2, 'email|X'));
  assert.notEqual(k1, k3); // evidence changed → new marker → re-scores
});

// ---------------------------------------------------------------------------
test('deterministic arm: builds a fill from a valid donor value; null on garbage', () => {
  const p = buildDeterministicProposal('email', { value: 'a@b.com', match_key: 'sf_contact_id', donor_contact_id: 'd9', donor_domain: 'gov' });
  assert.equal(p.verdict, 'fill_proposal');
  assert.equal(p.field, 'email');
  assert.equal(p.value, 'a@b.com');
  assert.equal(p.confidence, 1.0);
  assert.equal(p.evidence_quote, null);          // deterministic — pointer IS the evidence
  assert.equal(p.evidence_source, 'sf_contact_id:d9');
  assert.equal(p.source_pointer.match_key, 'sf_contact_id');
  assert.equal(buildDeterministicProposal('email', { value: 'nope', match_key: 'sf_contact_id' }), null);
  assert.equal(buildDeterministicProposal('phone', { value: '12' }), null);
});

// ---------------------------------------------------------------------------
test('LLM proposal normalization defaults to no_evidence; strips stray value on that verdict', () => {
  const p = normalizeHarvestProposal({ verdict: 'garbage', field: 'email', value: 'x@y.com', confidence: 5 });
  assert.equal(p.verdict, 'no_evidence_found');
  assert.equal(p.value, '');
  assert.equal(p.evidence_quote, '');
  const ok = normalizeHarvestProposal({ verdict: 'fill_proposal', field: 'email', value: 'x@y.com', confidence: 0.8, evidence_quote: 'q', evidence_source: 'E1' });
  assert.equal(ok.verdict, 'fill_proposal');
  assert.equal(ok.confidence, 0.8);
});

test('LLM validator: keeps a grounded fill; drops value-not-in-quote, non-verbatim, invalid', () => {
  const ev = 'owner_contact_name: John Doe; owner_contact_email: john@acme.com';
  // grounded (value in a verbatim quote) → kept + normalized
  const good = validateHarvestProposal(
    { verdict: 'fill_proposal', field: 'email', value: 'John@ACME.com',
      evidence_quote: 'owner_contact_email: john@acme.com' }, ev);
  assert.ok(good.proposal);
  assert.equal(good.proposal.value, 'john@acme.com');
  // value not in the quote → dropped
  const notInQuote = validateHarvestProposal(
    { verdict: 'fill_proposal', field: 'email', value: 'other@acme.com',
      evidence_quote: 'owner_contact_email: john@acme.com' }, ev);
  assert.equal(notInQuote.proposal, null);
  assert.equal(notInQuote.drop.reason, 'value_not_in_quote');
  // paraphrased quote → dropped
  const para = validateHarvestProposal(
    { verdict: 'fill_proposal', field: 'email', value: 'john@acme.com',
      evidence_quote: 'John can be reached at his acme email' }, ev);
  assert.equal(para.proposal, null);
  assert.equal(para.drop.reason, 'quote_not_verbatim');
  // invalid value → dropped
  const bad = validateHarvestProposal(
    { verdict: 'fill_proposal', field: 'email', value: 'notanemail', evidence_quote: ev }, ev);
  assert.equal(bad.proposal, null);
  assert.equal(bad.drop.reason, 'invalid_value');
  // no_evidence_found is NOT a drop
  const none = validateHarvestProposal({ verdict: 'no_evidence_found' }, ev);
  assert.equal(none.proposal, null);
  assert.equal(none.drop, null);
});

test('confidence floor gates proposability', () => {
  const v = { proposal: { confidence: 0.5 } };
  assert.ok(!isProposableHarvest(v, HARVEST_MIN_CONFIDENCE));
  assert.ok(isProposableHarvest({ proposal: { confidence: 0.9 } }, HARVEST_MIN_CONFIDENCE));
});

test('prompt embeds the contact + numbered evidence + strict-JSON + no-guess contract', () => {
  const prompt = buildReachabilityPrompt(
    { contact_name: 'John Doe', missing_fields: ['email'] },
    assembleEvidence([{ source: 'intake', ref: '7', text: 'owner_contact_email: john@x.com' }]));
  assert.match(prompt, /John Doe/);
  assert.match(prompt, /\[E1\]/);
  assert.match(prompt, /no_evidence_found/);
  assert.match(prompt, /VERBATIM/);
  assert.match(prompt, /never guess|do NOT guess/i);
});

test('tolerant JSON parse (fenced + embedded)', () => {
  assert.deepEqual(parseHarvestJson('```json\n{"verdict":"no_evidence_found"}\n```'), { verdict: 'no_evidence_found' });
  assert.equal(parseHarvestJson('nonsense'), null);
});

test('bounded scorer respects maxN + budget (injectable clock)', async () => {
  const items = [1, 2, 3, 4, 5];
  const r1 = await scoreHarvestWithBudget(items, async (x) => x * 2, { maxN: 2 });
  assert.equal(r1.scored, 2);
  assert.equal(r1.remaining_unscored, 3);
  let t = 0;
  const r2 = await scoreHarvestWithBudget(items, async (x) => x, { budgetMs: 10, now: () => (t += 6) });
  assert.ok(r2.budget_exhausted);
});

// ---------------------------------------------------------------------------
// Structural guards over admin.js + the migration (the U3/U5 pattern).
test('tick uses BATCHED in.() donor lookups + a single intake scan — no per-row fan-out', () => {
  // deterministic donor maps: batched in.() over an identity-key list.
  assert.match(adminJs, /sf_contact_id=in\.\(/);
  assert.match(adminJs, /salesforce_id=in\.\(/);
  // the LLM intake index is ONE bounded scan (paged), keyed in memory — not per-row.
  assert.match(adminJs, /harvestBuildIntakeIndex/);
  assert.match(adminJs, /HARVEST_INTAKE_INDEX_CAP/);
  // guard against a per-target intake round trip inside the target loop.
  assert.ok(!/for \(const t of allTargets\)[\s\S]{0,400}staged_intake_extractions\?/.test(adminJs),
    'must not query staged_intake_extractions per target');
});

test('tick routes deterministic-first: a deterministic donor short-circuits the LLM arm', () => {
  // the `continue` after a deterministic proposal skips the LLM arm for that field.
  assert.match(adminJs, /deterministic wins — do not also LLM this field/);
});

test('tick is proposal-only: never PATCHes a domain contact directly', () => {
  const tickBody = adminJs.slice(adminJs.indexOf('async function handleReachabilityHarvestTick'),
    adminJs.indexOf('// W8 U4 (Prompt 70) — Systemic-findings monthly report tick.'));
  assert.ok(!/domainQuery\([^)]*'PATCH'/.test(tickBody), 'the tick must not PATCH a domain contact');
  assert.ok(tickBody.includes("upsertHarvestProposal"), 'the tick writes proposals only');
});

test('the fill-blanks writer lives in the verdict branch + re-checks the blank (conflict, never clobber)', () => {
  const branch = adminJs.slice(adminJs.indexOf("decision.decision_type === 'reachability_harvest_review'"),
    adminJs.indexOf('// ---- naming_hygiene_review (W8 U5 / Prompt 79)'));
  assert.match(branch, /field_no_longer_blank/);          // re-check → conflict, not clobber
  assert.match(branch, /reachability_harvest_apply_log/); // reversible ledger FIRST
  assert.match(branch, /rpc\/lcc_merge_field/);           // provenance stamp
  assert.match(branch, /domainQuery\(dom, 'PATCH', 'contacts\?contact_id=eq\./); // the actual fill
});

test('migration registers BOTH provenance sources on the reachability fields (drift stays 0)', () => {
  for (const src of [HARVEST_SOURCE_DETERMINISTIC, HARVEST_SOURCE_LLM]) {
    assert.ok(migration.includes(src), 'missing fsp source ' + src);
  }
  assert.match(migration, /'dia\.contacts', 'contact_email', 'w9_2_internal_harvest', 60/);
  assert.match(migration, /'gov\.contacts', 'email',\s+'comms_observed',\s+40/);
  assert.match(migration, /'dia\.contacts', 'contact_phone'/);
  assert.match(migration, /'gov\.contacts', 'phone'/);
});

test('migration registers the flag OFF + a staggered cron + reversible ledgers', () => {
  assert.match(migration, /W9_2_REACHABILITY_HARVEST/);
  assert.match(migration, /'off'/);
  assert.match(migration, /'40 4 \* \* \*'/);            // 04:40 UTC, after the W8 chain
  assert.match(migration, /reachability-harvest-tick/);
  assert.match(migration, /reachability_harvest_apply_log/);
  assert.match(migration, /reachability_harvest_dropped_log/);
});

test('deterministic + llm arms both wired into the review CHECK + provenance_source CHECK', () => {
  assert.match(migration, /arm IN \('deterministic', 'llm'\)/);
  assert.match(migration, /provenance_source IN \('w9_2_internal_harvest', 'comms_observed'\)/);
});

// ===========================================================================
// W9.4 — comms-harvest arm
// ===========================================================================
test('parseHeaderAddress: display-name+email, quoted name, bare email, name-only', () => {
  assert.deepEqual(parseHeaderAddress('John Doe <j@x.com>'), { name: 'John Doe', email: 'j@x.com' });
  assert.deepEqual(parseHeaderAddress('"Doe, John" <J@X.com>'), { name: 'Doe, John', email: 'j@x.com' });
  assert.deepEqual(parseHeaderAddress('j@x.com'), { name: null, email: 'j@x.com' });
  // a "name" that is itself the email is not a display name
  assert.deepEqual(parseHeaderAddress('j@x.com <j@x.com>'), { name: null, email: 'j@x.com' });
  assert.deepEqual(parseHeaderAddress('Jane Roe'), { name: 'Jane Roe', email: null });
  assert.deepEqual(parseHeaderAddress(''), { name: null, email: null });
});

test('internal + generic-inbox guards reject non-BD / non-personal emails', () => {
  assert.ok(isInternalEmail('klargent@northmarq.com'));
  assert.ok(isInternalEmail('sbriggs@stanjohnsonco.com'));
  assert.ok(!isInternalEmail('doug@cushwake.com'));
  assert.ok(isGenericInbox('no-reply@alerts.costar.com'));
  assert.ok(isGenericInbox('info-passovgroup@shared1.ccsend.com'));
  assert.ok(isGenericInbox('sales@x.com'));
  assert.ok(!isGenericInbox('doug.longyear@cushwake.com'));
});

test('privacy-scope exclusion: private rows + unattributed rows are NOT harvestable', () => {
  const attributed = { visibility: 'shared', entity_id: 'e1', metadata: {} };
  const byMeta = { visibility: 'shared', metadata: { party_entity_id: 'p1' } };
  const byLinked = { visibility: 'shared', metadata: { linked_entity_ids: ['e9'] } };
  const priv = { visibility: 'private', entity_id: 'e1', metadata: { party_entity_id: 'p1' } };
  const unattributed = { visibility: 'shared', metadata: {} };
  assert.ok(commsRowHarvestable(attributed));
  assert.ok(commsRowHarvestable(byMeta));
  assert.ok(commsRowHarvestable(byLinked));
  assert.ok(!commsRowHarvestable(priv), 'private is excluded even when attributed');
  assert.ok(!commsRowHarvestable(unattributed), 'no attribution → excluded');
});

test('commsRowEntityAnchors dedups deal/party/linked ops entity ids', () => {
  const anchors = commsRowEntityAnchors({ entity_id: 'a', metadata: { party_entity_id: 'b', deal_entity_id: 'a', linked_entity_ids: ['c', 'b'] } });
  assert.deepEqual([...anchors].sort(), ['a', 'b', 'c']);
});

test('phone regex extracts signature phones with a verbatim span; rejects non-phones', () => {
  const body = 'Best,\nDOUG LONGYEAR\nEXECUTIVE DIRECTOR\n+1 415 705 9655\nDOUG.LONGYEAR@CUSHWAKE.COM';
  const phones = extractSignaturePhones(signatureRegion(body));
  assert.equal(phones.length, 1);
  assert.equal(phones[0].digits, '4157059655');
  // the span is a verbatim substring of the body containing the phone (validator floor)
  assert.ok(quoteVerbatimInEvidence(phones[0].span, body));
  assert.ok(valueInQuote('phone', phones[0].phone, phones[0].span));
  // a year-like digit run is not a phone
  assert.equal(extractSignaturePhones('founded in 2019, revenue up').length, 0);
});

test('buildCommsHeaderProposal: deterministic name-bound fill; drops internal/generic/invalid', () => {
  const p = buildCommsHeaderProposal('email', { value: 'Doug@Cushwake.com', message_id: 'AAA', quote: 'Doug Longyear <doug@cushwake.com>' });
  assert.equal(p.verdict, 'fill_proposal');
  assert.equal(p.value, 'doug@cushwake.com');
  assert.equal(p.confidence, 1.0);
  assert.equal(p.evidence_source, 'comms:AAA');
  assert.equal(p.source_pointer.via, 'comms_header');
  assert.equal(buildCommsHeaderProposal('email', { value: 'klargent@northmarq.com', message_id: 'B' }), null); // internal
  assert.equal(buildCommsHeaderProposal('email', { value: 'sales@x.com', message_id: 'B' }), null);            // generic
  assert.equal(buildCommsHeaderProposal('phone', { value: '12' }), null);                                      // invalid
  // comms deterministic still stamps the comms_observed provenance band
  assert.equal(HARVEST_SOURCE_COMMS, 'comms_observed');
});

test('commsNewContactSubjectRef is stable + email-keyed + domain-normalized', () => {
  assert.equal(commsNewContactSubjectRef('dialysis', 'own1', 'A@B.com'), 'rhc:dia:own1:a@b.com');
  assert.equal(commsNewContactSubjectRef('gov', 'own2', null), 'rhc:gov:own2:noemail');
});

// --- structural guards over the tick + verdict + lane (the U3/U5 pattern) ---
test('comms index is ONE bounded scan of the correspondence spine — no per-target fan-out', () => {
  assert.match(adminJs, /harvestBuildCommsIndex/);
  assert.match(adminJs, /HARVEST_COMMS_INDEX_CAP/);
  assert.match(adminJs, /visibility=neq\.private/);           // privacy scope enforced in the query
  assert.match(adminJs, /category=in\.\(email,call\)/);
  // no activity_events read inside the per-target loop
  assert.ok(!/for \(const t of allTargets\)[\s\S]{0,600}activity_events\?/.test(adminJs),
    'must not query activity_events per target');
});

test('comms arm routes deterministic-first: a comms header short-circuits the LLM arm', () => {
  assert.match(adminJs, /a deterministic comms fill wins — do not also LLM this field/);
  assert.match(adminJs, /provenanceSource: RH\.HARVEST_SOURCE_COMMS/);
});

test('create-contact is proposal-only + minted ONLY via the verdict (never auto)', () => {
  // the tick writes create-contact PROPOSALS (target_kind owner), never inserts a contact
  const tickBody = adminJs.slice(adminJs.indexOf('async function handleReachabilityHarvestTick'),
    adminJs.indexOf('// W8 U4 (Prompt 70) — Systemic-findings monthly report tick.'));
  assert.ok(!/domainQuery\([^)]*'POST', 'contacts'/.test(tickBody), 'the tick must not INSERT a domain contact');
  // the create-contact INSERT lives in the verdict branch, gated on target_kind='owner'
  const branch = adminJs.slice(adminJs.indexOf("decision.decision_type === 'reachability_harvest_review'"),
    adminJs.indexOf('// ---- naming_hygiene_review (W8 U5 / Prompt 79)'));
  assert.match(branch, /review\.target_kind === 'owner'/);
  assert.match(branch, /domainQuery\(dom, 'POST', 'contacts'/);      // the mint
  assert.match(branch, /contact_already_exists/);                    // idempotency / no-dup
  assert.match(branch, /reachability_harvest_apply_log/);            // reversible ledger FIRST
  assert.match(branch, /created_contact/);
});

test('signature-derived phones are LLM-only (never an arithmetic deterministic fill)', () => {
  // body-signature phones are tagged kind='signature'; the deterministic comms-header
  // path accepts ONLY kind='header' (a clean name↔value header bind).
  assert.match(adminJs, /addName\(name, null, p\.phone, p\.span, mid, st, 'signature'\)/);
  assert.match(adminJs, /h\.kind === 'header' && h\[field\]/);
});

test('bulk-confirm excludes create-contact (owner) rows — mints are per-card only', () => {
  assert.match(dcLanesJs, /c\.arm !== 'deterministic' \|\| c\.target_kind === 'owner'/);
  assert.match(dcLanesJs, /kind === 'create_contact' \|\| c\.target_kind === 'owner'/);
});

test('W9.4 migration adds NAME-field comms_observed fsp rows (drift stays 0) — no schema fork', () => {
  const w94 = readFileSync(join(repoRoot, 'supabase/migrations/20260827120000_lcc_w9_4_comms_harvest.sql'), 'utf8');
  assert.match(w94, /'dia\.contacts', 'contact_name', 'comms_observed', 40/);
  assert.match(w94, /'gov\.contacts', 'name',\s+'comms_observed', 40/);
  assert.match(w94, /W9_2_REACHABILITY_HARVEST/);       // rides the SAME flag
  assert.ok(!/CREATE TABLE/.test(w94), 'W9.4 forks no new table — extends W9.2');
});

test('planner never calls the network / imports nothing (pure brain)', () => {
  assert.ok(!/\bimport\b/.test(plannerJs.replace(/^\/\/.*$/gm, '')), 'planner must be dependency-free');
  assert.ok(!/fetch\(|require\(/.test(plannerJs), 'planner must not do I/O');
  assert.equal(HARVEST_ARM_DETERMINISTIC, 'deterministic');
  assert.equal(HARVEST_ARM_LLM, 'llm');
});

// ---------------------------------------------------------------------------
// Prompt 104 — W9.2/W9.4 create_contact PRECISION (kill the shared-broker fan-out)
// ---------------------------------------------------------------------------

test('createContactKey: email wins, name fallback, empty when neither', () => {
  assert.equal(createContactKey('Philip Sharrow', 'Philip.Sharrow@ScopeCRE.com'), 'e:philip.sharrow@scopecre.com');
  assert.equal(createContactKey('Jane Owner', ''), 'n:jane owner');
  assert.equal(createContactKey('', 'not-an-email'), '');
  assert.equal(createContactKey('', ''), '');
});

test('createContactOwnerKey: domain-scoped owner id; empty when no owner', () => {
  assert.equal(createContactOwnerKey({ domain: 'dialysis', target_owner_id: 'o1' }), 'dia:o1');
  assert.equal(createContactOwnerKey({ domain: 'gov', target_owner_id: 5 }), 'gov:5');
  assert.equal(createContactOwnerKey({ domain: 'gov' }), '');
});

test('fan-out cap: one contact across 2 distinct owners is suppressed (the Sharrow class)', () => {
  // Philip Sharrow (scopecre.com) proposed for TWO unrelated owners.
  const cands = [
    { contact_name: 'Philip Sharrow', value: 'philip.sharrow@scopecre.com', domain: 'dia', target_owner_id: 'boyd-watterson' },
    { contact_name: 'Philip Sharrow', value: 'philip.sharrow@scopecre.com', domain: 'dia', target_owner_id: 'bloomington-irs' },
    // A genuine single-owner owner contact — must NOT be suppressed.
    { contact_name: 'Jane Principal', value: 'jane@ownerllc.com', domain: 'gov', target_owner_id: 'owner-x' },
  ];
  const map = createContactFanoutMap(cands);
  assert.equal(map.get('e:philip.sharrow@scopecre.com').size, 2);
  assert.equal(map.get('e:jane@ownerllc.com').size, 1);
  const suppressed = createContactFanoutSuppressed(cands);
  assert.equal(HARVEST_MINT_FANOUT_MAX, 2);
  assert.ok(suppressed.has('e:philip.sharrow@scopecre.com'), 'the 2-owner fan-out is suppressed');
  assert.ok(!suppressed.has('e:jane@ownerllc.com'), 'the genuine single-owner contact passes');
});

test('fan-out cap: the SAME owner twice is NOT a fan-out (distinct-owner count = 1)', () => {
  const cands = [
    { contact_name: 'Bob', value: 'bob@ownerllc.com', domain: 'gov', target_owner_id: 'o1' },
    { contact_name: 'Bob', value: 'bob@ownerllc.com', domain: 'gov', target_owner_id: 'o1' },
  ];
  assert.equal(createContactFanoutSuppressed(cands).size, 0);
});

test('fan-out cap: tunable max raises the threshold', () => {
  const cands = [
    { contact_name: 'X', value: 'x@a.com', domain: 'gov', target_owner_id: 'o1' },
    { contact_name: 'X', value: 'x@a.com', domain: 'gov', target_owner_id: 'o2' },
  ];
  assert.ok(createContactFanoutSuppressed(cands, 2).has('e:x@a.com'));
  assert.equal(createContactFanoutSuppressed(cands, 3).size, 0, 'raising max to 3 spares the 2-owner spread');
});

test('brokerage-email guard: scopecre.com-class advisory domains dropped; owner domains pass', () => {
  assert.ok(isBrokerageEmail('philip.sharrow@scopecre.com'));
  assert.ok(isBrokerageEmail('broker@cbre.com'));
  assert.ok(isBrokerageEmail('agent@sub.jll.com'), 'subdomain of a brokerage domain still matches');
  assert.ok(!isBrokerageEmail('jane@ownerllc.com'));
  assert.ok(!isBrokerageEmail('not-an-email'));
});

test('brokerage-contact guard: name OR email domain trips it; genuine owner contact passes', () => {
  assert.ok(isBrokerageContact('Philip Sharrow', 'philip.sharrow@scopecre.com'), 'advisory email trips it');
  assert.ok(isBrokerageContact('CBRE Capital Markets', 'someone@genericllc.com'), 'brokerage name trips it');
  assert.ok(!isBrokerageContact('Jane Principal', 'jane@ownerllc.com'), 'a genuine owner contact passes');
  // reuse, not fork: the name guard is the SAME W9.6 predicate
  assert.equal(isBrokerageContact('Newmark', 'x@ownerllc.com'), isBrokerageOwnerName('Newmark'));
});

test('tick wires both create_contact guards into the mint arm + honest per-reason counts', () => {
  // fan-out computed globally over the raw candidate set BEFORE minting
  assert.match(adminJs, /RH\.createContactFanoutSuppressed\(/);
  assert.match(adminJs, /coaIsBrokerageContact\(p\.name, p\.email\)/);
  // honest per-reason counters, surfaced
  assert.match(adminJs, /counts\.comms\.brokerage_contact_suppressed \+= 1/);
  assert.match(adminJs, /counts\.comms\.fanout_suppressed \+= 1/);
  assert.match(adminJs, /create_fanout_suppressed: counts\.comms\.fanout_suppressed/);
  assert.match(adminJs, /out\.create_brokerage_suppressed = counts\.comms\.brokerage_contact_suppressed/);
});

test('create_contact guards do NOT touch the deterministic fill-blanks arm', () => {
  // the guards live only in the create-contact (step 5) loop, keyed on p.name/p.email —
  // the SF-donor deterministic arm (bySf/bySalesforce) is untouched.
  const detArm = adminJs.slice(adminJs.indexOf('-- ARM 1: deterministic exact-identity donor'),
    adminJs.indexOf('-- ARM 3a: deterministic COMMS header'));
  assert.ok(!/coaIsBrokerageContact|createContactFanoutSuppressed/.test(detArm),
    'the deterministic fill-blanks arm carries no create_contact precision guard');
});

// ===========================================================================
// Prompt 136 — the target window must ADVANCE.
//
// The live stall: a FIXED top-120 slice of a ~15k unreachable pool, re-selected
// every night, all yielding no evidence, never recorded as checked. These tests
// pin the exact silent failure — the SECOND run must see a DIFFERENT target set.
// (Mirrors the P135 property-twin guard shape.)
// ===========================================================================

// A 15k-row unreachable pool: only rows whose name is in the evidence index can
// ever yield a proposal. Ranks descend so paging order is deterministic.
function makeHarvestPool(n, { evidenceEvery = 0 } = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      domain: 'gov', target_contact_id: 'c' + String(i).padStart(6, '0'),
      contact_name: (evidenceEvery && i % evidenceEvery === 0) ? 'Evidence Person ' + i : 'Blank Person ' + i,
      sf_contact_id: null, salesforce_id: null, missing_fields: ['email', 'phone'],
      rank_value: n - i,
    });
  }
  return rows;
}
const pagerFor = (rows) => async (limit, offset) => rows.slice(offset, offset + limit);
const noEvidence = () => ({ has_evidence: false, sources: [] });

test('P136 selector: the window ADVANCES — run 2 sees a different target set', async () => {
  const pool = makeHarvestPool(15000);          // the live shape: nothing resolvable
  const fetchPage = pagerFor(pool);
  const markers = new Set();

  const run1 = await selectHarvestTargets({
    fetchPage, isMarked: (t) => markers.has(targetMarkerKey(t.domain, t.target_contact_id)),
    evidenceOf: noEvidence, want: 60,
  });
  assert.equal(run1.targets.length, 60, 'a run still fills its batch');
  assert.equal(run1.targets_with_evidence, 0, 'the live shape: none of them carry evidence');

  // Nothing was produced -> every selected target is marked (fix 1).
  const plan1 = planHarvestTargetMarkers(run1.targets, new Set());
  assert.equal(plan1.length, 60);
  assert.ok(plan1.every((m) => m.reason === 'no_evidence'));
  for (const m of plan1) markers.add(targetMarkerKey(m.domain, m.target_contact_id));

  const run2 = await selectHarvestTargets({
    fetchPage, isMarked: (t) => markers.has(targetMarkerKey(t.domain, t.target_contact_id)),
    evidenceOf: noEvidence, want: 60,
  });
  assert.equal(run2.targets.length, 60);
  assert.equal(run2.marker_skipped, 60, 'the previous window is skipped, not re-checked');
  const ids1 = new Set(run1.targets.map((t) => t.target_contact_id));
  const overlap = run2.targets.filter((t) => ids1.has(t.target_contact_id));
  assert.equal(overlap.length, 0, 'THE BUG: run 2 must not re-select run 1s targets');
  assert.equal(run2.targets[0].target_contact_id, 'c000060', 'rank order is preserved past the marked window');
});

test('P136 selector goes RED against the SHIPPED (pre-fix) behaviour', async () => {
  // The shipped bug reproduced exactly: nothing was ever recorded as checked, so
  // the marker predicate could never exclude anything. Same selector, isMarked
  // pinned false -> run 2 re-selects run 1's targets in full. This is what the
  // advance guard above asserts against; verified to fail (overlap 60) on it.
  const pool = makeHarvestPool(15000);
  const fetchPage = pagerFor(pool);
  const r1 = await selectHarvestTargets({ fetchPage, isMarked: () => false, evidenceOf: noEvidence, want: 60 });
  const r2 = await selectHarvestTargets({ fetchPage, isMarked: () => false, evidenceOf: noEvidence, want: 60 });
  const ids = new Set(r1.targets.map((t) => t.target_contact_id));
  assert.equal(r2.targets.filter((t) => ids.has(t.target_contact_id)).length, 60,
    'without markers the window is pinned — this is the live stall, and the guard above goes red on it');
  // ...and the fixed 120-target reading the diagnostic showed: 15k pool, 60 targets.
  assert.equal(r1.targets.length, 60);
  assert.ok(r1.remaining_untargeted > 5000, 'a huge pool sat behind the pinned window');
});

test('P136 selector: evidence-bearing targets are preferred over blind rank', async () => {
  // Evidence exists only every 100th row — under blind rank the top 60 carry NONE
  // (exactly the live donors_found:0 / with_evidence:0 reading).
  const pool = makeHarvestPool(15000, { evidenceEvery: 100 });
  const evidenceNames = new Set(pool.filter((r) => r.contact_name.startsWith('Evidence'))
    .map((r) => r.contact_name.toLowerCase()));
  const evidenceOf = (t) => targetEvidenceSignal(t, {
    hasIntakeName: (nm) => evidenceNames.has(nm), hasCommsName: () => false,
  });
  const blindTop60 = pool.slice(0, 60).filter((r) => evidenceNames.has(r.contact_name.toLowerCase()));
  assert.equal(blindTop60.length, 1, 'blind rank surfaces almost nothing resolvable');

  const sel = await selectHarvestTargets({
    fetchPage: pagerFor(pool), isMarked: () => false, evidenceOf, want: 60,
  });
  assert.ok(sel.targets_with_evidence > blindTop60.length,
    'evidence-first beats blind rank: ' + sel.targets_with_evidence + ' vs ' + blindTop60.length);
  assert.equal(sel.targets.length, 60, 'the batch is still filled — the remainder drains no-evidence rows');
  assert.ok(sel.targets.slice(0, sel.targets_with_evidence).every((t) => t.evidence_signal.has_evidence),
    'evidence-bearing targets rank first');
  assert.equal(sel.targets[0].evidence_signal.sources[0], 'intake');
});

test('P136 selector: honest counts distinguish a drained pool from a capped scan', async () => {
  // (a) Small, fully-scanned pool -> remaining_untargeted is a TOTAL, not capped.
  const small = makeHarvestPool(40);
  const drained = await selectHarvestTargets({
    fetchPage: pagerFor(small), isMarked: () => false, evidenceOf: noEvidence, want: 60,
  });
  assert.equal(drained.targets.length, 40);
  assert.equal(drained.remaining_untargeted, 0, 'nothing left behind');
  assert.equal(drained.scan_capped, false);
  assert.equal(drained.scan_exhausted, true);

  // (b) A capped scan reports a FLOOR — never "done".
  const big = makeHarvestPool(15000);
  const capped = await selectHarvestTargets({
    fetchPage: pagerFor(big), isMarked: () => false, evidenceOf: noEvidence,
    want: 60, pageSize: 500, maxScan: 1000,
  });
  assert.equal(capped.scan_capped, true, 'a windowed scan says so');
  assert.equal(capped.scanned, 1000);
  assert.equal(capped.remaining_untargeted, 940, 'a FLOOR of what this run could not reach');

  // (c) An entirely marked window: 0 selected, and that is honest, not a crash.
  const allMarked = await selectHarvestTargets({
    fetchPage: pagerFor(small), isMarked: () => true, evidenceOf: noEvidence, want: 60,
  });
  assert.equal(allMarked.targets.length, 0);
  assert.equal(allMarked.marker_skipped, 40);
  assert.equal(allMarked.remaining_untargeted, 0);
});

test('P136 selector: a POST-FILTERED short page is not the end of the slice', async () => {
  // The target fetch drops '' -blank rows in JS after the DB page returns. If the
  // filtered length were read as exhaustion, paging would stop early and re-pin the
  // very window this unit unpins — so `raw` (the DB page size) decides.
  const pool = makeHarvestPool(2000);
  let pagesFetched = 0;
  const fetchPage = async (limit, offset) => {
    pagesFetched += 1;
    const slice = pool.slice(offset, offset + limit);
    // keep only half of each page, as a post-filter would
    return { rows: slice.filter((_r, i) => i % 2 === 0), raw: slice.length };
  };
  const sel = await selectHarvestTargets({ fetchPage, isMarked: () => false, evidenceOf: noEvidence,
    want: 60, pageSize: 500, maxScan: 3000 });
  assert.ok(pagesFetched > 1, 'paging continued past the short filtered page');
  assert.equal(sel.eligible_scanned, 1000, 'every page was scanned, not just the first');
  assert.equal(sel.scan_exhausted, true);
  assert.equal(sel.targets.length, 60);
});

test('P136 scan ceiling grows with the marker prefix — markers cannot refill the window', async () => {
  // The second-order stall: markers are skipped in JS, so every marked row still
  // costs scan budget. With a FIXED ceiling the window refills with markers in weeks
  // and re-stalls. Simulated here: 6,000 markers occupying the head of the slice.
  const pool = makeHarvestPool(15000);
  const marked = new Set(pool.slice(0, 6000).map((t) => targetMarkerKey(t.domain, t.target_contact_id)));
  const isMarked = (t) => marked.has(targetMarkerKey(t.domain, t.target_contact_id));

  const fixed = await selectHarvestTargets({ fetchPage: pagerFor(pool), isMarked, evidenceOf: noEvidence,
    want: 60, pageSize: 500, maxScan: 6000 });
  assert.equal(fixed.targets.length, 0, 'a FIXED 6,000-row ceiling sees nothing but markers — re-stalled');

  const ceiling = harvestTargetScanCeiling(6000, 60, 6000);
  assert.ok(ceiling > 6000, 'the ceiling grows past the marker prefix');
  const adaptive = await selectHarvestTargets({ fetchPage: pagerFor(pool), isMarked, evidenceOf: noEvidence,
    want: 60, pageSize: 500, maxScan: ceiling });
  assert.equal(adaptive.targets.length, 60, 'the adaptive ceiling reaches past the marked prefix');
  assert.equal(adaptive.targets[0].target_contact_id, 'c006000');
  // ...and it is still bounded — never an unbounded scan.
  assert.equal(harvestTargetScanCeiling(1e9, 1e9), HARVEST_TARGET_SCAN_HARD_MAX);
  assert.equal(harvestTargetScanCeiling(0, 60), HARVEST_TARGET_SCAN_MAX, 'no markers -> the configured window');
});

test('P136 marker plan: produced targets are NOT marked; two reasons stay distinct', () => {
  const targets = [
    { domain: 'gov', target_contact_id: 'a', evidence_signal: { has_evidence: true, intake: true, sources: ['intake'] } },
    { domain: 'gov', target_contact_id: 'b', evidence_signal: { has_evidence: true, comms: true, sources: ['comms'] } },
    { domain: 'dia', target_contact_id: 'c', evidence_signal: { has_evidence: false, sources: [] } },
  ];
  const produced = new Set([targetMarkerKey('gov', 'a')]);
  const plan = planHarvestTargetMarkers(targets, produced, { sourceRunId: 'w92_test' });
  assert.equal(plan.length, 2, 'a target that produced fresh work keeps its slot');
  assert.deepEqual(plan.map((m) => m.target_contact_id), ['b', 'c']);
  // "evidence existed but produced nothing new" and "nothing could be proposed"
  // are DIFFERENT facts and must never wear one label.
  assert.equal(plan.find((m) => m.target_contact_id === 'b').reason, 'no_fresh_work');
  assert.equal(plan.find((m) => m.target_contact_id === 'c').reason, 'no_evidence');
  assert.equal(plan[0].source_run_id, 'w92_test');
  // The exclusion EXPIRES — an exclusion nothing clears is a permanent removal.
  const ttlMs = HARVEST_TARGET_MARKER_TTL_DAYS * 86400000;
  assert.equal(Date.parse(plan[0].recheck_after) - Date.parse(plan[0].checked_at), ttlMs);
});

test('P136 marker expiry: an expired marker stops excluding its target', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  assert.ok(targetMarkerIsActive({ recheck_after: '2026-09-20T00:00:00Z' }, now));
  assert.ok(!targetMarkerIsActive({ recheck_after: '2026-08-20T00:00:00Z' }, now), 'expired -> re-eligible');
  // Falls back to checked_at + TTL when recheck_after is absent.
  assert.ok(targetMarkerIsActive({ checked_at: '2026-08-25T00:00:00Z' }, now));
  assert.ok(!targetMarkerIsActive({ checked_at: '2026-06-25T00:00:00Z' }, now));
  assert.ok(!targetMarkerIsActive(null, now));
});

test('P136 evidence signal: intake / comms / SF identity are named, never blended', () => {
  const has = (set) => (nm) => set.has(nm);
  const sig = targetEvidenceSignal({ contact_name: 'Jane Doe', sf_contact_id: '003xx' }, {
    hasIntakeName: has(new Set(['jane doe'])), hasCommsName: has(new Set()),
  });
  assert.deepEqual(sig.sources, ['intake', 'sf_identity']);
  assert.ok(sig.has_evidence);
  // A nameless contact cannot join the name indexes — SF identity alone still counts.
  const nameless = targetEvidenceSignal({ contact_name: null, salesforce_id: '003yy' },
    { hasIntakeName: () => true, hasCommsName: () => true });
  assert.deepEqual(nameless.sources, ['sf_identity']);
  const nothing = targetEvidenceSignal({ contact_name: 'Nobody Here' },
    { hasIntakeName: () => false, hasCommsName: () => false });
  assert.equal(nothing.has_evidence, false);
  assert.deepEqual(nothing.sources, []);
});

test('P136 tick wiring: evidence-aware paged selection + marker write, honest counts', () => {
  // Indexes are built BEFORE target selection (the selection JOINS against them).
  const idxAt = adminJs.indexOf('const intake = await harvestBuildIntakeIndex();');
  const selAt = adminJs.indexOf('RH.selectHarvestTargets({');
  const donorAt = adminJs.indexOf('const donor = await harvestBuildDonorMaps(allTargets);');
  assert.ok(idxAt > 0 && selAt > idxAt, 'evidence indexes are built before target selection');
  assert.ok(donorAt > selAt, 'donor maps are built for the SELECTED batch');
  // Paging, not a fixed slice.
  assert.match(adminJs, /fetchHarvestTargets\(dom, lim, off\)/);
  assert.match(adminJs, /async function fetchHarvestTargets\(domain, cap, offset = 0\)/);
  assert.match(adminJs, /contact_id\.asc/, 'a stable tiebreak — OFFSET paging needs a total order');
  // Markers: read on both paths, written only on POST.
  assert.match(adminJs, /await fetchHarvestTargetMarkers\(\)/);
  assert.match(adminJs, /await writeHarvestTargetMarkers\(targetMarkerRows \|\| \[\]\)/);
  assert.match(adminJs, /RH\.planHarvestTargetMarkers\(allTargets, producedTargetKeys/);
  // Honest counts the prompt asks for, surfaced on the response.
  for (const k of ['targets_selected', 'targets_with_evidence', 'targets_marked_no_evidence', 'remaining_untargeted']) {
    assert.ok(adminJs.includes(k + ':'), 'summary carries ' + k);
  }
  assert.match(adminJs, /target_scan_capped: counts\.target_window\.scan_capped/);
  // The scan ceiling is adaptive — a fixed one refills with markers and re-stalls.
  assert.match(adminJs, /RH\.harvestTargetScanCeiling\(markersForDomain\(dom\), perDomain/);
});

test('P136 keeps every existing guard: proposal-only, verbatim, fanout/brokerage, budget', () => {
  // The create-contact arm still never mints — a human verdict does.
  assert.match(adminJs, /RH\.createContactFanoutSuppressed\(/);
  assert.match(adminJs, /coaIsBrokerageContact\(p\.name, p\.email\)/);
  // The verbatim validator still gates ARM 2, and the score budget still bounds it.
  assert.match(adminJs, /RH\.scoreHarvestWithBudget\(llmItems/);
  assert.match(adminJs, /validated\.drop.*dropped_not_verbatim|dropped_not_verbatim \+= 1/s);
  // Writes remain annotation-only against reachability_harvest_review.
  assert.match(adminJs, /'reachability_harvest_review\?on_conflict=subject_ref'/);
  // create_contact never resolves a CONTACT target's marker (owner-keyed, not target-keyed).
  const createArm = adminJs.slice(adminJs.indexOf('// 5. W9.4 CREATE-CONTACT arm'),
    adminJs.indexOf('// 6. P136 — plan the target markers'));
  assert.ok(!/noteProduced\(/.test(createArm),
    'the owner-keyed mint arm does not clear a contact target marker');
});

test('P136 migration: marker table is additive, expiring, reversible', () => {
  const p136 = readFileSync(join(repoRoot,
    'supabase/migrations/20260830120000_lcc_p136_reachability_harvest_target_marker.sql'), 'utf8');
  assert.match(p136, /CREATE TABLE IF NOT EXISTS public\.reachability_harvest_target_marker/);
  assert.match(p136, /UNIQUE \(domain, target_contact_id\)/, 'one marker per target — the upsert key');
  assert.match(p136, /recheck_after\s+timestamptz NOT NULL DEFAULT \(now\(\) \+ interval '30 days'\)/,
    'the exclusion EXPIRES');
  assert.match(p136, /CHECK \(reason IN \('no_evidence', 'no_fresh_work'\)\)/);
  assert.match(p136, /REVERSAL RUNBOOK/);
  assert.match(p136, /GRANT SELECT, INSERT, UPDATE ON public\.reachability_harvest_target_marker/);
  assert.ok(!/DROP TABLE (?!IF EXISTS public\.reachability_harvest_target_marker)/.test(p136),
    'additive — it drops nothing else');
});
