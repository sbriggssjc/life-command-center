// W9.1 (Prompt 98) — contact-acquisition engine, Stage 1. Pure-planner unit tests
// + structural read-only-until-verdict guards over the tick / verdict / migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  STAGE_1_ORDER, STAGE_CROSSREF, STAGE_INSTITUTION, STAGE_DEED, STAGE_BROKER, STAGE_SOS,
  STAGE_META, stageProposedKind, stageContactRole, valueGateOwners, runStagesForOwner,
  finalizeProposal, acquisitionSubjectRef, looksLikePersonName, nameInQuote,
  buildCrossrefProposal, buildInstitutionProposal, buildDeedSignatoryProposal, buildBrokerProposal,
  isBrokerTypingValid,
} from '../api/_shared/contact-acquisition-planner.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dir, '..', p), 'utf8');

// ── Stage order / stop-at-first-success ──────────────────────────────────────
test('STAGE_1_ORDER is cost-ordered and excludes the Stage-2 SOS stage', () => {
  assert.deepEqual(STAGE_1_ORDER, [STAGE_CROSSREF, STAGE_INSTITUTION, STAGE_DEED, STAGE_BROKER]);
  assert.ok(!STAGE_1_ORDER.includes(STAGE_SOS), 'SOS is Stage 2, not run in Stage 1');
});

test('runStagesForOwner stops at the first stage that yields a proposal', async () => {
  const calls = [];
  const stageFns = {
    [STAGE_CROSSREF]: async () => { calls.push(STAGE_CROSSREF); return null; },
    [STAGE_INSTITUTION]: async () => { calls.push(STAGE_INSTITUTION); return { stage: STAGE_INSTITUTION }; },
    [STAGE_DEED]: async () => { calls.push(STAGE_DEED); return { stage: STAGE_DEED }; },
    [STAGE_BROKER]: async () => { calls.push(STAGE_BROKER); return { stage: STAGE_BROKER }; },
  };
  const out = await runStagesForOwner({ entity_id: 'o1' }, stageFns, STAGE_1_ORDER);
  assert.equal(out.stage, STAGE_INSTITUTION);
  assert.equal(out.stopped_at_success, true);
  // deed/broker are NOT called after institution succeeds.
  assert.deepEqual(calls, [STAGE_CROSSREF, STAGE_INSTITUTION]);
});

test('runStagesForOwner returns no proposal when every stage is empty', async () => {
  const stageFns = { [STAGE_CROSSREF]: async () => null, [STAGE_BROKER]: async () => null };
  const out = await runStagesForOwner({ entity_id: 'o1' }, stageFns, [STAGE_CROSSREF, STAGE_BROKER]);
  assert.equal(out.proposal, null);
  assert.equal(out.stopped_at_success, false);
});

test('a pluggable stage list is honoured (Stage-2 seam) — appended SOS runs last', async () => {
  const calls = [];
  const stageFns = {
    [STAGE_CROSSREF]: async () => { calls.push('cr'); return null; },
    [STAGE_SOS]: async () => { calls.push('sos'); return { stage: STAGE_SOS }; },
  };
  const out = await runStagesForOwner({ entity_id: 'o1' }, stageFns, [STAGE_CROSSREF, STAGE_SOS]);
  assert.equal(out.stage, STAGE_SOS);
  assert.deepEqual(calls, ['cr', 'sos']);
});

// ── Attach vs mint routing ───────────────────────────────────────────────────
test('stage → kind/role routing is canonical', () => {
  assert.equal(stageProposedKind(STAGE_CROSSREF), 'attach');
  assert.equal(stageProposedKind(STAGE_INSTITUTION), 'attach');
  assert.equal(stageProposedKind(STAGE_DEED), 'mint');
  assert.equal(stageProposedKind(STAGE_BROKER), 'mint');
  assert.equal(stageContactRole(STAGE_BROKER), 'broker_of_record');
  assert.equal(stageContactRole(STAGE_DEED), 'deed_signatory');
  assert.equal(stageContactRole(STAGE_CROSSREF), 'prospecting_contact');
});

