// W8 U3 (Prompt 69) — Ollama connection propagation (evidence-grounded link
// proposals). Unit tests for the PURE planner (value-gate ordering, evidence-
// assembly bounds, the verbatim validator [accept substring / reject paraphrase],
// no-evidence short-circuit, proposal normalization + confidence gate, evidence
// hash stability) PLUS structural guards proving admin.js emits to the
// w8_u3_link_review lane, applies via the deterministic writer (entity_relationships
// edge + provenance), NEVER auto-writes, and NEVER fabricates; and the migration
// registers the field_source_priority row so v_field_provenance_unranked stays 0.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LINK_POOL_CHAIN, LINK_POOL_PERSON_EMAIL, CHAIN_GAP_CATALOGUE, chainGapSpec,
  chainSubjectRef, personEmailSubjectRef, normDomain,
  valueGateChainRows, assembleEvidence, evidenceIsEmpty, evidenceHash, linkScoredKeyFor,
  buildLinkPropagationPrompt, parseLinkProposalJson, normalizeLinkProposal,
  validateLinkProposal, isProposableLink, quoteVerbatimInEvidence,
  LINK_MIN_CONFIDENCE, scoreLinksWithBudget, EVIDENCE_TOP_K, EVIDENCE_BLOCK_CHARS,
} from '../api/_shared/link-propagation-planner.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
describe('subject refs + domain normalization', () => {
  it('canonical chain / person-email subject refs', () => {
    assert.equal(chainSubjectRef('government', 16404, 'developer_unidentified'), 'link:chain:gov:16404:developer_unidentified');
    assert.equal(chainSubjectRef('dia', 24703, 'no_prior_owners_recorded'), 'link:chain:dia:24703:no_prior_owners_recorded');
    assert.equal(personEmailSubjectRef('abc-123'), 'link:pmail:abc-123');
  });
  it('normalizes dia/gov aliases', () => {
    assert.equal(normDomain('dialysis'), 'dia');
    assert.equal(normDomain('government'), 'gov');
    assert.equal(normDomain('lcc'), 'lcc');
  });
  it('gap catalogue covers the two live gap types', () => {
    assert.ok(CHAIN_GAP_CATALOGUE.developer_unidentified);
    assert.ok(CHAIN_GAP_CATALOGUE.no_prior_owners_recorded);
    assert.equal(chainGapSpec('developer_unidentified').role, 'developed');
    assert.equal(chainGapSpec('no_prior_owners_recorded').role, 'owns');
    assert.equal(chainGapSpec('nope'), null);
  });
});

// ---------------------------------------------------------------------------
describe('value-gate ordering (producer/consumer)', () => {
  it('valued rows (rank_value>0) come first in rank order; zero-rank after', () => {
    const rows = [
      { source_property_id: 3, rank_value: 0 },
      { source_property_id: 1, rank_value: 500000 },
      { source_property_id: 2, rank_value: 1200000 },
      { source_property_id: 4, rank_value: null },
    ];
    const ordered = valueGateChainRows(rows);
    assert.deepEqual(ordered.map((r) => r.source_property_id), [2, 1, 3, 4]);
  });
  it('empty / non-array is safe', () => {
    assert.deepEqual(valueGateChainRows(null), []);
    assert.deepEqual(valueGateChainRows([]), []);
  });
});

// ---------------------------------------------------------------------------
describe('evidence assembly bounds', () => {
  it('caps to top-K blocks and drops empty/whitespace blocks', () => {
    const blocks = [];
    for (let i = 0; i < 20; i++) blocks.push({ source: 's', ref: i, text: 'evidence block number ' + i });
    blocks.splice(2, 0, { source: 's', ref: 'blank', text: '   ' });
    const a = assembleEvidence(blocks, { topK: 5 });
    assert.equal(a.blocks.length, 5);
    assert.ok(a.dropped_empty >= 1);
  });
  it('char-caps each block and the total', () => {
    const big = 'x'.repeat(5000);
    const a = assembleEvidence([{ source: 's', ref: 1, text: big }], { blockChars: 100, totalChars: 100 });
    assert.equal(a.blocks[0].text.length, 100);
    assert.ok(a.chars <= 100);
  });
  it('stops adding blocks once the total cap is hit', () => {
    const blocks = [{ text: 'a'.repeat(80) }, { text: 'b'.repeat(80) }, { text: 'c'.repeat(80) }];
    const a = assembleEvidence(blocks, { blockChars: 80, totalChars: 100 });
    assert.ok(a.chars <= 100);
    assert.ok(a.blocks.length <= 2);
  });
  it('defaults exist and are sane', () => {
    assert.ok(EVIDENCE_TOP_K >= 1 && EVIDENCE_BLOCK_CHARS >= 40);
  });
});

