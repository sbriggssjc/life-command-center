import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assessCleanAssistEvidence,
  buildCleanAssistPrompt,
  normalizeCleanAssistProposal,
  cleanAssistKind,
  compareNames,
  laddersSay,
  DECISIVE_MIN_CONFIDENCE,
} from '../api/_shared/clean-assist-context.js';
import { sharedEntityEvidence, splitMemberFields } from '../api/_shared/clean-assist-enrich.js';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const item = (decision_type, context) => ({ decision_type, subject_ref: 'x:1', context });

describe('P134 clean-assist evidence gate', () => {
  it('skips a property_merge card whose group members did not resolve', () => {
    // This is the live pre-P134 shape: identifiers, no comparative evidence.
    const g = assessCleanAssistEvidence(item('property_merge', {
      domain: 'gov', property_id: 19066, address: '702 w jerome ave', state: 'AZ', cluster_size: 2,
    }));
    assert.equal(g.sufficient, false);
    assert.equal(g.reason, 'property_merge_members_unresolved');
    assert.equal(g.evidence, null);
  });

  it('passes a property_merge card once the members are attached', () => {
    const g = assessCleanAssistEvidence(item('property_merge', {
      domain: 'gov', property_id: 19066, address: '702 w jerome ave', state: 'AZ', cluster_size: 2,
      members: [
        { property_id: 19066, address: '702 W Jerome Ave', agency: 'GSA', lease_number: 'GS-09-1234' },
        { property_id: 23222, address: '702 w jerome ave', agency: 'GSA', lease_number: null },
      ],
      differing_fields: ['lease_number'], identical_fields: ['agency'],
    }));
    assert.equal(g.sufficient, true);
    assert.equal(g.evidence.members.length, 2);
    assert.deepEqual(g.evidence.differing_fields, ['lease_number']);
  });

  it('skips a provenance conflict with no competing values, and passes one with both', () => {
    const thin = assessCleanAssistEvidence(item('provenance_conflict', {
      kind: 'field_provenance', target_table: 'dia.leases', field_name: 'annual_rent',
      attempted_source: 'folder_feed_lease', current_source: 'om_extraction',
    }));
    assert.equal(thin.sufficient, false);
    assert.equal(thin.reason, 'conflict_values_missing');

    const full = assessCleanAssistEvidence(item('provenance_conflict', {
      kind: 'field_provenance', target_database: 'dia_db', target_table: 'dia.leases',
      record_pk_value: '25069', field_name: 'annual_rent',
      attempted_value: 169360, attempted_source: 'folder_feed_lease', attempted_priority: 45,
      current_value: 187701.91, current_source: 'om_extraction', current_priority: 30,
      decision: 'conflict', decision_reason: 'lease doc disagrees with curated annual_rent',
      priority_ladder: [{ source: 'manual_edit', priority: 1 }, { source: 'om_extraction', priority: 30 }],
    }));
    assert.equal(full.sufficient, true);
    assert.equal(full.evidence.current.priority, 30);
    assert.equal(full.evidence.attempted.priority, 45);
    // LOWER priority number = HIGHER trust: om_extraction(30) beats folder_feed_lease(45).
    assert.equal(full.evidence.ladder_says, 'current_source_outranks_attempted');
    assert.ok(full.evidence.field_priority_ladder.length);
  });

  it('requires the dia sales-price xref narration (detail_1..3 are unlabelled alone)', () => {
    const bare = assessCleanAssistEvidence(item('provenance_conflict', {
      kind: 'sales_price_xref', record_id: 84, detail_1: '22479', detail_2: '7537385.00', detail_3: '6000000.0',
    }));
    assert.equal(bare.sufficient, false);
    assert.equal(bare.reason, 'xref_narration_missing');

    const narrated = assessCleanAssistEvidence(item('provenance_conflict', {
      kind: 'sales_price_xref', record_id: 84, detail_1: '22479', detail_2: '7537385.00', detail_3: '6000000.0',
      issue_narration: 'sales_transactions.sold_price ($7,537,385) disagrees >5% with ownership_history.sold_price ($6,000,000).',
    }));
    assert.equal(narrated.sufficient, true);
    assert.match(narrated.evidence.issue_narration, /ownership_history/);
  });

  it('skips an sf_link candidate whose SF account name never resolved', () => {
    const g = assessCleanAssistEvidence(item('sf_link_candidate', {
      owner_name: 'THE CARRINGTON COMPANY', sf_account_id_resolved: '0018W00002X0NJNQA3',
    }));
    assert.equal(g.sufficient, false);
    assert.equal(g.reason, 'sf_link_account_name_unresolved');
  });

  it('carries the strict-core comparison on a resolved sf_link candidate', () => {
    const g = assessCleanAssistEvidence(item('sf_link_candidate', {
      domain: 'gov', owner_name: 'THE CARRINGTON COMPANY', canonical_name: 'THE CARRINGTON',
      sf_account_name_resolved: 'the carrington', sf_account_id_resolved: '001x', score_resolved: 0.7,
      property_count: 3, match_basis: 'w4_3_splink_v1',
    }));
    assert.equal(g.sufficient, true);
    assert.equal(g.evidence.matcher_score, 0.7);
    assert.equal(g.evidence.matcher_basis, 'w4_3_splink_v1');
    assert.ok(g.evidence.comparison.name_similarity > 0);
  });

  it('skips an owner_reconcile pair missing a side name', () => {
    const g = assessCleanAssistEvidence(item('owner_reconcile', { kind: 'ore', owner_name: 'TK Investment Co' }));
    assert.equal(g.sufficient, false);
    assert.equal(g.reason, 'owner_reconcile_name_missing');
  });

  it('skips a staged intake item that names neither a place nor a party', () => {
    const g = assessCleanAssistEvidence(item('intake_disposition', { intake_id: 'i1', doctype: 'om' }));
    assert.equal(g.sufficient, false);
    assert.equal(g.reason, 'intake_no_address_or_tenant');
  });

  it('turns a resolved intake match into an address-vs-address comparison', () => {
    const g = assessCleanAssistEvidence(item('intake_disposition', {
      intake_id: 'i1', doctype: 'om', address: '20931 Burbank Blvd Ste A', city: 'Woodland Hills', state: 'CA',
      tenant: 'Fresenius', match_status: 'matched', match_domain: 'dia', match_property_id: 24703,
      matched_property: { domain: 'dia', property_id: 24703, address: '20931 Burbank Blvd', city: 'Woodland Hills', state: 'CA' },
    }));
    assert.equal(g.sufficient, true);
    assert.equal(g.evidence.matched_record.property_id, 24703);
    assert.ok(g.evidence.address_comparison.name_similarity > 0.5);
  });
});

