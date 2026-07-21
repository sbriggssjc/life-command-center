// Contact→company-link tests.
//
// 1. planCompanyLink — the auto-apply guard (person/junk guards + edge shape).
// 2. aggressiveCompanyCore — the JS mirror of the SQL 2-arg
//    lcc_normalize_entity_name(name, true). The expected values are GROUND-TRUTH
//    captured live from the SQL function (LCC Opps, 2026-07-21) so the SQL view
//    and the JS resolver can never drift.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCompanyLink, LINK_ROLE, DEFAULT_BATCH_TAG, VIA_PREFIX,
  aggressiveCompanyCore, coreMatches,
} from '../api/_shared/contacts-company-link.js';

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
  auto_appliable: true,
};

describe('planCompanyLink — the auto-apply guard', () => {
  it('applies a clean person -> owner-org edge (owner is entityId, person is contactEntityId)', () => {
    const r = planCompanyLink(base);
    assert.equal(r.action, 'apply');
    assert.equal(r.edge.entityId, 'own-1');          // the owner org "has" the contact
    assert.equal(r.edge.contactEntityId, 'p-1');     // the person
    assert.equal(r.edge.workspaceId, 'ws-1');
    assert.equal(r.edge.role, LINK_ROLE);
    assert.equal(r.edge.via, VIA_PREFIX + DEFAULT_BATCH_TAG);
    assert.equal(r.edge.via, 'contact_company_link:' + DEFAULT_BATCH_TAG);
  });

  it('honors a custom batch tag in the edge via', () => {
    const r = planCompanyLink(base, { batchTag: 'reapply_x' });
    assert.equal(r.edge.via, 'contact_company_link:reapply_x');
  });

  it('skips an incomplete row (missing owner or person)', () => {
    assert.equal(planCompanyLink({ ...base, owner_org_id: null }).action, 'skip');
    assert.equal(planCompanyLink({ ...base, owner_org_id: null }).reason, 'incomplete_row');
    assert.equal(planCompanyLink({ ...base, person_entity_id: null }).action, 'skip');
  });

  it('skips an implausible person name (the deal-string guard)', () => {
    const r = planCompanyLink({ ...base, person_name: 'Boyd Watterson by NAI Capital' });
    assert.equal(r.action, 'skip');
    assert.equal(r.reason, 'implausible_person');
  });

  it('skips a non-human "person" name (a city / a sentence) via looksLikePersonName', () => {
    assert.equal(planCompanyLink({ ...base, person_name: 'Cincinnati, OH 45219' }).reason, 'not_a_person_name');
    assert.equal(planCompanyLink({ ...base, person_name: 'This property was on the market for 172 days.' }).reason, 'not_a_person_name');
    assert.equal(planCompanyLink({ ...base, person_name: 'Amy Truong-Ho' }).action, 'apply');
  });

  it('skips a junk owner-org name (the org-safe junk guard) but KEEPS a legit LLC', () => {
    const junk = planCompanyLink({ ...base, owner_org_name: 'Seller ContactsCraig Burrows(916) 768-5544 (p)' });
    assert.equal(junk.action, 'skip');
    assert.equal(junk.reason, 'junk_owner_name');
    assert.equal(planCompanyLink({ ...base, owner_org_name: 'Palestra Real Estate Partners LP' }).action, 'apply');
  });

  it('guard deps are injectable (custom isJunk / isImplausible)', () => {
    const r = planCompanyLink(base, { isImplausible: () => true });
    assert.equal(r.action, 'skip');
    assert.equal(r.reason, 'implausible_person');
  });
});

describe('aggressiveCompanyCore — the descriptor-core normalizer (SQL↔JS parity)', () => {
  // GROUND-TRUTH from public.lcc_normalize_entity_name(name, true) on LCC Opps.
  const SQL_GROUND_TRUTH = {
    '': '',
    '| leading pipe': '',
    'AT&T Inc': 'att',
    'Blake Real Estate': 'blake',
    'Blake Real Estate Inc': 'blake',
    'Cambridge Holdings LLC': 'cambridge',
    'Capital': 'capital',
    'Claremont Group Llc | Brewran Islip': 'claremont',
    'EMR Land Co (formerly Elk Mountain Ranch)': 'emrland',
    'Global Medical REIT Inc': 'globalmedicalreit',
    'HC Government Realty Trust Inc': 'hcgovernment',
    'Kingsbarn Realty Capital': 'kingsbarn',
    'Merlin Management Company | Northwind Development LLC': 'merlin',
    'Procacci Development Corporation (PDC)': 'procacci',
    'SAZ-Ram': 'sazram',
    'Starwood Capital Group LLC': 'starwood',
    "SVEA Real Estate Group | Sotheby's International": 'svea',
    'The Claremont Group': 'claremont',
    'The Group LLC': 'group',
    'The Shooshan Co LLC': 'shooshan',
    'The SMARTCAP Group, Inc.': 'smartcap',
    'True North Management': 'truenorth',
    'Wayne Jones LLC': 'waynejones',
    'Xenia Management Corp': 'xenia',
  };

  it('the JS mirror matches the SQL function on every fixture (no drift)', () => {
    for (const [name, expected] of Object.entries(SQL_GROUND_TRUTH)) {
      assert.equal(aggressiveCompanyCore(name), expected, 'core drift on ' + JSON.stringify(name));
    }
  });

  it('the descriptor strip is ITERATIVE (a single-pass would stall on "claremont group")', () => {
    // A trailing-only single pass would leave "claremontgroup"; the loop reaches "claremont".
    assert.equal(aggressiveCompanyCore('Claremont Group Llc'), 'claremont');
    assert.equal(aggressiveCompanyCore('Kingsbarn Realty Capital'), 'kingsbarn'); // two trailing tokens
  });

  it('null / non-string is safe ("")', () => {
    assert.equal(aggressiveCompanyCore(null), '');
    assert.equal(aggressiveCompanyCore(undefined), '');
  });

  it('coreMatches gates on shared core >= 4 chars', () => {
    assert.equal(coreMatches('Blake Real Estate', 'Blake Real Estate Inc'), true);   // same firm
    assert.equal(coreMatches('The Claremont Group', 'Claremont Group Llc | X'), true); // same firm
    assert.equal(coreMatches('Starwood Property Trust', 'Starwood Capital Group'), false); // diff cores
    assert.equal(coreMatches('AB Co', 'AB Inc'), false);   // core "ab" < 4 chars
  });
});
