// W8 U5 (Prompt 79) — naming-hygiene planner unit tests. Pure-module coverage of
// the deterministic abbreviation dictionary, the ambiguous->LLM split, the
// address-link planning, the apply plan, plus structural guards on the migration
// (fsp rows registered + flag OFF in-migration + reversible ledger).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  expandAbbreviations, planAbbreviationProposal, hygieneClass,
  normalizeAddressForMatch, planAddressLinkProposal, normalizeExpansionProposal,
  planHygieneApply, isEnqueueableHygieneProposal, hygieneSubjectRef,
  parseHygieneSubjectRef, NAMING_HYGIENE_TARGETS, findHygieneTarget,
  ABBREV_EXPANSION, AMBIGUOUS_ABBREV,
} from '../api/_shared/naming-hygiene-planner.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('deterministic abbreviation expansion', () => {
  it('expands an unambiguous single token (Prtnrs -> Partners)', () => {
    const r = expandAbbreviations('Cohen Prtnrs');
    assert.equal(r.expanded, 'Cohen Partners');
    assert.equal(r.deterministic, true);
    assert.deepEqual(r.changes, [{ from: 'Prtnrs', to: 'Partners' }]);
    assert.deepEqual(r.ambiguous, []);
  });

  it('expands multiple unambiguous tokens (Mgmt Grp)', () => {
    const r = expandAbbreviations('Acme Mgmt Grp');
    assert.equal(r.expanded, 'Acme Management Group');
    assert.equal(r.deterministic, true);
    assert.equal(r.changes.length, 2);
  });

  it('preserves ALL-CAPS casing', () => {
    const r = expandAbbreviations('ACME MGMT');
    assert.equal(r.expanded, 'ACME MANAGEMENT');
  });

  it('does NOT expand an ambiguous token (Cos)', () => {
    const r = expandAbbreviations('Cohen Cos');
    assert.equal(r.deterministic, false);
    assert.deepEqual(r.ambiguous, ['Cos']);
    assert.equal(r.expanded, 'Cohen Cos'); // unchanged
  });

  it('does NOT expand Corp (valid legal form kept as-is)', () => {
    const r = expandAbbreviations('Acme Corp');
    assert.equal(r.deterministic, false);
    assert.equal(r.changes.length, 0);
    assert.deepEqual(r.ambiguous, []); // corp is excluded from the ambiguous set too
  });

  it('mixed: expands the unambiguous part, flags the ambiguous remainder', () => {
    const r = expandAbbreviations('Cohen Mgmt Cos');
    assert.match(r.expanded, /Management/);
    assert.deepEqual(r.ambiguous, ['Cos']);
    assert.equal(r.deterministic, false);
  });

  it('the dictionary and the ambiguous set are disjoint', () => {
    for (const k of Object.keys(ABBREV_EXPANSION)) {
      assert.equal(AMBIGUOUS_ABBREV.has(k), false, `${k} is in BOTH the dictionary and the ambiguous set`);
    }
  });
});

describe('planAbbreviationProposal', () => {
  it('deterministic rename carries the expanded name + evidence', () => {
    const p = planAbbreviationProposal('Cohen Prtnrs');
    assert.equal(p.actionable, true);
    assert.equal(p.deterministic, true);
    assert.equal(p.proposed_action, 'rename');
    assert.equal(p.proposed_name, 'Cohen Partners');
    assert.match(p.evidence, /Prtnrs/);
  });

  it('ambiguous rename defers the name to the model', () => {
    const p = planAbbreviationProposal('Cohen Cos');
    assert.equal(p.actionable, true);
    assert.equal(p.deterministic, false);
    assert.equal(p.proposed_name, null);
    assert.deepEqual(p.ambiguous, ['Cos']);
  });

  it('a name whose only abbrev is Corp is NOT actionable', () => {
    const p = planAbbreviationProposal('Acme Corp');
    assert.equal(p.actionable, false);
    assert.equal(p.proposed_action, 'keep');
  });
});

