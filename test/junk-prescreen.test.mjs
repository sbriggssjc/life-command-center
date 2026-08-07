// W8 U1 (Prompt 62) — Ollama junk-entity pre-screen. Unit tests for the PURE
// planner (candidate filter, prompt/parse, verdict-application plan incl. the FK
// guard, reversible marker) plus structural guards that admin.js + server.js are
// wired the way the doctrine requires (proposal-only, flag-gated, human-verdict).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  JUNK_TARGETS, findJunkTarget, junkSubjectRef, parseJunkSubjectRef,
  junkCandidateReason, namingHygieneReason, isJunkCandidate, buildJunkPrescreenPrompt,
  normalizeJunkProposal, parseJunkVerdictJson, planJunkApply, buildRetireMarker,
  isSpeCodedName, knownAbbrevEvidence, isAddressAsName, isAcronymOnly,
  applyPrescreenGuards, dismissDistributionGuard, isEnqueueableJunkVerdict,
} from '../api/_shared/junk-prescreen.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('junkCandidateReason — deterministic candidate filter', () => {
  it('flags blank / whitespace names', () => {
    assert.equal(junkCandidateReason('')?.heuristic, 'blank_name');
    assert.equal(junkCandidateReason('   ')?.heuristic, 'blank_name');
    assert.equal(junkCandidateReason(null)?.heuristic, 'blank_name');
  });
  it('flags test / bookkeeping-stub tokens with a verbatim evidence quote', () => {
    const r = junkCandidateReason('TEST company do not use');
    assert.equal(r.heuristic, 'token_junk');
    assert.equal(r.evidence.toLowerCase(), 'test');
    assert.equal(junkCandidateReason('DO NOT USE')?.heuristic, 'token_junk');
    assert.equal(junkCandidateReason('asdfasdf')?.heuristic, 'token_junk');
  });
  it('flags all-non-alpha (all digits / punctuation) names', () => {
    assert.equal(junkCandidateReason('12345')?.heuristic, 'all_non_alpha');
    assert.equal(junkCandidateReason('---')?.heuristic, 'all_non_alpha');
  });
  it('flags too-short names (<=2 letters)', () => {
    assert.equal(junkCandidateReason('AB')?.heuristic, 'too_short');
    assert.equal(junkCandidateReason('X')?.heuristic, 'too_short');
  });
  it('flags gibberish consonant runs', () => {
    assert.equal(junkCandidateReason('bcdfghjk')?.heuristic, 'consonant_run');
  });
  it('does NOT flag plausibly-real company / person names', () => {
    for (const name of [
      'Cowperwood Holdings LLC', 'Fresenius Medical Care', 'DaVita Inc',
      'Northmarq', 'Scott Briggs', 'US Social Security Administration',
      '20931 Burbank Blvd LLC', 'GSA Region 7 Trust',
    ]) {
      assert.equal(isJunkCandidate(name), false, `${name} should be real`);
    }
  });
  it('evidence quote is always a verbatim substring of the name (token case)', () => {
    const name = 'sample entity 42';
    const r = junkCandidateReason(name);
    assert.ok(name.toLowerCase().includes(r.evidence.toLowerCase()));
  });
});

describe('subject_ref round-trips + target catalogue', () => {
  it('junkSubjectRef canonicalizes long-form domains and parses back', () => {
    assert.equal(junkSubjectRef('dialysis', 'contacts', 7), 'junk:dia:contacts:7');
    assert.equal(junkSubjectRef('government', 'true_owners', 'abc'), 'junk:gov:true_owners:abc');
    const p = parseJunkSubjectRef('junk:gov:recorded_owners:99');
    assert.deepEqual(p, { domain: 'gov', table: 'recorded_owners', pk: '99' });
  });
  it('pk containing separators survives (greedy tail)', () => {
    const p = parseJunkSubjectRef('junk:lcc:entities:a:b:c');
    assert.equal(p.pk, 'a:b:c');
  });
  it('every target has the fields the tick + apply path rely on', () => {
    for (const t of JUNK_TARGETS) {
      assert.ok(t.domain && t.table && t.pkCol && t.nameCol, `target ${t.table} missing core cols`);
      assert.ok(['jsonb', 'text'].includes(t.markerKind), `target ${t.table} bad markerKind`);
      assert.ok(Array.isArray(t.fkChildren), `target ${t.table} fkChildren`);
    }
    assert.equal(findJunkTarget('dia', 'contacts')?.table, 'contacts');
    assert.equal(findJunkTarget('government', 'true_owners')?.domain, 'gov');
  });
});

