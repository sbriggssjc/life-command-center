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
  junkCandidateReason, isJunkCandidate, buildJunkPrescreenPrompt,
  normalizeJunkProposal, parseJunkVerdictJson, planJunkApply, buildRetireMarker,
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
  it('the migration registers the flag OFF and never hard-deletes', () => {
    assert.match(mig, /W8_U1_JUNK_PRESCREEN/);
    assert.match(mig, /'off'/);
    assert.doesNotMatch(mig, /DELETE FROM public\.(entities|recorded_owners|true_owners|contacts)/i);
  });
});
