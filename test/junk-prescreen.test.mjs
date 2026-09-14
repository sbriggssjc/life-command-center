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
  deterministicDismissReason, isDeterministicJunk, isExactPlaceholder,
  junkNameHash, junkScoredKeyFor, selectUnscoredCandidates, scoreWithBudget,
  computeScanDeadline, remainingScoreBudget, nextScanCursor,
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
  it('Prompt 67: default threshold is 0.9 (tightened true-junk pool)', () => {
    assert.equal(dismissDistributionGuard({ dismiss: 1 }).threshold, 0.9);
  });
  it('Prompt 67: a true-junk-dominated batch (5/6 = 83% dismiss) is NOT suspect', () => {
    const g = dismissDistributionGuard({ dismiss: 5, keep: 1 });
    assert.equal(g.suspect_distribution, false);
    assert.ok(g.dismiss_share > 0.5 && g.dismiss_share < 0.9);
  });
  it('still refuses the near-total all-dismiss pathology (>90%)', () => {
    const g = dismissDistributionGuard({ dismiss: 19, keep: 1 });
    assert.equal(g.suspect_distribution, true);
    assert.ok(g.dismiss_share > 0.9);
  });
  it('an exactly-at-threshold batch is NOT suspect (refuse only when > threshold)', () => {
    const g = dismissDistributionGuard({ dismiss: 9, keep: 1 }); // 0.9 exactly
    assert.equal(g.dismiss_share, 0.9);
    assert.equal(g.suspect_distribution, false);
  });
  it('the threshold is configurable (env plumbing)', () => {
    const g = dismissDistributionGuard({ dismiss: 5, keep: 1 }, 0.5);
    assert.equal(g.threshold, 0.5);
    assert.equal(g.suspect_distribution, true); // 83% > 0.5
  });
  it('an empty batch is not suspect', () => {
    assert.equal(dismissDistributionGuard({}).suspect_distribution, false);
  });
});

