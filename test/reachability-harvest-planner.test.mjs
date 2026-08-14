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