describe('hygiene classifier passthrough', () => {
  it('flags known_abbreviation', () => assert.equal(hygieneClass('Cohen Prtnrs'), 'known_abbreviation'));
  it('flags address_as_name', () => assert.equal(hygieneClass('3710 Fm 1889'), 'address_as_name'));
  it('a clean name is null', () => assert.equal(hygieneClass('Blackstone Real Estate Trust'), null));
  it('an address-named SPE with a legal form is NOT address_as_name', () =>
    assert.equal(hygieneClass('20931 Burbank Blvd LLC'), null));
});

describe('address normalization + link planning', () => {
  it('normalizes suffixes and drops suite detail', () => {
    assert.equal(normalizeAddressForMatch('3710 Farm Road, Suite 200'), '3710 FARM RD');
  });

  it('resolved single match -> link_property (+ fill-blanks owner name)', () => {
    const plan = planAddressLinkProposal('3710 Fm 1889', {
      resolved: { domain: 'dia', property_id: 42, address: '3710 FM 1889', owner_name: 'Riverside Holdings LLC' },
      ambiguousCount: 1,
    });
    assert.equal(plan.proposed_action, 'link_property');
    assert.equal(plan.actionable, true);
    assert.equal(plan.proposed_property.property_id, 42);
    assert.equal(plan.proposed_name, 'Riverside Holdings LLC');
  });

  it('resolved owner that is itself an address -> link only, no rename', () => {
    const plan = planAddressLinkProposal('3710 Fm 1889', {
      resolved: { domain: 'dia', property_id: 42, address: '3710 FM 1889', owner_name: '3710 Fm 1889' },
      ambiguousCount: 1,
    });
    assert.equal(plan.proposed_action, 'link_property');
    assert.equal(plan.proposed_name, null);
  });

  it('ambiguous (>1 property) -> uncertain, not actionable (never guess)', () => {
    const plan = planAddressLinkProposal('100 Main St', { resolved: null, ambiguousCount: 3 });
    assert.equal(plan.proposed_action, 'uncertain');
    assert.equal(plan.actionable, false);
  });

  it('no property resolved -> uncertain', () => {
    const plan = planAddressLinkProposal('100 Main St', { resolved: null, ambiguousCount: 0 });
    assert.equal(plan.proposed_action, 'uncertain');
    assert.equal(plan.actionable, false);
  });
});

describe('normalizeExpansionProposal (LLM guardrails)', () => {
  const cand = { entity_name: 'Cohen Cos' };
  it('keep verdict -> keep (non-event)', () => {
    const r = normalizeExpansionProposal({ keep: true, changed: false }, cand);
    assert.equal(r.action, 'keep');
  });
  it('safe lengthening expansion -> rename', () => {
    const r = normalizeExpansionProposal({ expanded_name: 'Cohen Companies', changed: true, confidence: 0.8 }, cand);
    assert.equal(r.action, 'rename');
    assert.equal(r.proposed_name, 'Cohen Companies');
  });
  it('hallucinated rewrite (different first word / shorter) -> uncertain', () => {
    const r = normalizeExpansionProposal({ expanded_name: 'XYZ', changed: true, confidence: 0.9 }, cand);
    assert.equal(r.action, 'uncertain');
  });
  it('no-change expansion -> keep', () => {
    const r = normalizeExpansionProposal({ expanded_name: 'Cohen Cos', changed: true }, cand);
    assert.equal(r.action, 'keep');
  });
});

describe('planHygieneApply', () => {
  it('confirm + rename -> apply_rename', () =>
    assert.equal(planHygieneApply({ humanVerdict: 'confirm', proposedAction: 'rename' }).action, 'apply_rename'));
  it('confirm + link_property -> apply_link', () =>
    assert.equal(planHygieneApply({ humanVerdict: 'confirm', proposedAction: 'link_property' }).action, 'apply_link'));
  it('confirm + keep -> dismiss_proposal', () =>
    assert.equal(planHygieneApply({ humanVerdict: 'confirm', proposedAction: 'keep' }).action, 'dismiss_proposal'));
  it('reject -> dismiss_proposal', () =>
    assert.equal(planHygieneApply({ humanVerdict: 'reject', proposedAction: 'rename' }).action, 'dismiss_proposal'));
});