// ===========================================================================
// Prompt 67 — surname guard. Consonant runs inside Germanic/Slavic surname-like
// tokens (WALDSCHMITT, SCHMIDT) are a predictable consonant_run false-positive
// class — real family/partnership names, not gibberish.
// ===========================================================================
describe('surname guard — consonant runs inside surname-like tokens are real names', () => {
  it('CLOVER/WALDSCHMITT, L.L.C. — the live regression fixture — is keep-or-absent', () => {
    const hit = junkCandidateReason('CLOVER/WALDSCHMITT, L.L.C.');
    if (hit) {
      // Still a candidate (downgraded to the LLM), but flagged surnameLike so the
      // post-LLM guard vetoes any dismiss → keep (absent from the enqueued lane).
      assert.equal(hit.surnameLike, true);
      const out = applyPrescreenGuards({ verdict: 'dismiss', confidence: 1 },
        { ...hit, surnameLike: true, entity_name: 'CLOVER/WALDSCHMITT, L.L.C.' },
        { connected: false, hasProvenance: false });
      assert.equal(out.verdict, 'keep');
      assert.ok(out.guards.includes('surname_gate'));
    }
  });
  it('marks a plain Germanic surname consonant run surnameLike', () => {
    const hit = junkCandidateReason('Waldschmitt');
    assert.ok(hit && hit.heuristic === 'consonant_run');
    assert.equal(hit.surnameLike, true);
  });
  it('OCR gibberish with a SECOND junk signal (digit-in-word) is still dismissable', () => {
    const hit = junkCandidateReason('bcdfghjk3');
    assert.ok(hit && hit.heuristic === 'consonant_run');
    assert.notEqual(hit.surnameLike, true);
    const out = applyPrescreenGuards({ verdict: 'dismiss', confidence: 0.95 },
      { ...hit, entity_name: 'bcdfghjk3' }, { connected: false, hasProvenance: false });
    assert.equal(out.verdict, 'dismiss');
  });
  it('pure gibberish consonant run (no surname morphology) is NOT surnameLike', () => {
    const hit = junkCandidateReason('bcdfghjk');
    assert.ok(hit && hit.heuristic === 'consonant_run');
    assert.notEqual(hit.surnameLike, true);
  });
  it('the prompt carries the surname rubric line + calibration example', () => {
    const prompt = buildJunkPrescreenPrompt(
      { domain: 'gov', table: 'recorded_owners', entity_name: 'CLOVER/WALDSCHMITT, L.L.C.',
        heuristic: 'consonant_run', evidence: 'LDSCHM', surnameLike: true }, []);
    assert.match(prompt, /surname_like/);
    assert.match(prompt, /WALDSCHMITT/);
    assert.match(prompt, /Clover\/Waldschmitt.*keep/);
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

// ===========================================================================
// Prompt 66 — bounded, resumable scoring (fix the ollama-latency 502).
// ===========================================================================
describe('junkNameHash — stable, name-sensitive digest', () => {
  it('is deterministic and 16 hex chars', () => {
    const h = junkNameHash('Test Test');
    assert.equal(h, junkNameHash('Test Test'));
    assert.match(h, /^[0-9a-f]{16}$/);
  });
  it('changes when the name changes', () => {
    assert.notEqual(junkNameHash('Test Test'), junkNameHash('Test Test 2'));
  });
  it('treats null / empty consistently', () => {
    assert.equal(junkNameHash(null), junkNameHash(''));
  });
});

describe('selectUnscoredCandidates — the resume cursor', () => {
  const mk = (pk, name) => ({
    subject_ref: junkSubjectRef('dia', 'contacts', pk),
    domain: 'dia', table: 'contacts', pk: String(pk),
    entity_name: name, name_hash: junkNameHash(name),
  });
  it('a second tick skips candidates scored on the first (same name)', () => {
    const a = mk(1, 'asdf'); const b = mk(2, 'qwerty');
    const scored = new Set([junkScoredKeyFor(a)]);
    const remaining = selectUnscoredCandidates([a, b], scored);
    assert.deepEqual(remaining.map((c) => c.pk), ['2']);
  });
  it('a renamed row (same pk, new name_hash) is NOT skipped — re-scored', () => {
    const before = mk(1, 'asdf');
    const scored = new Set([junkScoredKeyFor(before)]);
    const after = mk(1, 'Real Company LLC'); // same pk, different name
    const remaining = selectUnscoredCandidates([after], scored);
    assert.equal(remaining.length, 1);
  });
  it('an empty scored set returns everything', () => {
    const a = mk(1, 'asdf');
    assert.equal(selectUnscoredCandidates([a], new Set()).length, 1);
  });
});

describe('scoreWithBudget — size cap + wall-clock budget', () => {
  it('n-param: caps the count at maxN (batch cap), rest remain unscored', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const r = await scoreWithBudget(items, async () => 'x', { budgetMs: 1e9, maxN: 4, now: () => 0 });
    assert.equal(r.scored, 4);
    assert.equal(r.remaining_unscored, 6);
    assert.equal(r.budget_exhausted, false);
  });
  it('budget-stop: a slow scorer stops at the wall-clock budget (fake clock)', async () => {
    let t = 0;
    const now = () => t;
    const slow = async () => { t += 100; return 'x'; }; // each call "takes" 100ms
    const r = await scoreWithBudget([1, 2, 3, 4, 5], slow, { budgetMs: 250, maxN: 5, now });
    // iter0 (t=0<250) score→t=100; iter1 (100<250) score→t=200; iter2 (200<250) score→t=300; iter3 300>=250 break
    assert.equal(r.scored, 3);
    assert.equal(r.budget_exhausted, true);
    assert.equal(r.remaining_unscored, 2);
  });
  it('no candidates ⇒ nothing scored, not exhausted', async () => {
    const r = await scoreWithBudget([], async () => 'x', { budgetMs: 1000, maxN: 5, now: () => 0 });
    assert.equal(r.scored, 0);
    assert.equal(r.budget_exhausted, false);
  });
  it('budget beats maxN when both bound — honest counts', async () => {
    let t = 0; const now = () => t;
    const slow = async () => { t += 1000; return 'x'; };
    const r = await scoreWithBudget([1, 2, 3, 4, 5, 6, 7, 8], slow, { budgetMs: 2500, maxN: 8, now });
    assert.equal(r.scored, 3); // 3 calls consume 3000ms > 2500 budget
    assert.equal(r.budget_exhausted, true);
  });
});

// Prompt 84 — windowed resumable scan: budget split + keyset cursor (pure).
describe('computeScanDeadline — scan gets a bounded share, scoring keeps its slice', () => {
  it('reserves the scoring floor: scan may use at most tick − minScore', () => {
    // start=1000, tick=120000, scan cap 60000, reserve 20000 → scan share 60000.
    assert.equal(computeScanDeadline(1000, { tickBudgetMs: 120000, scanBudgetMs: 60000, minScoreBudgetMs: 20000 }), 61000);
  });
  it('the scan-budget cap binds when it is the smaller of the two', () => {
    // tick − reserve = 100000, scanBudget = 30000 → min is 30000.
    assert.equal(computeScanDeadline(0, { tickBudgetMs: 120000, scanBudgetMs: 30000, minScoreBudgetMs: 20000 }), 30000);
  });
  it('a reserve larger than the tick clamps the scan share to 0 (scoring wins)', () => {
    assert.equal(computeScanDeadline(500, { tickBudgetMs: 10000, scanBudgetMs: 60000, minScoreBudgetMs: 20000 }), 500);
  });
});

describe('remainingScoreBudget — scoring ALWAYS gets its slice', () => {
  it('returns the remaining tick budget when it exceeds the floor', () => {
    // deadline 100000, now 40000 → 60000 remaining > 20000 floor.
    assert.equal(remainingScoreBudget(40000, 100000, 20000), 60000);
  });
  it('floors at minScore even when the scan overran (remaining ≤ floor)', () => {
    // now 95000 past a 100000 deadline leaves 5000 < 20000 → floored to 20000.
    assert.equal(remainingScoreBudget(95000, 100000, 20000), 20000);
    // even a NEGATIVE remaining (scan blew the whole budget) still gets the floor.
    assert.equal(remainingScoreBudget(130000, 100000, 20000), 20000);
  });
});

describe('nextScanCursor — resumable keyset (advance vs wrap)', () => {
  it('advances to the last pk when the window was bounded mid-table', () => {
    const r = nextScanCursor({ reachedEnd: false, truncated: true, lastPk: '4200', startCursor: '1000' });
    assert.deepEqual(r, { nextCursor: '4200', wrapped: false });
  });
  it('wraps (null) when the table end was reached', () => {
    const r = nextScanCursor({ reachedEnd: true, truncated: false, lastPk: '9999', startCursor: '5000' });
    assert.deepEqual(r, { nextCursor: null, wrapped: true });
  });
  it('wraps when the window under-filled (not truncated) — a light table restarts', () => {
    const r = nextScanCursor({ reachedEnd: false, truncated: false, lastPk: '30', startCursor: null });
    assert.deepEqual(r, { nextCursor: null, wrapped: true });
  });
  it('holds the start cursor when a bounded window saw no rows (lastPk null)', () => {
    const r = nextScanCursor({ reachedEnd: false, truncated: true, lastPk: null, startCursor: '7000' });
    assert.deepEqual(r, { nextCursor: '7000', wrapped: false });
  });
});

// ===========================================================================
// Prompt 85 (W8 U1) — deterministic-certainty junk bypasses the LLM + the guard.
// blank_name / all_non_alpha / EXACT placeholder dismiss with NO model call and
// are EXCLUDED from the dismiss-share guard (which polices a runaway MODEL, not
// arithmetic). Fixes the 100%-deterministic-batch livelock (20/20 blank-name
// dismiss refused as suspect_distribution forever).
// ===========================================================================
describe('deterministicDismissReason — class routing (deterministic vs LLM)', () => {
  it('blank / all-non-alpha are deterministic dismissals (skip the LLM)', () => {
    assert.equal(deterministicDismissReason('')?.heuristic, 'blank_name');
    assert.equal(deterministicDismissReason('   ')?.heuristic, 'blank_name');
    assert.equal(deterministicDismissReason(null)?.heuristic, 'blank_name');
    assert.equal(deterministicDismissReason('--')?.heuristic, 'all_non_alpha');
    assert.equal(deterministicDismissReason('12345')?.heuristic, 'all_non_alpha');
  });
  it('an EXACT placeholder is deterministic; a fuzzy token hit is NOT', () => {
    assert.equal(deterministicDismissReason('Test Test')?.heuristic, 'token_junk');
    assert.equal(deterministicDismissReason('Tbd')?.heuristic, 'token_junk');
    assert.equal(deterministicDismissReason('Unknown')?.heuristic, 'token_junk');
    assert.equal(deterministicDismissReason('N/A')?.heuristic, 'token_junk');
    // fuzzy: starts with a junk token but carries real-ish words → stays LLM.
    assert.equal(deterministicDismissReason('TEST company do not use'), null);
    assert.equal(deterministicDismissReason('Sample Realty Partners LLC'), null);
  });
  it('the evidence is the verbatim value (empty for a blank name)', () => {
    assert.equal(deterministicDismissReason('')?.evidence, '');
    assert.equal(deterministicDismissReason('--')?.evidence, '--');
  });
  it('JUDGMENT classes (consonant_run / no_vowel) are NOT deterministic → LLM', () => {
    assert.equal(deterministicDismissReason('bcdfghjk'), null); // consonant_run
    assert.equal(deterministicDismissReason('SMBC'), null);     // no_vowel acronym
    assert.equal(deterministicDismissReason('AB'), null);       // too_short
  });
  it('a plausibly-real name is never deterministic junk', () => {
    for (const n of ['Fresenius Medical Care', 'Northmarq', 'Cohen Cos']) {
      assert.equal(isDeterministicJunk(n), false, `${n}`);
    }
  });
  it('isExactPlaceholder distinguishes whole-value vs prefix', () => {
    assert.equal(isExactPlaceholder('Test Test'), true);
    assert.equal(isExactPlaceholder('placeholder'), true);
    assert.equal(isExactPlaceholder('placeholder holdings llc'), false);
    assert.equal(isExactPlaceholder(''), false);
  });
});

describe('dismiss-share guard denominator — LLM-judged verdicts only (Prompt 85)', () => {
  it('a 100%-deterministic batch (empty LLM map) is NOT suspect — persists', () => {
    // The livelock regression: 20/20 blank-name dismiss used to refuse forever.
    // With deterministic dismissals excluded, the LLM denominator is empty → not
    // suspect → the batch persists and its scored-markers advance.
    const g = dismissDistributionGuard({}, 0.9);
    assert.equal(g.suspect_distribution, false);
    assert.equal(g.total, 0);
  });
  it('a mixed batch is judged ONLY on its LLM verdicts', () => {
    // 100 deterministic dismissals are NOT in this map; the LLM judged 6 rows.
    const llmVerdicts = { dismiss: 5, keep: 1 }; // 83% of the LLM subset
    const g = dismissDistributionGuard(llmVerdicts, 0.9);
    assert.equal(g.suspect_distribution, false);
    assert.equal(g.total, 6);
  });
  it('a genuinely runaway MODEL (>90% of LLM verdicts) is still refused', () => {
    const g = dismissDistributionGuard({ dismiss: 19, keep: 1 }, 0.9);
    assert.equal(g.suspect_distribution, true);
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
    assert.match(admin, /junkNamingHygieneFlat/);
    assert.match(admin, /namingHygieneReason/);
  });
  it('keeps are never persisted — only actionable verdicts enqueue (dry-run + apply)', () => {
    assert.match(admin, /isEnqueueableJunkVerdict/);
    assert.match(admin, /kept_not_enqueued/);
  });

  // Prompt 66 — bounded, resumable scoring wiring.
  it('scoring is budget-bounded on both the inline and apply paths', () => {
    assert.match(admin, /JUNK_SCORE_BUDGET_MS/);
    assert.match(admin, /scoreWithBudget/);
    assert.match(admin, /budget_exhausted/);
  });
  it('the inline dry-run accepts &n and defaults small (drop 20 → 6)', () => {
    assert.match(admin, /req\.query\.n/);
    assert.match(admin, /JUNK_SCORE_INLINE_DEFAULT_N/);
  });
  it('the apply path caps at one ollama-sized batch (JUNK_SCORE_BATCH_SIZE)', () => {
    assert.match(admin, /JUNK_SCORE_BATCH_SIZE/);
    assert.match(admin, /batch_size/);
  });
  it('scored candidates are recorded as the resume cursor + excluded next scan', () => {
    assert.match(admin, /recordJunkScored/);
    assert.match(admin, /junk_prescreen_scored/);
    assert.match(admin, /selectUnscoredCandidates/);
    assert.match(admin, /excluded_scored/);
  });
  it('honest surfacing: remaining_unscored is reported', () => {
    assert.match(admin, /remaining_unscored/);
  });

  // Prompt 67 — configurable distribution threshold + surname guard wiring.
  it('the dismiss-share threshold is env-configurable and plumbed into the guard', () => {
    assert.match(admin, /JUNK_DISMISS_GUARD_THRESHOLD/);
    assert.match(admin, /dismissDistributionGuard\([^)]*JUNK_DISMISS_GUARD_THRESHOLD/);
  });
  it('the surnameLike flag is carried onto the scanned candidate', () => {
    assert.match(admin, /surnameLike: hit\.surnameLike/);
  });
  it('the resume-cursor migration adds junk_prescreen_scored keyed on name_hash', () => {
    const cur = readFileSync(join(root, 'supabase/migrations/20260807140000_lcc_w8_u1_junk_prescreen_scored_cursor.sql'), 'utf8');
    assert.match(cur, /CREATE TABLE IF NOT EXISTS public\.junk_prescreen_scored/);
    assert.match(cur, /UNIQUE \(domain, table_name, pk_value, name_hash\)/);
    assert.match(cur, /scored_total/);
  });

  // Prompt 84 — windowed resumable scan + batch lifecycle wiring.
  it('the scan is windowed by a keyset cursor, not a full-table offset scan', () => {
    // the offset ceiling constant is gone; the window + keyset predicate are in.
    assert.doesNotMatch(admin, /JUNK_PRESCREEN_MAX_SCAN/);
    assert.match(admin, /JUNK_SCAN_WINDOW/);
    assert.match(admin, /pullJunkCandidatesForTarget\(target, /);
    assert.match(admin, /'=gt\.'/); // keyset predicate pkCol > cursor
  });
  it('the tick reads + advances per-target keyset cursors via the batch ledger', () => {
    assert.match(admin, /fetchJunkScanCursors/);
    assert.match(admin, /batch_kind=eq\.scan&order=created_at\.desc&limit=1/);
    assert.match(admin, /scan_cursors: scan\.nextCursors/);
  });
  it('the budget split guarantees scoring its slice (scan can’t eat the budget)', () => {
    assert.match(admin, /computeScanDeadline/);
    assert.match(admin, /remainingScoreBudget/);
    assert.match(admin, /JUNK_MIN_SCORE_BUDGET_MS/);
    // scoring's wall-clock is the guaranteed remaining slice, not a flat constant
    assert.match(admin, /budgetMs: scoreBudgetMs/);
  });
  it('the scan batch is CLOSED after scoring (status lifecycle, not perpetual open)', () => {
    assert.match(admin, /closeJunkScanBatch/);
    assert.match(admin, /status: status \|\| 'closed'/);
    // closed on the happy path AND the suspect-distribution refusal path
    assert.match(admin, /closeJunkScanBatch\(scanBatchId, 'closed', summary\)/);
  });
  it('the apply batch carries honest scored / by_verdict bookkeeping', () => {
    assert.match(admin, /by_verdict: summary\?\.by_verdict/);
    assert.match(admin, /scored: summary\?\.scored/);
  });
  it('the naming-hygiene backlog is persisted FLAT so the systemic reader sees a total', () => {
    assert.match(admin, /junkNamingHygieneFlat/);
  });
  // Prompt 85 — deterministic-certainty bypass + LLM-only guard denominator.
  it('deterministic-certainty junk bypasses the LLM (no model call)', () => {
    assert.match(admin, /deterministicDismissReason/);
    assert.match(admin, /provider: 'none'/);
    assert.match(admin, /deterministic: true/);
    assert.match(admin, /JUNK_DET_BATCH_SIZE/);
  });
  it('the batch is composed deterministic-first, LLM budget on judgment classes', () => {
    assert.match(admin, /const detCands = \[\], llmCands = \[\]/);
    assert.match(admin, /scoreWithBudget\(llmCands/);
  });
  it('the dismiss-share guard measures ONLY the LLM-judged subset', () => {
    assert.match(admin, /dismissDistributionGuard\(llmVerdicts/);
    assert.match(admin, /deterministic_dismissed/);
    assert.match(admin, /llm_scored/);
    assert.match(admin, /llm_dismiss_share/);
  });
  it('the close-status migration widens the CHECK to add closed (additive/loosening)', () => {
    const m = readFileSync(join(root, 'supabase/migrations/20260808140000_lcc_w8_u1_scan_batch_close_status.sql'), 'utf8');
    assert.match(m, /junk_review_batch_status_check/);
    assert.match(m, /'open', 'closed', 'applied', 'conflict', 'reversed', 'dismissed'/);
    assert.doesNotMatch(m, /DELETE FROM/i);
  });
});