describe('normalizeJunkProposal — model output hardening', () => {
  const cand = { entity_name: 'TEST llc', heuristic: 'token_junk', evidence: 'TEST' };
  it('clamps confidence and defaults an unknown verdict to keep', () => {
    const p = normalizeJunkProposal({ verdict: 'nuke', confidence: 5 }, cand);
    assert.equal(p.verdict, 'keep');
    assert.equal(p.confidence, 1);
  });
  it('falls back to deterministic evidence when the model omits/paraphrases the quote', () => {
    const p = normalizeJunkProposal({ verdict: 'dismiss', confidence: 0.9, evidence_quote: 'not in the name' }, cand);
    assert.equal(p.evidence_quote, 'TEST');
  });
  it('keeps a genuine verbatim quote', () => {
    const p = normalizeJunkProposal({ verdict: 'dismiss', confidence: 0.9, evidence_quote: 'TEST' }, cand);
    assert.equal(p.evidence_quote, 'TEST');
  });
});

describe('parseJunkVerdictJson', () => {
  it('parses fenced and bare JSON', () => {
    assert.equal(parseJunkVerdictJson('```json\n{"verdict":"dismiss"}\n```').verdict, 'dismiss');
    assert.equal(parseJunkVerdictJson('noise {"verdict":"keep"} trailing').verdict, 'keep');
    assert.equal(parseJunkVerdictJson('not json'), null);
  });
});

describe('buildJunkPrescreenPrompt', () => {
  it('includes the operator rubric few-shot and the verbatim-quote instruction', () => {
    const prompt = buildJunkPrescreenPrompt(
      { domain: 'dia', table: 'contacts', entity_name: 'asdf', heuristic: 'token_junk', evidence: 'asdf' },
      [{ name: 'Deal by Northmarq', verdict: 'rename' }],
    );
    assert.match(prompt, /VERBATIM/);
    assert.match(prompt, /Deal by Northmarq/);
    assert.match(prompt, /never delete/i);
  });
});

describe('planJunkApply — the auditable, human-gated apply gate (FK guard)', () => {
  it('reject/keep always closes the proposal without retiring', () => {
    const p = planJunkApply({ humanVerdict: 'reject', proposedVerdict: 'dismiss', fkReferenced: true });
    assert.equal(p.action, 'dismiss_proposal');
    assert.equal(p.retire, false);
  });
  it('confirm + dismiss + NOT referenced => soft-retire', () => {
    const p = planJunkApply({ humanVerdict: 'confirm', proposedVerdict: 'dismiss', fkReferenced: false });
    assert.equal(p.action, 'soft_retire');
    assert.equal(p.retire, true);
    assert.equal(p.status, 'applied');
  });
  it('confirm + dismiss + FK-referenced => conflict, NEVER retire (hazard class)', () => {
    const p = planJunkApply({ humanVerdict: 'confirm', proposedVerdict: 'dismiss', fkReferenced: true });
    assert.equal(p.action, 'conflict_fk');
    assert.equal(p.retire, false);
  });
  it('confirm + rename/parse_contact => edit lane, no destructive write', () => {
    assert.equal(planJunkApply({ humanVerdict: 'confirm', proposedVerdict: 'rename', fkReferenced: false }).action, 'accept_edit_lane');
    assert.equal(planJunkApply({ humanVerdict: 'confirm', proposedVerdict: 'parse_contact', fkReferenced: false }).action, 'accept_edit_lane');
  });
  it('confirm + keep => close, no write', () => {
    assert.equal(planJunkApply({ humanVerdict: 'confirm', proposedVerdict: 'keep', fkReferenced: false }).action, 'dismiss_proposal');
  });
});