test('finalizeProposal stamps the STAGE-canonical kind/role (a builder cannot override)', () => {
  const owner = { entity_id: 'o9', owner_name: 'Acme Holdings LLC', rank_value: 5000000, primary_domain: 'gov' };
  // A malicious/buggy broker proposal claiming role prospecting_contact is corrected.
  const raw = { stage: STAGE_BROKER, proposed_kind: 'attach', candidate_name: 'Jane Broker',
    candidate_role: 'prospecting_contact', proposed_contact_role: 'prospecting_contact', confidence: 0.6 };
  const row = finalizeProposal(owner, raw);
  assert.equal(row.proposed_kind, 'mint');                 // stage owns kind
  assert.equal(row.proposed_contact_role, 'broker_of_record'); // stage owns role
  assert.equal(row.owner_entity_id, 'o9');
  assert.ok(row.subject_ref.startsWith('ca:broker_of_record:o9:'));
});

// ── Cross-reference / institution attach builders ────────────────────────────
test('buildCrossrefProposal proposes an ATTACH of the existing person', () => {
  const p = buildCrossrefProposal({}, { person_entity_id: 'p1', person_name: 'Nigel Hebborn',
    person_role: 'works_at', strategy: 'naming_core', source_entity_id: 's1', source_owner_name: 'Acquest Development', confidence: 'medium' });
  assert.equal(p.proposed_kind, 'attach');
  assert.equal(p.candidate_entity_id, 'p1');
  assert.equal(p.proposed_contact_role, 'prospecting_contact');
  assert.ok(p.confidence > 0);
});

test('buildCrossrefProposal rejects a firm-suffix "person" name', () => {
  assert.equal(buildCrossrefProposal({}, { person_entity_id: 'p1', person_name: 'Pacific Coast Properties LP' }), null);
});

// ── Deed signatory mint + verbatim validator ─────────────────────────────────
test('buildDeedSignatoryProposal mints only when the name is verbatim in the quote', () => {
  const good = buildDeedSignatoryProposal({}, {
    name: 'John Smith', title: 'Managing Member',
    quote: 'executed by John Smith, Managing Member of the grantee',
    evidence_text: 'This deed was executed by John Smith, Managing Member of the grantee on ...',
    document_id: 'DOC-1', domain: 'gov',
  });
  assert.ok(good.proposal, 'verbatim + person name → proposal');
  assert.equal(good.proposal.proposed_kind, 'mint');
  assert.equal(good.proposal.proposed_contact_role, 'deed_signatory');
});

test('the verbatim validator DROPS a signatory name not present in the deed text', () => {
  const drop = buildDeedSignatoryProposal({}, {
    name: 'John Smith', quote: 'executed by John Smith', evidence_text: 'This deed conveys the property to the grantee.',
  });
  assert.ok(drop.drop, 'quote not in evidence → dropped');
  assert.equal(drop.drop.reason, 'quote_not_verbatim');
});

test('the verbatim validator DROPS a junk/firm signatory name', () => {
  const drop = buildDeedSignatoryProposal({}, {
    name: 'Acme Holdings LLC', quote: 'executed by Acme Holdings LLC', evidence_text: 'executed by Acme Holdings LLC',
  });
  assert.ok(drop.drop);
  assert.equal(drop.drop.reason, 'junk_name');
});

test('nameInQuote requires the name tokens inside the quote span', () => {
  assert.equal(nameInQuote('John Smith', 'by John Smith, Manager'), true);
  assert.equal(nameInQuote('John Smith', 'by Jane Doe, Manager'), false);
});

// ── Broker-of-record typing guard (never a direct owner contact) ─────────────
test('buildBrokerProposal ALWAYS types the contact broker_of_record', () => {
  const p = buildBrokerProposal({}, { broker_name: 'Pat Seller', broker_firm: 'CBRE', sale_id: 42, domain: 'dia' });
  assert.equal(p.proposed_contact_role, 'broker_of_record');
  assert.equal(p.candidate_role, 'broker_of_record');
  assert.ok(isBrokerTypingValid(p));
});