describe('isEnqueueableHygieneProposal (honest counts)', () => {
  it('a rename with a proposed name enqueues', () =>
    assert.equal(isEnqueueableHygieneProposal({ proposed_action: 'rename', proposed_name: 'Cohen Partners', deterministic: true }), true));
  it('a link with a property enqueues', () =>
    assert.equal(isEnqueueableHygieneProposal({ proposed_action: 'link_property', proposed_property: { property_id: 42 } }), true));
  it('a keep does NOT enqueue', () =>
    assert.equal(isEnqueueableHygieneProposal({ proposed_action: 'keep' }), false));
  it('an uncertain link (no property) does NOT enqueue', () =>
    assert.equal(isEnqueueableHygieneProposal({ proposed_action: 'link_property', proposed_property: null }), false));
});

describe('subject_ref + target catalogue', () => {
  it('subject_ref round-trips and canonicalizes the domain', () => {
    assert.equal(hygieneSubjectRef('dialysis', 'recorded_owners', 42), 'hyg:dia:recorded_owners:42');
    assert.deepEqual(parseHygieneSubjectRef('hyg:gov:contacts:7'), { domain: 'gov', table: 'contacts', pk: '7' });
  });
  it('covers the 7 entity tables with provenance config', () => {
    assert.equal(NAMING_HYGIENE_TARGETS.length, 7);
    for (const t of NAMING_HYGIENE_TARGETS) {
      assert.ok(t.provTable, `${t.domain}:${t.table} missing provTable`);
      assert.ok(t.provDatabase, `${t.domain}:${t.table} missing provDatabase`);
      assert.ok(t.nameCol, `${t.domain}:${t.table} missing nameCol`);
    }
  });
  it('only LCC entities carry canonicalCol + propertyLink', () => {
    const ent = findHygieneTarget('lcc', 'entities');
    assert.equal(ent.canonicalCol, 'canonical_name');
    assert.equal(ent.propertyLink, true);
    const dia = findHygieneTarget('dia', 'recorded_owners');
    assert.equal(dia.canonicalCol, null);
    assert.equal(dia.propertyLink, false);
  });
});

describe('migration structural guards (W8 doctrine)', () => {
  const mig = readFileSync(join(root, 'supabase/migrations/20260808120000_lcc_w8_u5_naming_hygiene.sql'), 'utf8');
  it('registers the feature flag OFF in-migration (36y rule)', () => {
    assert.match(mig, /feature_flags_registry/);
    assert.match(mig, /'W8_U5_NAMING_HYGIENE'/);
    assert.match(mig, /'off'/);
  });
  it('registers field_source_priority rows so the unranked view stays clean', () => {
    assert.match(mig, /field_source_priority/);
    assert.match(mig, /'w8_u5_naming_hygiene'/);
    // every writer-touched (target_table, field) combo must have an fsp row
    for (const combo of ['entities', 'dia.recorded_owners', 'dia.true_owners', 'dia.contacts',
      'gov.recorded_owners', 'gov.true_owners', 'gov.contacts']) {
      assert.ok(mig.includes(`'${combo}'`), `fsp row missing for ${combo}`);
    }
  });
  it('creates a reversible ledger + the proposal table + the open view', () => {
    assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.naming_hygiene_batch/);
    assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.naming_hygiene_review/);
    assert.match(mig, /reversal\s+jsonb/);
    assert.match(mig, /v_naming_hygiene_review_open/);
  });
  it('schedules the staggered nightly cron (04:25) that no-ops while OFF', () => {
    assert.match(mig, /naming-hygiene-tick/);
    assert.match(mig, /'25 4 \* \* \*'/);
  });
});