describe('buildRetireMarker — reversible, non-clobbering', () => {
  it('jsonb target merges a junk_retired key, preserving existing keys', () => {
    const t = findJunkTarget('lcc', 'entities');
    const body = buildRetireMarker(t, { foo: 1 }, 12, 'run1', '2026-08-07T00:00:00Z');
    assert.equal(body.metadata.foo, 1);
    assert.equal(body.metadata.junk_retired.batch_id, 12);
    assert.equal(body.metadata.junk_retired.unit, 'W8_U1');
  });
  it('text target appends a reversible tag without destroying the original note', () => {
    const t = findJunkTarget('dia', 'contacts');
    const body = buildRetireMarker(t, 'existing note', 5, 'run2', '2026-08-07T00:00:00Z');
    assert.match(body.notes, /existing note/);
    assert.match(body.notes, /\[JUNK-RETIRED batch=5/);
  });
  it('text target is idempotent — a second marker is not double-appended', () => {
    const t = findJunkTarget('dia', 'contacts');
    const once = buildRetireMarker(t, 'note', 5, 'run', 'now').notes;
    const twice = buildRetireMarker(t, once, 6, 'run', 'now').notes;
    assert.equal(once, twice);
  });
});

// ===========================================================================
// Prompt 64 — precision fix. Regression fixtures are the VERBATIM names from the
// first live scored batch (2026-08-07) that were wrongly proposed `dismiss`.
// ===========================================================================
describe('SPE-pattern guard — net-lease coded shells are NOT candidates', () => {
  const SPE_NAMES = [
    'ARC3 GSCRGCO001, LLC', 'ARHC MCNWDNY01, LLC', 'ARC GSDVRDE001, LLC', 'Arg Ddblvtn001 Llc',
  ];
  it('isSpeCodedName is true for entity-form + code-token names', () => {
    for (const n of SPE_NAMES) assert.equal(isSpeCodedName(n), true, `${n} should be SPE-coded`);
  });
  it('junkCandidateReason returns null (never reaches the LLM)', () => {
    for (const n of SPE_NAMES) assert.equal(junkCandidateReason(n), null, `${n} should not be a candidate`);
  });
  it('does NOT swallow a real address-named SPE or a plain code without a form word', () => {
    assert.equal(isSpeCodedName('20931 Burbank Blvd LLC'), false); // no code token
    assert.equal(isSpeCodedName('GSCRGCO001'), false);            // no entity form
  });
});

// ===========================================================================
// Prompt 65 — scope tighten. Abbrev + address rows are REAL-but-malformed names:
// a naming-hygiene backlog with its own future unit, NEVER U1 junk candidates.
// The 2nd live batch exploded 649 → 6,946 because these classes flag thousands
// of real entities; they are split out of candidacy entirely.
// ===========================================================================
describe('known-abbreviation — naming-hygiene backlog, NOT a junk candidate', () => {
  it('is NOT a junk candidate (dropped from candidacy)', () => {
    assert.equal(junkCandidateReason('Brookfield Prop Prtnrs DBUBS 2011-LC1'), null);
    assert.equal(isJunkCandidate('Cushman Wakefield Prtnrs'), false);
    assert.equal(isJunkCandidate('Cohen Cos'), false);
  });
  it('is classified as a naming-hygiene backlog row (count only)', () => {
    const r = namingHygieneReason('Brookfield Prop Prtnrs DBUBS 2011-LC1');
    assert.equal(r.heuristic, 'known_abbreviation');
    assert.equal(knownAbbrevEvidence('Cushman Wakefield Prtnrs'), 'Prtnrs');
  });
  it('the heuristic_downgrade guard stays as an apply-path belt-and-braces', () => {
    const cand = { heuristic: 'known_abbreviation', evidence: 'Prtnrs', preVerdict: 'rename', entity_name: 'X Prtnrs' };
    const out = applyPrescreenGuards({ verdict: 'dismiss', confidence: 0.9 }, cand, { connected: false });
    assert.equal(out.verdict, 'rename');
    assert.ok(out.guards.includes('heuristic_downgrade'));
  });
});

describe('address-as-name — naming-hygiene backlog, NOT a junk candidate', () => {
  it('still recognizes the shape but is NOT a candidate', () => {
    assert.equal(isAddressAsName('3710 Fm 1889'), true);
    assert.equal(isAddressAsName('654 SR 75'), true);
    assert.equal(junkCandidateReason('3710 Fm 1889'), null);
    assert.equal(isJunkCandidate('654 SR 75'), false);
  });
  it('is classified as a naming-hygiene backlog row (count only)', () => {
    assert.equal(namingHygieneReason('3710 Fm 1889').heuristic, 'address_as_name');
  });
  it('does NOT flag an address-named SPE that carries a legal form', () => {
    assert.equal(isAddressAsName('20931 Burbank Blvd LLC'), false);
    assert.equal(namingHygieneReason('20931 Burbank Blvd LLC'), null);
  });
});

describe('naming-hygiene split — real names never land in either pool wrongly', () => {
  it('a true-junk row is a candidate, not naming-hygiene', () => {
    assert.equal(junkCandidateReason('Test Test').heuristic, 'token_junk');
    assert.equal(namingHygieneReason('Test Test'), null);
  });
  it('a well-formed real name is neither', () => {
    for (const n of ['Cowperwood Holdings LLC', 'Fresenius Medical Care', 'Northmarq']) {
      assert.equal(junkCandidateReason(n), null);
      assert.equal(namingHygieneReason(n), null);
    }
  });
});

describe('isEnqueueableJunkVerdict — only actionable proposals persist (Prompt 65)', () => {
  it('dismiss / rename / parse_contact are enqueueable', () => {
    for (const v of ['dismiss', 'rename', 'parse_contact', 'DISMISS', ' rename ']) {
      assert.equal(isEnqueueableJunkVerdict(v), true, `${v} should enqueue`);
    }
  });
  it('keep / uncertain / unknown are NOT enqueueable (kept_not_enqueued)', () => {
    for (const v of ['keep', 'uncertain', 'nuke', '', null, undefined]) {
      assert.equal(isEnqueueableJunkVerdict(v), false, `${JSON.stringify(v)} should NOT enqueue`);
    }
  });
});

describe('acronym guard — bank/operator acronyms are not junk on shape alone', () => {
  const ACRONYMS = ['SMBC', 'FCMC', 'LFLP', 'PVLLC'];
  it('flags acronyms with the acronymOnly marker', () => {
    for (const a of ACRONYMS) {
      assert.equal(isAcronymOnly(a), true, `${a} acronym`);
      assert.equal(junkCandidateReason(a).acronymOnly, true, `${a} candidate.acronymOnly`);
    }
  });
  it('an acronym with any connection is capped at keep, never dismissed', () => {
    const cand = { heuristic: 'no_vowel', evidence: 'SMBC', acronymOnly: true, entity_name: 'SMBC' };
    const out = applyPrescreenGuards({ verdict: 'dismiss', confidence: 0.9 }, cand, { connected: true, connectionDetail: 'properties.true_owner_id (3)' });
    assert.equal(out.verdict, 'keep');
    assert.ok(out.guards.includes('connection_gate'));
  });
  it('an acronym with provenance but no FK is still not dismissable', () => {
    const cand = { heuristic: 'no_vowel', evidence: 'SMBC', acronymOnly: true, entity_name: 'SMBC' };
    const out = applyPrescreenGuards({ verdict: 'dismiss', confidence: 0.9 }, cand, { connected: false, hasProvenance: true });
    assert.equal(out.verdict, 'keep');
    assert.ok(out.guards.includes('acronym_gate'));
  });
});

describe('applyPrescreenGuards — connection gate + softening-only invariant', () => {
  it('a connected entity is never dismissed regardless of name', () => {
    const out = applyPrescreenGuards({ verdict: 'dismiss', confidence: 0.95 },
      { heuristic: 'consonant_run', evidence: 'bcdfgh', entity_name: 'bcdfgh' },
      { connected: true, connectionDetail: 'entity_relationships.from_entity_id (2)' });
    assert.equal(out.verdict, 'keep');
    assert.match(out.reason, /Connected entity/);
  });
  it('guards only ever SOFTEN — a keep/rename is left intact', () => {
    const keep = applyPrescreenGuards({ verdict: 'keep', confidence: 0.5 }, { entity_name: 'x' }, { connected: false });
    assert.equal(keep.verdict, 'keep');
    assert.deepEqual(keep.guards, []);
  });
  it('an unconnected true junk row stays dismiss', () => {
    const out = applyPrescreenGuards({ verdict: 'dismiss', confidence: 0.95 },
      { heuristic: 'token_junk', evidence: 'Test Test', entity_name: 'Test Test' },
      { connected: false, hasProvenance: false });
    assert.equal(out.verdict, 'dismiss');
    assert.deepEqual(out.guards, []);
  });
});

describe('the `--` / test-data class is still correctly dismissable', () => {
  it('pure punctuation and test strings remain candidates', () => {
    assert.equal(junkCandidateReason('--').heuristic, 'all_non_alpha');
    assert.equal(junkCandidateReason('Test Test').heuristic, 'token_junk');
    assert.equal(isSpeCodedName('--'), false);
  });
});

describe('dismissDistributionGuard — honest-counts guard on a scored batch', () => {
  it('flags a batch that is majority-dismiss', () => {
    const g = dismissDistributionGuard({ dismiss: 18, keep: 1, rename: 1 });
    assert.equal(g.suspect_distribution, true);
    assert.ok(g.dismiss_share > 0.5);
  });
  it('passes a healthy small-minority-junk batch', () => {
    const g = dismissDistributionGuard({ dismiss: 3, keep: 15, rename: 2 });
    assert.equal(g.suspect_distribution, false);
  });
  it('an empty batch is not suspect', () => {
    assert.equal(dismissDistributionGuard({}).suspect_distribution, false);
  });
});

describe('buildJunkPrescreenPrompt — rubric rewrite (judge, do not parrot)', () => {
  const prompt = buildJunkPrescreenPrompt(
    { domain: 'lcc', table: 'entities', entity_name: 'SMBC', heuristic: 'no_vowel', evidence: 'SMBC',
      context: { connected: false, relationship_count: 0, identity_count: 0 } },
    [],
  );
  it('states the heuristic is a WEAK HINT with false-positive classes', () => {
    assert.match(prompt, /WEAK/);
    assert.match(prompt, /FALSE-POSITIVE/i);
  });
  it('instructs dismiss ONLY when no plausible real reading exists', () => {
    assert.match(prompt, /Propose "dismiss" ONLY if/);
  });
  it('requires the reason to cite evidence BEYOND the heuristic', () => {
    assert.match(prompt, /BEYOND the heuristic/);
    assert.match(prompt, /Do NOT simply restate/);
  });
  it('carries the few-shot negatives from the live failures', () => {
    assert.match(prompt, /ARC GSDVRDE001, LLC.*keep/);
    assert.match(prompt, /SMBC.*keep/);
    assert.match(prompt, /Prtnrs.*rename/);
    assert.match(prompt, /"--".*dismiss/);
    assert.match(prompt, /Test Test.*dismiss/);
  });
  it('feeds the relationship/identity context into the prompt', () => {
    assert.match(prompt, /relationship_count/);
    assert.match(prompt, /is_fk_referenced/);
  });
});

describe('structural wiring guards (admin.js + server.js + migration)', () => {
  const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const mig = readFileSync(join(root, 'supabase/migrations/20260807120000_lcc_w8_u1_junk_entity_prescreen.sql'), 'utf8');

  it('the tick route is mounted in server.js and dispatched in admin.js', () => {
    assert.match(server, /\/api\/junk-prescreen-tick/);
    assert.match(admin, /case 'junk-prescreen-tick':/);
  });
  it('junk_entity_review is registered as a federated decision lane', () => {
    assert.match(admin, /FEDERATED_DECISION_TYPES = new Set\(\[[\s\S]*'junk_entity_review'/);
    assert.match(admin, /if \(type === 'junk_entity_review'\)/);
    assert.match(admin, /case 'junk_entity_review': return/);
  });
  it('the verdict branch runs the human-gated apply with the FK guard', () => {
    assert.match(admin, /decision\.decision_type === 'junk_entity_review'/);
    assert.match(admin, /junkFkReferenced/);
    assert.match(admin, /planJunkApply/);
  });
  it('POST apply is flag-gated (no-ops while OFF); GET is a dry-run', () => {
    assert.match(admin, /feature_flag_off/);
    assert.match(admin, /mode: 'dry_run'/);
  });
  it('the tick applies the precision guards + distribution guard (Prompt 64)', () => {
    assert.match(admin, /applyPrescreenGuards/);
    assert.match(admin, /dismissDistributionGuard/);
    assert.match(admin, /suspect_distribution/);
    // scoring probes the FK connection before spending an LLM call
    assert.match(admin, /junkFkReferenced\(target, candidate\.pk\)/);
  });
  it('the migration registers the flag OFF and never hard-deletes', () => {
    assert.match(mig, /W8_U1_JUNK_PRESCREEN/);
    assert.match(mig, /'off'/);
    assert.doesNotMatch(mig, /DELETE FROM public\.(entities|recorded_owners|true_owners|contacts)/i);
  });

  // Prompt 65 — scope tighten wiring.
  it('scan excludes connected rows at scan time (batch), before scoring', () => {
    assert.match(admin, /junkConnectedPkSet/);
    assert.match(admin, /excluded_connected/);
    // the batched probe uses in.(…) not a per-row probe for the scan pass
    assert.match(admin, /=in\.\(/);
  });
  it('naming-hygiene backlog is counted, never enqueued', () => {
    assert.match(admin, /naming_hygiene_backlog/);
    assert.match(admin, /junkNamingHygieneRollup/);
    assert.match(admin, /namingHygieneReason/);
  });
  it('keeps are never persisted — only actionable verdicts enqueue (dry-run + apply)', () => {
    assert.match(admin, /isEnqueueableJunkVerdict/);
    assert.match(admin, /kept_not_enqueued/);
  });
});