test('isBrokerTypingValid rejects a broker card mis-typed as a prospecting contact', () => {
  const bad = { stage: STAGE_BROKER, proposed_contact_role: 'prospecting_contact', candidate_role: 'broker_of_record' };
  assert.equal(isBrokerTypingValid(bad), false);
});

test('a broker that is a firm (not a person) yields no proposal', () => {
  assert.equal(buildBrokerProposal({}, { broker_name: 'Marcus & Millichap' }), null);
});

// ── Value-gate / cursor ordering ─────────────────────────────────────────────
test('valueGateOwners ranks valued owners desc, zero-rank last (stable)', () => {
  const out = valueGateOwners([
    { entity_id: 'a', rank_value: 100 }, { entity_id: 'z', rank_value: 0 },
    { entity_id: 'b', rank_value: 9000000 }, { entity_id: 'c', rank_value: null },
  ]);
  assert.deepEqual(out.map((o) => o.entity_id), ['b', 'a', 'c', 'z']);
});

test('acquisitionSubjectRef is stable + idempotent per (stage, owner, candidate)', () => {
  const a = acquisitionSubjectRef(STAGE_CROSSREF, 'o1', { candidate_entity_id: 'p1' });
  const b = acquisitionSubjectRef(STAGE_CROSSREF, 'o1', { candidate_entity_id: 'p1' });
  assert.equal(a, b);
  assert.notEqual(a, acquisitionSubjectRef(STAGE_CROSSREF, 'o1', { candidate_entity_id: 'p2' }));
});

// ── Structural: read-only-until-verdict + house guards ───────────────────────
test('the tick handler is PROPOSAL-ONLY — no domain PATCH/DELETE in the scan path', () => {
  const src = read('api/_handlers/contact-acquisition-engine.js');
  // Writes go ONLY to the proposal/ledger tables — never a domain contact mutation.
  assert.ok(!/domainQuery\([^)]*['"]PATCH['"]/.test(src), 'tick must not PATCH a domain table');
  assert.ok(!/domainQuery\([^)]*['"]DELETE['"]/.test(src), 'tick must not DELETE a domain row');
  assert.ok(/contact_acquisition_review\?on_conflict=subject_ref/.test(src), 'proposals upsert idempotently');
  // Apply is flag-gated: an apply POST while the flag is off no-ops.
  assert.match(src, /!dryRun && !enabled/);
});

test('the tick anti-joins its own proposals (92-class cursor guard) + batches lookups', () => {
  const src = read('api/_handlers/contact-acquisition-engine.js');
  assert.match(src, /contact_acquisition_review\?owner_entity_id=in\.\(/); // anti-join by owner
  assert.match(src, /already_proposed_excluded/);
  assert.match(src, /buildOwnerPropertyMap/); // batched property map (no per-owner deed/broker fan-out)
  assert.match(src, /i \+= 500/); // strided in.() reads
});

test('the migration registers the flag OFF and a staggered nightly cron', () => {
  const mig = read('supabase/migrations/20260812130000_lcc_w9_1_contact_acquisition.sql');
  assert.match(mig, /'W9_1_CONTACT_ACQUISITION'[\s\S]*'off'/);
  assert.match(mig, /cron\.schedule\(\s*'contact-acquisition-engine-tick',\s*'55 4 \* \* \*'/);
  // No new field_source_priority rows (Stage-1 verdicts resolve into the ops graph).
  assert.ok(!/INSERT INTO public\.field_source_priority/.test(mig), 'Stage-1 adds no fsp rows');
});

test('the verdict writer records the reversal ledger BEFORE the mutation', () => {
  const admin = read('api/admin.js');
  const idx = admin.indexOf("decision.decision_type === 'contact_acquisition_review'");
  assert.ok(idx > 0, 'verdict branch exists');
  const branch = admin.slice(idx, idx + 9000);
  // ledger POST precedes the ensureEntityLink / linkPersonToEntity mutation.
  const ledgerAt = branch.indexOf('contact_acquisition_apply_log');
  const linkCallAt = branch.indexOf('await linkPersonToEntity({');
  assert.ok(ledgerAt > 0 && linkCallAt > ledgerAt, 'ledger written before the attach/mint');
  assert.match(branch, /status: 'rejected'/); // reject path keeps the row
});