// ---------------------------------------------------------------------------
describe('no-evidence short-circuit', () => {
  it('empty assembled evidence is detected (no LLM call)', () => {
    assert.equal(evidenceIsEmpty(assembleEvidence([])), true);
    assert.equal(evidenceIsEmpty(assembleEvidence([{ text: '   ' }])), true);
    assert.equal(evidenceIsEmpty(null), true);
    assert.equal(evidenceIsEmpty(assembleEvidence([{ text: 'a real block of text' }])), false);
  });
});

// ---------------------------------------------------------------------------
describe('evidence hash — resumable scored marker', () => {
  it('is stable for the same evidence and changes when evidence changes', () => {
    const a = assembleEvidence([{ text: 'Sunbelt Development Corp built this in 1998' }]);
    const h1 = evidenceHash(a, 'ctx1');
    const h2 = evidenceHash(a, 'ctx1');
    assert.equal(h1, h2);
    const b = assembleEvidence([{ text: 'A totally different note about a prior owner' }]);
    assert.notEqual(evidenceHash(b, 'ctx1'), h1);
    // context salt participates (chain gained a prior owner)
    assert.notEqual(evidenceHash(a, 'ctx2'), h1);
  });
  it('scored-marker key is deterministic', () => {
    assert.equal(linkScoredKeyFor('chain', 'gov', 16404, 'developer_unidentified', 'abcd1234'),
      'chain:gov:16404:developer_unidentified:abcd1234');
  });
});

// ---------------------------------------------------------------------------
describe('verbatim validator (the free precision floor)', () => {
  const evidence = 'grantor: SMBC Leasing and Finance; grantee: Alliance Equities LLC. Built by Sunbelt Development Corporation in 1998.';

  it('ACCEPTS a proposal whose quote is a verbatim substring of the evidence', () => {
    const proposal = normalizeLinkProposal({ verdict: 'link_proposal', linked_entity_name: 'Sunbelt Development Corporation',
      role: 'developer', confidence: 0.8, evidence_quote: 'Built by Sunbelt Development Corporation', evidence_source: 'E1', reason: 'named as builder' });
    const v = validateLinkProposal(proposal, evidence);
    assert.equal(v.drop, null);
    assert.ok(v.proposal);
    assert.equal(v.proposal.linked_entity_name, 'Sunbelt Development Corporation');
  });

  it('REJECTS a paraphrased quote (not a verbatim substring) → dropped + reason', () => {
    const proposal = normalizeLinkProposal({ verdict: 'link_proposal', linked_entity_name: 'Sunbelt Development Corporation',
      role: 'developer', confidence: 0.9, evidence_quote: 'Sunbelt was the developer of the building', evidence_source: 'E1', reason: 'paraphrase' });
    const v = validateLinkProposal(proposal, evidence);
    assert.equal(v.proposal, null);
    assert.equal(v.drop.reason, 'quote_not_verbatim');
  });

  it('REJECTS a fabricated entity not in the evidence at all', () => {
    const proposal = normalizeLinkProposal({ verdict: 'link_proposal', linked_entity_name: 'Ghost Holdings LLC',
      role: 'developer', confidence: 0.95, evidence_quote: 'Ghost Holdings LLC developed the site', evidence_source: 'E1', reason: 'made up' });
    const v = validateLinkProposal(proposal, evidence);
    assert.equal(v.proposal, null);
    assert.equal(v.drop.reason, 'quote_not_verbatim');
  });

  it('no_evidence_found is NOT a drop — honest, counted non-proposal', () => {
    const v = validateLinkProposal(normalizeLinkProposal({ verdict: 'no_evidence_found' }), evidence);
    assert.equal(v.proposal, null);
    assert.equal(v.drop, null);
    assert.equal(v.verdict, 'no_evidence_found');
  });

  it('a link_proposal with no quote / no entity is dropped', () => {
    const v1 = validateLinkProposal(normalizeLinkProposal({ verdict: 'link_proposal', linked_entity_name: 'X Corp', confidence: 0.8 }), evidence);
    assert.equal(v1.drop.reason, 'no_quote');
    const v2 = validateLinkProposal(normalizeLinkProposal({ verdict: 'link_proposal', evidence_quote: 'Alliance Equities LLC', confidence: 0.8 }), evidence);
    assert.equal(v2.drop.reason, 'no_entity_named');
  });

  it('whitespace normalization: extra spaces/newlines still match verbatim', () => {
    assert.equal(quoteVerbatimInEvidence('Sunbelt   Development\nCorporation', evidence), true);
  });

  it('a too-short quote cannot ground anything', () => {
    assert.equal(quoteVerbatimInEvidence('LLC', evidence), false);
  });
});

