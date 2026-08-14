// Prompt 106 — property_twin lane deterministic pre-rank + Ollama assist. Unit
// tests for the PURE brain (deterministic classifier, verbatim-quote validator on
// the LLM layer, sort key, agreement, layered proposal) plus structural guards
// that admin.js / server.js / dc-lanes.js / the migration are wired so the assist
// ANNOTATES and SORTS but NEVER merges (the merge RPC is only ever a HUMAN verdict).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  classifyTwinDeterministic, twinEvidenceText, buildTwinAssistPrompt,
  parseTwinAssistJson, normalizeTwinAssistProposal, twinAssistSortKey,
  twinAssistAgreement, buildProposalFromLayers,
  PT_ASSIST_SOURCE, PT_ASSIST_KIND, PT_ASSIST_DECISION_TYPE,
} from '../api/_shared/property-twin-assist-planner.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Real detail shapes grounded on live dia_property_twin_review rows (2026-08-14).
const MERGE_IDENTICAL = { anchor_tenant: 'Carthage Dialysis Center', shadow_tenant: 'Carthage Dialysis Center',
  anchor_operator: 'carthage', shadow_operator: 'carthage', same_norm_address: false, n_anchors: 1 };
const COLOCATED_CONFLICT = { anchor_tenant: 'DaVita Selma Dialysis', shadow_tenant: 'Fresenius Kidney Care East Johnston',
  anchor_operator: 'davita', shadow_operator: 'fresenius', same_norm_address: false, n_anchors: 1 };
const SAME_ADDR_OPCHANGE = { anchor_tenant: 'DaVita Northwest Bethany Dialysis Center', shadow_tenant: 'Physicians Choice Dialysis Bethany',
  anchor_operator: 'davita', shadow_operator: 'physicians', same_norm_address: true, n_anchors: 1 };
const SAME_OP_DIVERGE = { anchor_tenant: 'DaVita Blount Dialysis', shadow_tenant: 'DaVita Kidney Care',
  anchor_operator: 'davita', shadow_operator: 'davita', same_norm_address: false, n_anchors: 1 };
const BLANK_SHADOW = { anchor_tenant: 'Dci Philadelphia', shadow_tenant: null,
  anchor_operator: 'dci', shadow_operator: null, same_norm_address: false, n_anchors: 1 };
const MULTI_ANCHOR = { anchor_tenant: 'DaVita Kidney Care', shadow_tenant: 'Arc Dialysis Hialeah',
  anchor_operator: 'davita', shadow_operator: 'arc', same_norm_address: false, n_anchors: 2 };

describe('classifyTwinDeterministic — the NO-LLM bulk classifier', () => {
  it('same operator + near-identical name -> merge (decisive, no LLM)', () => {
    const r = classifyTwinDeterministic(MERGE_IDENTICAL);
    assert.equal(r.suggest, 'merge');
    assert.equal(r.needs_llm, false);
    assert.equal(r.layer, 'deterministic');
    assert.ok(r.confidence > 0.8);
  });
  it('different operator + distinct address + single anchor -> not_twin (decisive, no LLM)', () => {
    const r = classifyTwinDeterministic(COLOCATED_CONFLICT);
    assert.equal(r.suggest, 'not');
    assert.equal(r.needs_llm, false);
  });
  it('CO-LOCATED FOOTGUN: DaVita vs Fresenius at same coords is NEVER merged', () => {
    const r = classifyTwinDeterministic(COLOCATED_CONFLICT);
    assert.notEqual(r.suggest, 'merge');   // must not auto-merge two operators in one plaza
  });
  it('same normalized address with a different operator -> uncertain (never deterministically not_twin an operator change)', () => {
    const r = classifyTwinDeterministic(SAME_ADDR_OPCHANGE);
    assert.equal(r.suggest, 'uncertain');
    assert.equal(r.needs_llm, true);
  });
  it('same operator but the clinic names diverge -> uncertain (the home-training footgun)', () => {
    const r = classifyTwinDeterministic(SAME_OP_DIVERGE);
    assert.equal(r.suggest, 'uncertain');
    assert.equal(r.needs_llm, true);
  });
  it('blank shadow identity -> uncertain (nothing to compare)', () => {
    const r = classifyTwinDeterministic(BLANK_SHADOW);
    assert.equal(r.suggest, 'uncertain');
    assert.equal(r.needs_llm, true);
  });
  it('multiple nearby anchors -> uncertain', () => {
    const r = classifyTwinDeterministic(MULTI_ANCHOR);
    assert.equal(r.suggest, 'uncertain');
    assert.equal(r.needs_llm, true);
  });
});

