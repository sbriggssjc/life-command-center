// W9.6 (Prompt 102) — correspondence → owner-LLC attribution planner tests.
// Path-A join proposal shaping, Path-B verbatim + the shared-token false-bridge
// guard, value-gate ordering, subject-ref stability, and never-fabricate.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as COA from '../api/_shared/comms-owner-attribution.js';

describe('coaSubjectRef', () => {
  it('is stable + path/domain-namespaced', () => {
    assert.equal(COA.coaSubjectRef('property_bridge', 'dia', 'A', 'B'), 'coa:property_bridge:dia:A:B');
    assert.equal(COA.coaSubjectRef('person_match', 'government', 'A', 'B'), 'coa:person_match:gov:A:B');
  });
});

describe('sharedTokenOnly (false-bridge guard)', () => {
  it('true when only a single surname token overlaps (corporate stopwords ignored)', () => {
    // person {john, smith} vs owner {smith} (holdings/llc are stopwords) → overlap 1.
    assert.equal(COA.sharedTokenOnly('John Smith', 'Smith Holdings LLC'), true);
  });
  it('false when two+ distinctive tokens overlap', () => {
    assert.equal(COA.sharedTokenOnly('Riverside Medical', 'Riverside Medical Partners LP'), false);
  });
  it('true when there is no significant content to corroborate', () => {
    assert.equal(COA.sharedTokenOnly('LLC', 'The Company'), true);
    assert.equal(COA.sharedTokenOnly('', 'Anything Group'), true);
  });
  it('significantTokens drops legal/stopword tokens', () => {
    assert.deepEqual(COA.significantTokens('Acme Holdings LLC').sort(), ['acme']);
  });
});

describe('valueGateCandidates', () => {
  it('orders valued (rank_value>0) desc, then zero-rank, deterministic tiebreak', () => {
    const rows = [
      { corr_entity_id: 'c1', owner_entity_id: 'o1', rank_value: 0 },
      { corr_entity_id: 'c2', owner_entity_id: 'o2', rank_value: 12 },
      { corr_entity_id: 'c3', owner_entity_id: 'o3', rank_value: 3 },
    ];
    const out = COA.valueGateCandidates(rows).map((r) => r.owner_entity_id);
    assert.deepEqual(out, ['o2', 'o3', 'o1']);
  });
});

describe('buildPathAProposal (property_bridge, deterministic)', () => {
  const cand = {
    corr_entity_id: 'asset-1', corr_entity_name: '123 Main St', owner_entity_id: 'owner-1',
    owner_true_owner_id: 'to-1', owner_domain: 'dia', owner_name: 'Acme Holdings LLC',
    property_label: '123 Main St', corr_row_count: 4, sample_activity_id: 'ae-1', rank_value: 9,
  };
  it('shapes a full proposal at confidence 1.0 with the join evidence', () => {
    const p = COA.buildPathAProposal(cand, { sourceRunId: 'r1' });
    assert.equal(p.path, 'property_bridge');
    assert.equal(p.confidence, 1.0);
    assert.equal(p.subject_ref, 'coa:property_bridge:dia:asset-1:owner-1');
    assert.equal(p.target_owner_id, 'to-1');
    assert.equal(p.tie_kind, 'owns_edge');
    assert.match(p.evidence_quote, /owns-edge/);
    assert.equal(p.provenance_source, 'comms_owner_bridge');
  });
  it('returns null when a required id is missing (never fabricates)', () => {
    assert.equal(COA.buildPathAProposal({ ...cand, owner_true_owner_id: null }), null);
    assert.equal(COA.buildPathAProposal({ ...cand, owner_domain: 'xx' }), null);
  });
});

describe('buildPathBProposal (person_match, verbatim + guard)', () => {
  const base = {
    corr_entity_id: 'person-1', owner_entity_id: 'owner-9', owner_true_owner_id: 'to-9',
    owner_domain: 'gov', owner_name: 'Smith Holdings LLC', corr_row_count: 2, sample_activity_id: 'ae-9', rank_value: 5,
  };
  it('active_contact (pivot) always proposes, carries verbatim header evidence', () => {
    const p = COA.buildPathBProposal({ ...base, tie_kind: 'active_contact',
      correspondent_name: 'John Smith', correspondent_email: 'john@smithco.com' });
    assert.equal(p.path, 'person_match');
    assert.equal(p.tie_kind, 'active_contact');
    assert.equal(p.confidence, COA.COA_CONF_PERSON_PIVOT);
    assert.equal(p.evidence_quote, 'John Smith <john@smithco.com>');
    assert.equal(p.correspondent_email, 'john@smithco.com');
  });
  it('relationship tier with NO email AND shared-token-only name is REJECTED (false-bridge)', () => {
    const p = COA.buildPathBProposal({ ...base, tie_kind: 'relationship',
      correspondent_name: 'John Smith', correspondent_email: null });
    assert.equal(p, null);
  });
  it('relationship tier with a corroborating email is proposed even on a shared token', () => {
    const p = COA.buildPathBProposal({ ...base, tie_kind: 'relationship',
      correspondent_name: 'John Smith', correspondent_email: 'john@smith-holdings.com' });
    assert.ok(p);
    assert.equal(p.confidence, COA.COA_CONF_PERSON_RELATIONSHIP);
    assert.equal(p.evidence_quote, 'John Smith <john@smith-holdings.com>');
  });
  it('relationship tier with a distinctive multi-token name (no email) is allowed', () => {
    const p = COA.buildPathBProposal({ ...base, owner_name: 'Riverside Medical Partners LP',
      tie_kind: 'relationship', correspondent_name: 'Riverside Medical Trust', correspondent_email: null });
    assert.ok(p);
    assert.equal(p.evidence_quote, 'Riverside Medical Trust');
  });
  it('returns null when a required id is missing', () => {
    assert.equal(COA.buildPathBProposal({ ...base, owner_entity_id: null }), null);
  });
});