describe('P134 name comparison keeps identity and fuzzy pairing separate', () => {
  it('reports ownerCore as a fuzzy signal, never as identity', () => {
    // CLAUDE.md: ownerCore('Realty Income Corporation') is the EMPTY string and
    // 'Agree Realty Corp'/'Agree Holdings LLC' both reduce to 'agree'. The strict
    // core is what may drive an identity claim.
    const c = compareNames('Agree Realty Corp', 'Agree Holdings LLC');
    assert.equal(c.fuzzy_core_a, c.fuzzy_core_b);          // fuzzy says "same"
    assert.equal(c.strict_core_equal, false);              // identity says otherwise
  });

  it('does not call two empty strict cores an identity match', () => {
    const c = compareNames('LLC', 'Inc');
    assert.equal(c.strict_core_equal, false);
  });

  it('accepts a genuine legal-form-only variant', () => {
    const c = compareNames('Brandon Square, LLC', 'Brandon Square LLC');
    assert.equal(c.strict_core_equal, true);
  });
});

describe('P134 ladder reading', () => {
  it('states what the registered ladder implies, and abstains when unregistered', () => {
    assert.equal(laddersSay(3, 55), 'attempted_source_outranks_current');
    assert.equal(laddersSay(55, 3), 'current_source_outranks_attempted');
    assert.equal(laddersSay(30, 30), 'equal_priority_ladder_cannot_decide');
    assert.equal(laddersSay(null, 30), 'unregistered_source_no_ladder_answer');
  });
});