// ---------------------------------------------------------------------------
describe('proposal normalization + confidence gate', () => {
  it('normalizes verdict synonyms and clamps confidence', () => {
    assert.equal(normalizeLinkProposal({ verdict: 'FOUND', confidence: 2 }).verdict, 'link_proposal');
    assert.equal(normalizeLinkProposal({ verdict: 'none' }).verdict, 'no_evidence_found');
    assert.equal(normalizeLinkProposal({ verdict: 'garbage' }).verdict, 'no_evidence_found');
    assert.equal(normalizeLinkProposal({ verdict: 'link_proposal', confidence: -1 }).confidence, 0);
  });
  it('isProposableLink requires a validated proposal above the floor', () => {
    const evidence = 'built by Acme Development Group';
    const good = validateLinkProposal(normalizeLinkProposal({ verdict: 'link_proposal', linked_entity_name: 'Acme Development Group',
      evidence_quote: 'built by Acme Development Group', confidence: 0.7 }), evidence);
    assert.equal(isProposableLink(good, LINK_MIN_CONFIDENCE), true);
    const weak = validateLinkProposal(normalizeLinkProposal({ verdict: 'link_proposal', linked_entity_name: 'Acme Development Group',
      evidence_quote: 'built by Acme Development Group', confidence: 0.3 }), evidence);
    assert.equal(isProposableLink(weak, LINK_MIN_CONFIDENCE), false);
    // a dropped (non-verbatim) proposal is never proposable
    const dropped = validateLinkProposal(normalizeLinkProposal({ verdict: 'link_proposal', linked_entity_name: 'X',
      evidence_quote: 'not in the text at all here', confidence: 0.99 }), evidence);
    assert.equal(isProposableLink(dropped, LINK_MIN_CONFIDENCE), false);
  });
});

// ---------------------------------------------------------------------------
describe('prompt builder', () => {
  it('chain prompt embeds the evidence + the no-fabrication + verbatim contract', () => {
    const row = { source_domain: 'gov', source_property_id: 16404, gap: 'developer_unidentified',
      current_owner_name: 'Alliance Equities LLC', address: '4635 Binz Engleman Rd', city: 'San Antonio', state: 'TX' };
    const a = assembleEvidence([{ source: 'deed', ref: 9, text: 'grantee: Alliance Equities LLC; built by Sunbelt Development Corp' }]);
    const prompt = buildLinkPropagationPrompt(row, a, LINK_POOL_CHAIN);
    assert.match(prompt, /VERBATIM/);
    assert.match(prompt, /no_evidence_found/);
    assert.match(prompt, /Sunbelt Development Corp/);
    assert.match(prompt, /never invent facts/i);
  });
  it('person-email prompt handles the second pool', () => {
    const row = { email: 'a@b.com', winner_name: 'Jane Doe', loser_names: ['J. Doe'] };
    const a = assembleEvidence([{ source: 'person_email', text: 'email: a@b.com\nwinner: Jane Doe\nothers: J. Doe' }]);
    const prompt = buildLinkPropagationPrompt(row, a, LINK_POOL_PERSON_EMAIL);
    assert.match(prompt, /same_person/);
    assert.match(prompt, /a@b\.com/);
  });
});

// ---------------------------------------------------------------------------
describe('tolerant JSON parse', () => {
  it('parses fenced + bare + brace-embedded JSON', () => {
    assert.equal(parseLinkProposalJson('```json\n{"verdict":"link_proposal"}\n```').verdict, 'link_proposal');
    assert.equal(parseLinkProposalJson('{"verdict":"no_evidence_found"}').verdict, 'no_evidence_found');
    assert.equal(parseLinkProposalJson('noise {"verdict":"link_proposal"} tail').verdict, 'link_proposal');
    assert.equal(parseLinkProposalJson('not json'), null);
  });
});

