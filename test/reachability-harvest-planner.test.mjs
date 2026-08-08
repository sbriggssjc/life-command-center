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
} from '../api/_shared/reachability-harvest-planner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const adminJs = readFileSync(join(repoRoot, 'api/admin.js'), 'utf8');
const migration = readFileSync(join(repoRoot, 'supabase/migrations/20260826120000_lcc_w9_2_reachability_harvest.sql'), 'utf8');
const plannerJs = readFileSync(join(repoRoot, 'api/_shared/reachability-harvest-planner.js'), 'utf8');

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

test('planner never calls the network / imports nothing (pure brain)', () => {
  assert.ok(!/\bimport\b/.test(plannerJs.replace(/^\/\/.*$/gm, '')), 'planner must be dependency-free');
  assert.ok(!/fetch\(|require\(/.test(plannerJs), 'planner must not do I/O');
  assert.equal(HARVEST_ARM_DETERMINISTIC, 'deterministic');
  assert.equal(HARVEST_ARM_LLM, 'llm');
});