describe('W9.6 P103 precision guards', () => {
  const base = {
    corr_entity_id: 'person-1', owner_entity_id: 'owner-9', owner_true_owner_id: 'to-9',
    owner_domain: 'gov', owner_name: 'Boyd Watterson Asset Management, LLC',
    corr_row_count: 2, sample_activity_id: 'ae-9', rank_value: 5, tie_kind: 'relationship',
  };
  it('isInternalTeamEmail flags own-firm / teammate domains only', () => {
    assert.equal(COA.isInternalTeamEmail('sabriggs@northmarq.com'), true);
    assert.equal(COA.isInternalTeamEmail('tscrivner@northmarq.com'), true);
    assert.equal(COA.isInternalTeamEmail('someone@stanjohnsonco.com'), true);
    assert.equal(COA.isInternalTeamEmail('jcapra@boydwatterson.com'), false);
    assert.equal(COA.isInternalTeamEmail(null), false);
  });
  it('isBrokerageOwnerName flags majors + token tells + registered mark, spares real owners', () => {
    for (const n of ['Avison Young', 'Newmark Knight Frank', 'Kidder Mathews', 'Transwestern',
      'Coldwell Banker Commercial®', 'Cushman & Wakefield', 'Stan Johnson Co', 'Colliers',
      'Matthews Real Estate Investment Services', 'Marcus & Millichap']) {
      assert.equal(COA.isBrokerageOwnerName(n), true, n);
    }
    for (const n of ['Boyd Watterson Asset Management, LLC', 'Kingsbarn Realty', 'Realty Income',
      'Easterly Partners', 'Cook Commercial Partners', 'Anchor Point Capital, Inc',
      'Elliott Bay Healthcare Realty Llc']) {
      assert.equal(COA.isBrokerageOwnerName(n), false, n);
    }
    assert.equal(COA.isBrokerageOwnerName(''), false);
  });
  it('drops an INTERNAL-TEAM correspondent (Scott Briggs → Stan Johnson Co)', () => {
    const p = COA.buildPathBProposal({ ...base, owner_name: 'Stan Johnson Co',
      correspondent_name: 'Scott Briggs', correspondent_email: 'sabriggs@northmarq.com' });
    assert.equal(p, null);
    assert.equal(COA.pathBDropReason({ correspondent_email: 'sabriggs@northmarq.com', owner_name: 'Stan Johnson Co' }), 'internal_team');
  });
  it('drops a BROKERAGE-TARGET owner (broker → Avison Young)', () => {
    const p = COA.buildPathBProposal({ ...base, owner_name: 'Avison Young', tie_kind: 'active_contact',
      correspondent_name: 'Keith Kropfl', correspondent_email: 'keith.kropfl@avisonyoung.com' });
    assert.equal(p, null);
    assert.equal(COA.pathBDropReason({ correspondent_email: 'keith.kropfl@avisonyoung.com', owner_name: 'Avison Young' }), 'brokerage_target');
  });
  it('a genuine owner-LLC active_contact still passes (Metro Group Finance)', () => {
    const p = COA.buildPathBProposal({ ...base, owner_name: 'Metro Group Finance', tie_kind: 'active_contact',
      correspondent_name: 'Patrick Ward', correspondent_email: 'pward@metrogroupfinance.com' });
    assert.ok(p);
    assert.equal(p.tie_kind, 'active_contact');
    assert.equal(p.correspondent_email, 'pward@metrogroupfinance.com');
    assert.equal(COA.pathBDropReason(p), null);
  });
  it('a genuine owner-LLC relationship (Boyd Watterson) survives with verbatim evidence', () => {
    const p = COA.buildPathBProposal({ ...base, correspondent_name: 'Joseph Capra',
      correspondent_email: 'jcapra@boydwatterson.com' });
    assert.ok(p);
    assert.equal(p.evidence_quote, 'Joseph Capra <jcapra@boydwatterson.com>');
  });
});

describe('commsHeaderEvidence', () => {
  it('formats Name <email>, email-only, or name-only', () => {
    assert.equal(COA.commsHeaderEvidence('Jane Roe', 'jane@x.com'), 'Jane Roe <jane@x.com>');
    assert.equal(COA.commsHeaderEvidence(null, 'jane@x.com'), 'jane@x.com');
    assert.equal(COA.commsHeaderEvidence('Jane Roe', 'not-an-email'), 'Jane Roe');
    assert.equal(COA.commsHeaderEvidence('', ''), '');
  });
});