describe('P134 coherence guard', () => {
  it('downgrades a decisive verdict carrying no confidence', () => {
    // The live dry-run's Realty Income sf_link: verdict "merge", confidence 0.00.
    const p = normalizeCleanAssistProposal({ verdict: 'merge', confidence: 0, reason: 'Names match.' }, 'review_triage');
    assert.equal(p.verdict, 'uncertain');
    assert.equal(p.confidence, 0);
    assert.equal(p.coherence_downgraded, true);
    assert.match(p.reason, /Downgraded to uncertain/);
    assert.match(p.reason, /Names match\./);   // the model's own reason is preserved
  });

  it('downgrades decisive verdicts in the other two vocabularies too', () => {
    assert.equal(normalizeCleanAssistProposal({ verdict: 'link', confidence: 0 }, 'unstructured_reconciliation').verdict, 'uncertain');
    assert.equal(normalizeCleanAssistProposal({ verdict: 'accept_attempted', confidence: 0 }, 'conflict_narration').verdict, 'uncertain');
    assert.equal(normalizeCleanAssistProposal({ verdict: 'keep_current', confidence: 0 }, 'conflict_narration').verdict, 'uncertain');
  });

  it('leaves a genuine low-confidence decisive call alone', () => {
    const p = normalizeCleanAssistProposal({ verdict: 'not', confidence: DECISIVE_MIN_CONFIDENCE, reason: 'Different states.' }, 'review_triage');
    assert.equal(p.verdict, 'not');
    assert.equal(p.coherence_downgraded, false);
  });

  it('does not touch an honest non-answer at zero confidence', () => {
    const p = normalizeCleanAssistProposal({ verdict: 'uncertain', confidence: 0, reason: 'Initials only.' }, 'review_triage');
    assert.equal(p.verdict, 'uncertain');
    assert.equal(p.coherence_downgraded, false);
    assert.doesNotMatch(p.reason, /Downgraded/);
    const r = normalizeCleanAssistProposal({ verdict: 'research', confidence: 0 }, 'review_triage');
    assert.equal(r.verdict, 'research');
    assert.equal(r.coherence_downgraded, false);
  });

  it('still clamps an out-of-vocabulary verdict to uncertain', () => {
    assert.equal(normalizeCleanAssistProposal({ verdict: 'merge', confidence: 0.9 }, 'conflict_narration').verdict, 'uncertain');
  });
});

describe('P134 prompt demands grounded reasons', () => {
  it('carries the lane task and the evidence, and forbids a thin-evidence reason', () => {
    const it0 = item('provenance_conflict', {});
    const prompt = buildCleanAssistPrompt(it0, cleanAssistKind('provenance_conflict'), { ladder_says: 'current_source_outranks_attempted' });
    assert.match(prompt, /which source should win/);
    assert.match(prompt, /ladder_says/);
    assert.match(prompt, /keep_current/);
    assert.match(prompt, /MUST quote or name the specific field\/value/);
    assert.match(prompt, /Never return a decisive verdict with confidence 0/);
  });

  it('gives each lane its own task', () => {
    const tasks = ['property_merge', 'owner_reconcile', 'sf_link_candidate', 'intake_disposition']
      .map((t) => buildCleanAssistPrompt(item(t, {}), cleanAssistKind(t), {}));
    assert.match(tasks[0], /co-located/);
    assert.match(tasks[1], /initials or a shared surname alone are NOT identity/i);
    assert.match(tasks[2], /Salesforce account/);
    assert.match(tasks[3], /already-matched record/);
  });
});