describe('twinEvidenceText + buildTwinAssistPrompt', () => {
  it('evidence carries the structured facts verbatim', () => {
    const ev = twinEvidenceText(SAME_ADDR_OPCHANGE);
    assert.match(ev, /anchor_operator: davita/);
    assert.match(ev, /shadow_operator: physicians/);
    assert.match(ev, /same_normalized_address: true/);
  });
  it('prompt forbids inventing facts and few-shots the co-located footgun', () => {
    const p = buildTwinAssistPrompt(COLOCATED_CONFLICT);
    assert.match(p, /ONLY annotate/);
    assert.match(p, /never merge/i);
    assert.match(p, /co-located is NOT the same as a twin|distinct_colocated/);
    assert.match(p, /VERBATIM/);
  });
});

describe('parseTwinAssistJson', () => {
  it('parses fenced and bare JSON, null on garbage', () => {
    assert.deepEqual(parseTwinAssistJson('```json\n{"verdict":"uncertain"}\n```'), { verdict: 'uncertain' });
    assert.deepEqual(parseTwinAssistJson('noise {"a":1} tail'), { a: 1 });
    assert.equal(parseTwinAssistJson('not json'), null);
    assert.equal(parseTwinAssistJson(''), null);
  });
});

describe('normalizeTwinAssistProposal — verbatim-quote precision floor', () => {
  const ev = twinEvidenceText(SAME_ADDR_OPCHANGE);
  it('keeps a decisive verdict whose quote is a verbatim substring of the evidence', () => {
    const n = normalizeTwinAssistProposal(
      { verdict: 'distinct_colocated', confidence: 0.8, evidence_quote: 'anchor_operator: davita', reason: 'different operators' }, ev);
    assert.equal(n.dropped, false);
    assert.equal(n.verdict, 'not');
    assert.equal(n.evidence_quote, 'anchor_operator: davita');
  });
  it('DROPS a decisive verdict whose quote is fabricated (not in the evidence)', () => {
    const n = normalizeTwinAssistProposal(
      { verdict: 'same_facility', confidence: 0.95, evidence_quote: 'both are the same DaVita clinic per CMS', reason: 'invented' }, ev);
    assert.equal(n.dropped, true);
    assert.equal(n.drop_reason, 'quote_not_verbatim');
  });
  it('DROPS a decisive verdict with no quote at all', () => {
    const n = normalizeTwinAssistProposal({ verdict: 'same_facility', confidence: 0.9, reason: 'x' }, ev);
    assert.equal(n.dropped, true);
    assert.equal(n.drop_reason, 'no_evidence');
  });
  it('maps same_facility->merge, distinct_colocated->not, unknown->uncertain', () => {
    assert.equal(normalizeTwinAssistProposal({ verdict: 'uncertain', confidence: 0.3 }, ev).verdict, 'uncertain');
    assert.equal(normalizeTwinAssistProposal({ verdict: 'nonsense', confidence: 0.3 }, ev).verdict, 'uncertain');
  });
});

describe('buildProposalFromLayers — deterministic-first, LLM residue', () => {
  it('deterministic-decisive row returns the deterministic proposal without an LLM answer', () => {
    const p = buildProposalFromLayers(MERGE_IDENTICAL, null);
    assert.equal(p.verdict, 'merge');
    assert.equal(p.layer, 'deterministic');
  });
  it('residue with a valid verbatim LLM answer returns the llm proposal', () => {
    const p = buildProposalFromLayers(SAME_ADDR_OPCHANGE,
      { verdict: 'same_facility', confidence: 0.7, evidence_quote: 'same_normalized_address: true', reason: 'same address, operator change' });
    assert.equal(p.verdict, 'merge');
    assert.equal(p.layer, 'llm');
    assert.equal(p.dropped, false);
  });
  it('residue whose LLM quote is fabricated persists an honest uncertain (dropped counted)', () => {
    const p = buildProposalFromLayers(SAME_ADDR_OPCHANGE,
      { verdict: 'same_facility', confidence: 0.99, evidence_quote: 'they are obviously the same', reason: 'hallucinated' });
    assert.equal(p.verdict, 'uncertain');
    assert.equal(p.dropped, true);
  });
  it('residue with no LLM answer falls back to a deterministic uncertain (cursor advances)', () => {
    const p = buildProposalFromLayers(SAME_ADDR_OPCHANGE, null);
    assert.equal(p.verdict, 'uncertain');
    assert.equal(p.layer, 'deterministic');
  });
});

describe('twinAssistSortKey — easy-first ordering', () => {
  it('deterministic decisive > llm decisive > uncertain > none', () => {
    const det = twinAssistSortKey({ verdict: 'merge', confidence: 0.9, layer: 'deterministic' });
    const llm = twinAssistSortKey({ verdict: 'not', confidence: 0.9, layer: 'llm' });
    const unc = twinAssistSortKey({ verdict: 'uncertain', confidence: 0.9, layer: 'llm' });
    assert.ok(det > llm);
    assert.ok(llm > unc);
    assert.equal(twinAssistSortKey(null), 0);
  });
});