// ---------------------------------------------------------------------------
describe('bounded scorer', () => {
  it('caps at maxN and stops at the time budget', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let t = 0; const now = () => t;
    const run = await scoreLinksWithBudget(items, async (x) => { t += 60; return x; }, { budgetMs: 150, maxN: 8, now });
    assert.ok(run.scored <= 8);
    assert.equal(run.budget_exhausted, true);
    assert.ok(run.remaining_unscored > 0);
  });
});

// ---------------------------------------------------------------------------
describe('structural guards — admin.js wiring (Prompt 69 doctrine)', () => {
  const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');
  const migration = readFileSync(join(root, 'supabase/migrations/20260807180000_lcc_w8_u3_link_propagation.sql'), 'utf8');

  it('registers w8_u3_link_review in FEDERATED_DECISION_TYPES', () => {
    const m = admin.match(/FEDERATED_DECISION_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(m && m[1].includes("'w8_u3_link_review'"));
  });
  it('the verdict writer NEVER calls a merge on this lane (no lcc_merge_entity in the branch)', () => {
    const start = admin.indexOf("decision.decision_type === 'w8_u3_link_review'");
    const end = admin.indexOf("owner_reconcile (W3.2", start);
    assert.ok(start > 0 && end > start);
    const branch = admin.slice(start, end);
    assert.ok(!branch.includes('lcc_merge_entity'), 'U3 must never merge');
  });
  it('the writer is gated on a human verdict (confirm/reject) — never auto-applies', () => {
    assert.match(admin, /w8_u3_link_review: unknown verdict/);
    // the apply path lives ONLY in the verdict handler; the tick writes proposals, not edges
    const tickStart = admin.indexOf('async function handleLinkPropagationTick');
    const tickEnd = admin.indexOf('PRIORITY QUEUE LIST', tickStart);
    assert.ok(tickStart > 0 && tickEnd > tickStart);
    const tick = admin.slice(tickStart, tickEnd);
    assert.ok(!tick.includes("opsQuery('POST', 'entity_relationships'"), 'the tick must not write edges — only proposals');
  });
  it('the tick logs dropped (non-verbatim) proposals to the precision-floor table', () => {
    assert.match(admin, /w8_u3_dropped_log/);
    assert.match(admin, /logLinkDropped/);
  });
  it('the tick short-circuits no-evidence with NO LLM call', () => {
    assert.match(admin, /evidenceIsEmpty\(assembled\)/);
    assert.match(admin, /NO LLM call/);
  });
  it('no web search — internal evidence only (owner-contact-websearch is PAUSED)', () => {
    const start = admin.indexOf('W8 U3 (Prompt 69');
    const end = admin.indexOf('PRIORITY QUEUE LIST', start);
    const section = admin.slice(start, end);
    assert.ok(!/websearch|web_search|owner-contact-websearch/i.test(section) || /PAUSED|internal evidence only/i.test(section));
  });
});

// ---------------------------------------------------------------------------
describe('structural guards — migration (provenance + flag OFF)', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/20260807180000_lcc_w8_u3_link_propagation.sql'), 'utf8');

  it('registers a field_source_priority row for source w8_u3_link_propagation (unranked view stays 0)', () => {
    assert.match(migration, /INSERT INTO public\.field_source_priority/);
    assert.match(migration, /'w8_u3_link_propagation'/);
    // below all record sources — rank 85 (derived/inferred band)
    assert.match(migration, /'w8_u3_link_propagation',\s*85/);
  });
  it('the feature flag defaults OFF (36y in-migration registration)', () => {
    assert.match(migration, /'W8_U3_LINK_PROPAGATION'/);
    const flagBlock = migration.slice(migration.indexOf("'W8_U3_LINK_PROPAGATION'"));
    assert.match(flagBlock, /'off'/);
  });
  it('nightly cron staggered AFTER U1 (03:40) + U2 (03:50) at 04:10', () => {
    assert.match(migration, /link-propagation-tick/);
    assert.match(migration, /'10 4 \* \* \*'/);
  });
  it('creates the reversible apply ledger + dropped log + review table', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.w8_u3_link_review/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.w8_u3_link_apply_log/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.w8_u3_dropped_log/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.w8_u3_link_batch/);
  });
  it('the proposed_verdict CHECK forbids any auto-merge verdict (only link_proposal|no_evidence_found)', () => {
    assert.match(migration, /proposed_verdict IN \('link_proposal', 'no_evidence_found'\)/);
  });
});