describe('P134 enrichment is read-only and evidence-shaped', () => {
  it('names shared facts with the value that makes them checkable', () => {
    const ev = sharedEntityEvidence(
      { name: 'A LLC', entity_type: 'organization', address: '511 48th Ter', city: 'Miami', state: 'FL', email: 'x@acme.com' },
      { name: 'A Inc', entity_type: 'organization', address: '511 48th ter.', city: 'Miami', state: 'FL', email: 'y@acme.com' },
    );
    const byName = Object.fromEntries(ev.map((e) => [e.signal, e.value]));
    assert.equal(byName.shared_mailing_address, '511 48th Ter');
    assert.equal(byName.shared_city_state, 'Miami, FL');
    assert.equal(byName.shared_email_domain, 'acme.com');
    assert.ok(!('shared_email' in byName));
  });

  it('separates the fields that discriminate from the fields that agree', () => {
    // The live gov pair at "702 W Jerome Ave": same agency + RBA, different
    // lease_number/owner ids. The discriminator is what the human decides on.
    const r = splitMemberFields([
      { property_id: 19066, address: '702 W Jerome Ave', agency: 'GSA', rba: 23084, lease_number: 'GS-09-1', gross_rent: null },
      { property_id: 23222, address: '702 w jerome ave', agency: 'GSA', rba: 23084, lease_number: null, gross_rent: null },
    ]);
    assert.deepEqual(r.identical_fields, ['address', 'agency', 'rba']);
    assert.deepEqual(r.differing_fields, ['lease_number']);
    // Blank on BOTH members is neither evidence nor a discriminator.
    assert.ok(!r.identical_fields.includes('gross_rent'));
    assert.ok(!r.differing_fields.includes('gross_rent'));
  });

  it('surfaces an entity-type conflict rather than hiding it', () => {
    const ev = sharedEntityEvidence({ entity_type: 'person' }, { entity_type: 'organization' });
    assert.equal(ev[0].signal, 'entity_type_conflict');
  });

  it('performs no writes and calls no merge/apply RPC', () => {
    const src = read('api/_shared/clean-assist-enrich.js');
    for (const forbidden of ["'POST'", "'PATCH'", "'DELETE'", 'rpc/', 'lcc_merge_entity', 'dia_merge_property', 'gov_merge_property']) {
      assert.equal(src.includes(forbidden), false, `enrichment must not use ${forbidden}`);
    }
    // Every query it does make is a GET.
    const methods = [...src.matchAll(/(?:domainQuery|opsQuery)\((?:[^,]+,\s*)?'([A-Z]+)'/g)].map((m) => m[1]);
    assert.ok(methods.length >= 4, 'expected several reads');
    assert.deepEqual([...new Set(methods)], ['GET']);
  });
});

describe('P134 tick wiring', () => {
  it('gates on evidence before calling the model and reports the skip honestly', () => {
    const admin = read('api/admin.js');
    assert.match(admin, /enrichCleanAssistItems/);
    assert.match(admin, /CA\.assessCleanAssistEvidence\(item\)/);
    // The gate must `continue` BEFORE the AI call, not after it.
    const gateAt = admin.indexOf('CA.assessCleanAssistEvidence(item)');
    const aiAt = admin.indexOf("invokeExtractionAI({ prompt, surface: 'clean_assist' })");
    assert.ok(gateAt > 0 && aiAt > gateAt, 'evidence gate must precede the model call');
    assert.match(admin, /skipped_no_evidence/);
    assert.match(admin, /no_evidence_reasons/);
    assert.match(admin, /coherence_downgraded/);
  });

  it('selects the provenance evidence columns the view already carried', () => {
    const admin = read('api/admin.js');
    assert.match(admin, /attempted_priority,attempted_confidence/);
    assert.match(admin, /current_recorded_at/);
    assert.match(admin, /decision,decision_reason,enforce_mode/);
    assert.match(admin, /issue_kind=eq\.sales_price_xref_conflict/);
    assert.match(admin, /detail_1,detail_2,detail_3,severity,suggested_action/);
  });
});