describe('twinAssistAgreement — self-measure (U4)', () => {
  it('measures merge-vs-merge as agreement', () => {
    const a = twinAssistAgreement('merge', 'merge');
    assert.equal(a.measured, true); assert.equal(a.agreed, true);
  });
  it('measures not-vs-not_twin as agreement', () => {
    const a = twinAssistAgreement('not', 'not_twin');
    assert.equal(a.measured, true); assert.equal(a.agreed, true);
  });
  it('measures a disagreement', () => {
    const a = twinAssistAgreement('merge', 'not_twin');
    assert.equal(a.measured, true); assert.equal(a.agreed, false);
  });
  it('does not measure an uncertain assist or a research verdict', () => {
    assert.equal(twinAssistAgreement('uncertain', 'merge').measured, false);
    assert.equal(twinAssistAgreement('merge', 'research').measured, false);
  });
});

describe('store namespacing constants', () => {
  it('uses a collision-free source + fitting kind/type', () => {
    assert.equal(PT_ASSIST_SOURCE, 'property_twin_assist');
    assert.equal(PT_ASSIST_KIND, 'review_triage');
    assert.equal(PT_ASSIST_DECISION_TYPE, 'property_twin');
  });
});

// ---------------------------------------------------------------------------
// Structural wiring guards — the annotation-never-verdict doctrine at the boundary.
// ---------------------------------------------------------------------------
describe('structural wiring guards (admin.js + server.js + dc-lanes.js + migration)', () => {
  const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const lanes = readFileSync(join(root, 'dc-lanes.js'), 'utf8');
  const mig = readFileSync(join(root, 'supabase/migrations/20260814130000_lcc_prompt106_property_twin_assist.sql'), 'utf8');

  it('the tick route is mounted in server.js and dispatched in admin.js', () => {
    assert.match(server, /\/api\/property-twin-assist-tick'/);
    assert.match(admin, /case 'property-twin-assist-tick':\s*return handlePropertyTwinAssistTick/);
  });

  it('the tick is flag-gated (PROPERTY_TWIN_ASSIST) and no-ops OFF on POST', () => {
    assert.match(admin, /w93FlagEnabled\('PROPERTY_TWIN_ASSIST'/);
    assert.match(admin, /skipped: 'feature_flag_off'/);
  });

  it('ANNOTATION-NEVER-VERDICT: the assist section never calls the merge RPC or PATCHes the review status', () => {
    const start = admin.indexOf('// Prompt 106 — property_twin lane deterministic pre-rank');
    assert.ok(start > 0, 'assist section present');
    const end = admin.indexOf('W8 U1 (Prompt 62', start + 50); // next feature section
    const body = admin.slice(start, end > start ? end : start + 12000);
    assert.ok(!/dia_merge_property_reversible/.test(body), 'the tick must never call the merge RPC');
    assert.ok(!/dia_property_twin_review\?id=eq/.test(body), 'the tick must never PATCH a review row');
    // it DOES write only the annotation store
    assert.match(body, /lcc_clean_assist_proposals\?on_conflict/);
    assert.match(body, /property_twin_assist/);
  });

  it('the lane attaches the assist annotation and sorts easy-first by the assist sort key', () => {
    assert.match(admin, /attachPropertyTwinAssist\(out\.items\)/);
    assert.match(admin, /PT\.twinAssistSortKey/);
  });

  it('the verdict handler self-measures agreement via the metadata-only RPC', () => {
    assert.match(admin, /rpc\/lcc_record_property_twin_assist_agreement/);
    assert.match(admin, /PT\.twinAssistAgreement\(assist\.verdict, verdict\)/);
  });

  it('dc-lanes bulk-confirm targets ONLY deterministic merge suggestions', () => {
    assert.match(lanes, /function dcFedBulkTwinMerges/);
    assert.match(lanes, /a\.verdict === 'merge' && a\.layer === 'deterministic'/);
    // it routes each through the HUMAN verdict path
    assert.match(lanes, /type: 'property_twin', subject: p\.it, verdict: 'merge'/);
  });

  it('the migration registers the flag, the source CHECK, the cron, and the accuracy view', () => {
    assert.match(mig, /feature_flags_registry/);
    assert.match(mig, /'PROPERTY_TWIN_ASSIST'/);
    assert.match(mig, /lcc_clean_assist_proposals_source_check/);
    assert.match(mig, /'property_twin_assist'/);
    assert.match(mig, /property-twin-assist-tick/);
    assert.match(mig, /v_lcc_property_twin_assist_accuracy/);
  });
});
