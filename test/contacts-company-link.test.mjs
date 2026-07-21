// Phase 1b — contacts-company-link planner tests.
//
// Covers the pure planCompanyLink decision (the auto-apply guard) — the SQL view
// does the matching (exact_unique / exact_ambiguous / fuzzy), this planner only
// decides whether an exact_unique row is safe to auto-link and shapes the edge.
// No I/O.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planCompanyLink, LINK_ROLE, DEFAULT_BATCH_TAG } from '../api/_shared/contacts-company-link.js';

const base = {
  unified_id: 'uc-1',
  person_entity_id: 'p-1',
  person_name: 'Jane Q. Roe',
  company_name: 'Starwood Capital Group LLC',
  match_class: 'exact_unique',
  n_candidate_orgs: 1,
  owner_org_id: 'own-1',
  owner_org_name: 'Starwood Capital Group LLC',
  workspace_id: 'ws-1',
  rank_value: 5000000,
};

describe('planCompanyLink — the exact_unique auto-apply guard', () => {
  it('applies a clean person -> owner-org edge (owner is entityId, person is contactEntityId)', () => {
    const r = planCompanyLink(base);
    assert.equal(r.action, 'apply');
    assert.equal(r.edge.entityId, 'own-1');          // the owner org "has" the contact
    assert.equal(r.edge.contactEntityId, 'p-1');     // the person
    assert.equal(r.edge.workspaceId, 'ws-1');
    assert.equal(r.edge.role, LINK_ROLE);
    assert.equal(r.edge.via, 'contacts_phase1b:' + DEFAULT_BATCH_TAG);
  });

  it('honors a custom batch tag in the edge via', () => {
    const r = planCompanyLink(base, { batchTag: 'reapply_x' });
    assert.equal(r.edge.via, 'contacts_phase1b:reapply_x');
  });

  it('skips an incomplete row (missing owner or person)', () => {
    assert.equal(planCompanyLink({ ...base, owner_org_id: null }).action, 'skip');
    assert.equal(planCompanyLink({ ...base, owner_org_id: null }).reason, 'incomplete_row');
    assert.equal(planCompanyLink({ ...base, person_entity_id: null }).action, 'skip');
  });

  it('skips an implausible person name (the deal-string guard)', () => {
    // isImplausiblePersonName rejects deal/attribution strings, $ amounts, firm suffixes.
    const r = planCompanyLink({ ...base, person_name: 'Boyd Watterson by NAI Capital' });
    assert.equal(r.action, 'skip');
    assert.equal(r.reason, 'implausible_person');
  });

  it('skips a non-human "person" name (a city / a sentence) via looksLikePersonName', () => {
    // The round links owners to PEOPLE — a junk-named person entity would make the
    // owner LOOK reachable and hide its real acquisition need.
    assert.equal(planCompanyLink({ ...base, person_name: 'Cincinnati, OH 45219' }).reason, 'not_a_person_name');
    assert.equal(planCompanyLink({ ...base, person_name: 'This property was on the market for 172 days.' }).reason, 'not_a_person_name');
    // A real hyphenated human name still passes.
    assert.equal(planCompanyLink({ ...base, person_name: 'Amy Truong-Ho' }).action, 'apply');
  });

  it('skips a junk owner-org name (the org-safe junk guard) but KEEPS a legit LLC', () => {
    // isJunkEntityName rejects embedded phone/email / panel-header bleed, NOT firm suffixes.
    const junk = planCompanyLink({ ...base, owner_org_name: 'Seller ContactsCraig Burrows(916) 768-5544 (p)' });
    assert.equal(junk.action, 'skip');
    assert.equal(junk.reason, 'junk_owner_name');
    // A normal LLC owner name must pass (never false-positived as junk).
    assert.equal(planCompanyLink({ ...base, owner_org_name: 'Palestra Real Estate Partners LP' }).action, 'apply');
  });

  it('guard deps are injectable (custom isJunk / isImplausible)', () => {
    const r = planCompanyLink(base, { isImplausible: () => true });
    assert.equal(r.action, 'skip');
    assert.equal(r.reason, 'implausible_person');
  });
});
