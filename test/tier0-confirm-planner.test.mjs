// test/tier0-confirm-planner.test.mjs
// ============================================================================
// P188 — the Tier 0 confirm lane's card + verdict model.
//
// Every case below is a NAMED LIVE ROW from the 2026-08-26 bench with a stated
// expected answer. CLAUDE.md's rule: "Verify on NAMED rows with stated expected
// answers, never on an aggregate" — an aggregate here would happily report 95%
// while the one row that matters (georgesinc.com) sailed through.
// ============================================================================

import { test as it, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTier0Card, classifyTier0Person, collapseDuplicatePeople, evidenceSummary,
  isRoleOrFormLabelName, rentBand, tier0SubjectRef, validateTier0Verdict,
  RENT_BAND_HIGH_FLOOR, RENT_BAND_LOW_CEIL,
} from '../api/_shared/tier0-confirm-planner.js';

const person = (over) => Object.assign({
  person_id: '00000000-0000-0000-0000-000000000001',
  person_name: 'Eric Dowling',
  email: 'edowling@boydwatterson.com',
  title: null, company: null, role_bucket: 'no_title',
  match_arm: 'core8', match_key: 'boydwatt',
  eligible: true, block_reason: null,
  already_linked: false, from_outlook_sync: false,
  campaign_names: [],
  evidence: {
    sf_campaign: false, sf_contact: false, outlook: false, correspondence: false,
    company_confirms_employer: false, company_matches_owner: false,
  },
}, over || {});

const row = (over) => Object.assign({
  owner_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  owner_name: 'Boyd Watterson Asset Management, LLC',
  owner_rent: 179800482,
  domain: 'boydwatterson.com',
  owner_workspace_id: 'wwwwwwww-0000-0000-0000-000000000001',
  match_arms: 'core8', match_keys: ['boydwatt'],
  n_candidates: 2, owner_domain_cards: 1, rank_value: 179800482,
  people: [person()],
}, over || {});

describe('P188 Tier 0 confirm planner', () => {
  describe('rent bands — the measured precision curve, with its anchors', () => {
    it('Boyd Watterson ($179.8M) is in the DIRECTLY MEASURED top band', () => {
      const b = rentBand(179800482);
      assert.equal(b.band, 'measured_high');
      assert.equal(b.measured, true);
      assert.equal(b.precision, '~91%');
    });

    it('the mid band carries NO precision number — it was never graded', () => {
      // The 45th pair by rent sat at $16.38M, so "~91% on the top 45" reaches
      // roughly $16M and no further. Interpolating a number into the $2M-$16M
      // gap would be exactly the "quote one figure without its rent band"
      // mistake P187 warned about.
      const b = rentBand(9000000);
      assert.equal(b.band, 'unmeasured_mid');
      assert.equal(b.measured, false);
      assert.equal(b.precision, null);
      assert.match(b.note, /never graded/i);
    });

    it('the SPE band reports the measured ~60-70%, not the headline', () => {
      const b = rentBand(873186);            // "Southern SSA Limited Liability Company", live
      assert.equal(b.band, 'measured_low');
      assert.equal(b.precision, '~60–70%');
    });

    it('the band floors are the measured anchors, not round numbers picked for looks', () => {
      assert.equal(RENT_BAND_HIGH_FLOOR, 16000000);
      assert.equal(RENT_BAND_LOW_CEIL, 2000000);
    });
  });

  describe('person eligibility — the shape gate', () => {
    it('accepts the real people the bench exists to surface', () => {
      for (const n of ['Eric Dowling', 'Adam D. Portnoy', 'Sumit Roy', 'Andrew Pulliam',
        'Mitchell Freeman', 'Aaron Thielhorn', 'Kathy Eberly Ovitt', 'Wes N. Dingler']) {
        assert.equal(classifyTier0Person(person({ person_name: n })).eligible, true, n);
      }
    });

    it('BLOCKS the four live names that survived every shared guard', () => {
      // Measured on the 2026-08-26 bench: the shared guards (hasOrgMarker,
      // looksLikePersonName, lcc_looks_like_person) catch "Equity Funds",
      // "Managing Partner" and "Public"; these four got through all of them.
      const cases = {
        'Tenants In Common': 'role_or_legal_form_label',
        'Inco Commercial': 'role_or_legal_form_label',
        'Stephen Block Deceased': 'role_or_legal_form_label',
        'Authorized Signer': 'role_or_legal_form_label',
      };
      for (const [name, reason] of Object.entries(cases)) {
        const cls = classifyTier0Person(person({ person_name: name }));
        assert.equal(cls.eligible, false, name);
        assert.equal(cls.block_reason, reason, name);
      }
    });

    it('the narrow stoplist does NOT over-fire on ordinary names', () => {
      // The obvious widening is the destructive one (P158a). These are all real
      // bench names that a "sounds corporate / sounds like a role" rule would eat.
      for (const n of ['Gregory Politis', 'Frank Parker', 'Bill Forrest', 'Mark Harvey',
        'Avery Clark', 'Miller Heath', 'West Winter', 'Wise Smith', 'Ware Smalley',
        'Steve Freeman', 'George Franco', 'Gary George']) {
        assert.equal(isRoleOrFormLabelName(n), false, n);
      }
    });

    it('a broker is excluded OUTRIGHT — at any deal size', () => {
      const cls = classifyTier0Person(person({ role_bucket: 'broker', person_name: 'Bob Safai' }));
      assert.equal(cls.eligible, false);
      assert.equal(cls.block_reason, 'broker_role');
    });

    it('honours the SQL view\'s own block_reason rather than second-guessing it', () => {
      const cls = classifyTier0Person(person({ eligible: false, block_reason: 'rejected_contact_name' }));
      assert.equal(cls.eligible, false);
      assert.equal(cls.block_reason, 'rejected_contact_name');
    });

    it('a person with no email cannot be attached — there is nothing to reach', () => {
      assert.equal(classifyTier0Person(person({ email: '' })).block_reason, 'no_email');
    });
  });

  describe('evidence — labelling what it actually proves', () => {
    it('Gary George at georgesinc.com: PERSON evidence only, and says so', () => {
      // The single most important row in this lane. George's Inc is a poultry
      // company; he does not work for George Washington University. He carries
      // Salesforce campaign membership, a Salesforce contact record, and a
      // company name that corroborates his own email domain — three signals,
      // none of which says anything about the owner.
      const ev = evidenceSummary(person({
        person_name: 'Gary George', email: 'gary.george@georgesinc.com', company: "George's Inc",
        evidence: {
          sf_campaign: true, sf_contact: true, outlook: false, correspondence: false,
          company_confirms_employer: true, company_matches_owner: false,
        },
      }));
      assert.equal(ev.attests, 'person_only');
      assert.equal(ev.link_evidence.length, 0);
      assert.equal(ev.person_evidence.length, 3);
      assert.match(ev.caveat, /does NOT show they work for this owner/);
    });

    it('Mitchell Freeman at Elman Investors: LINK evidence, no caveat', () => {
      const ev = evidenceSummary(person({
        person_name: 'Mitchell Freeman', email: 'mfreeman@elmaninvestorsinc.com',
        company: 'Elman Investors Inc',
        evidence: {
          sf_campaign: false, sf_contact: true, outlook: false, correspondence: false,
          company_confirms_employer: true, company_matches_owner: true,
        },
      }));
      assert.equal(ev.attests, 'link_and_person');
      assert.deepEqual(ev.link_evidence, ['company_matches_owner']);
      assert.equal(ev.caveat, null);
    });

    it('company_confirms_employer is NEVER counted as link evidence', () => {
      // These are two different claims and collapsing them is how georgesinc.com
      // came back green in the P186 §5 measurement.
      const ev = evidenceSummary(person({
        evidence: { sf_campaign: false, sf_contact: false, outlook: false, correspondence: false,
          company_confirms_employer: true, company_matches_owner: false },
      }));
      assert.equal(ev.link_evidence.length, 0);
      assert.ok(ev.person_evidence.includes('company_confirms_employer'));
    });
  });

  describe('duplicate person entities — a RANKED rule, never first-row-wins', () => {
    it('Andrew Pulliam ×2 at one email collapses to ONE, alternates recorded', () => {
      const a = person({ person_id: 'p-a', person_name: 'Andrew Pulliam',
        email: 'apulliam@easterlyreit.com', company: null });
      const b = person({ person_id: 'p-b', person_name: 'Andrew Pulliam',
        email: 'APulliam@easterlyreit.com', company: 'Easterly Partners',
        evidence: { ...a.evidence, company_matches_owner: true } });
      const out = collapseDuplicatePeople([a, b]);
      assert.equal(out.length, 1);
      // b wins on LINK evidence, which is rank step 1 — not on array position.
      assert.equal(out[0].person_id, 'p-b');
      assert.deepEqual(out[0].duplicate_person_ids, ['p-a']);
    });

    it('the rule is deterministic regardless of input order', () => {
      const a = person({ person_id: 'p-a' });
      const b = person({ person_id: 'p-b' });
      assert.equal(collapseDuplicatePeople([a, b])[0].person_id, 'p-a');
      assert.equal(collapseDuplicatePeople([b, a])[0].person_id, 'p-a');
    });

    it('different people at the same domain are NOT collapsed', () => {
      const out = collapseDuplicatePeople([
        person({ person_id: 'p-1', email: 'aportnoy@rmrgroup.com' }),
        person({ person_id: 'p-2', email: 'yduffy@rmrgroup.com' }),
      ]);
      assert.equal(out.length, 2);
    });
  });

  describe('the card', () => {
    it('subject_ref is (owner, DOMAIN) — rejecting one domain leaves the other open', () => {
      const owner = 'aaaaaaaa-0000-0000-0000-000000000009';
      assert.notEqual(tier0SubjectRef(owner, 'rmrgroup.com'), tier0SubjectRef(owner, 'rmrgroupinc.com'));
      assert.equal(tier0SubjectRef(owner, 'RMRGroup.com'), 't0:' + owner + ':rmrgroup.com');
      assert.equal(tier0SubjectRef(owner, ''), null);
    });

    it('RMR: 19 people at one domain is ONE card, and the picker carries all of them', () => {
      const names = ['Adam D. Portnoy', 'Yael Duffy', 'Jesse Archambault', 'George Franco',
        'Alla Defosses', 'Will Bray', 'Matthew Luft', 'Marie Rotier', 'Jennifer Francis',
        'Jenkin Cagwin', 'Daniel McSoley', 'Andrew Piccirillo', 'Jennifer Civetti',
        'Dustin Nazarian', 'Scott Higgins', 'Gregory Curtiss', 'Chad Bojanowski',
        'Chris Bilotto', 'Jamesq Moore'];
      const people = names.map((n, k) => person({
        person_id: 'rmr-' + k, person_name: n, email: 'p' + k + '@rmrgroup.com',
      }));
      const card = buildTier0Card(row({ owner_name: 'RMR Group', owner_rent: 16383565,
        domain: 'rmrgroup.com', people, owner_domain_cards: 2 }));
      assert.equal(card.n_eligible, 19);
      assert.equal(card.owner_domain_cards, 2);
    });

    it('says plainly when NOTHING but the domain match supports the card', () => {
      const card = buildTier0Card(row({
        owner_name: 'George Washington University', owner_rent: 23823414,
        domain: 'georgesinc.com', match_arms: 'token', match_keys: ['george'],
        people: [person({ person_name: 'Gary George', email: 'gary.george@georgesinc.com',
          company: "George's Inc",
          evidence: { sf_campaign: true, sf_contact: true, outlook: false, correspondence: false,
            company_confirms_employer: true, company_matches_owner: false } })],
      }));
      assert.equal(card.n_link_evidence, 0);
      assert.equal(card.n_person_evidence, 1);
      assert.match(card.evidence_headline, /No candidate’s employer is on file as this owner/);
      // The match key is what makes this an obvious reject.
      assert.deepEqual(card.match_keys, ['george']);
    });

    it('an excluded broker stays ON the card, counted, not silently dropped', () => {
      const card = buildTier0Card(row({ people: [
        person({ person_id: 'p-ok' }),
        person({ person_id: 'p-broker', person_name: 'Bob Safai', role_bucket: 'broker' }),
      ] }));
      assert.equal(card.n_eligible, 1);
      assert.equal(card.n_excluded, 1);
      assert.equal(card.excluded_people[0].block_reason, 'broker_role');
    });

    it('orders link-evidence first, then acquisitions/principal — the pursuit target', () => {
      const card = buildTier0Card(row({ people: [
        person({ person_id: 'p-none', person_name: 'Zed Nobody' }),
        // NOTE the name is an ordinary person name: 'Ann Acquisitions' would be
        // blocked by hasOrgMarker, which is correct and not what this asserts.
        person({ person_id: 'p-acq', person_name: 'Ann Kessler', role_bucket: 'acquisitions',
          email: 'ann@boydwatterson.com' }),
        person({ person_id: 'p-link', person_name: 'Lee Linked', email: 'lee@boydwatterson.com',
          evidence: { sf_campaign: false, sf_contact: false, outlook: false, correspondence: false,
            company_confirms_employer: false, company_matches_owner: true } }),
      ] }));
      assert.deepEqual(card.people.map((p) => p.person_id), ['p-link', 'p-acq', 'p-none']);
    });
  });

  describe('the verdict gate — the server\'s last line before a write', () => {
    const card = buildTier0Card(row({ people: [
      person({ person_id: 'p-ok' }),
      person({ person_id: 'p-broker', person_name: 'Bob Safai', role_bucket: 'broker' }),
    ] }));

    it('attach REQUIRES a chosen person', () => {
      const g = validateTier0Verdict(card, 'attach', {});
      assert.equal(g.ok, false);
      assert.equal(g.error, 'attach_requires_person_entity_id');
    });

    it('attach REFUSES a person that is not on the card', () => {
      const g = validateTier0Verdict(card, 'attach', { person_entity_id: 'p-somewhere-else' });
      assert.equal(g.ok, false);
      assert.equal(g.error, 'person_not_on_card');
    });

    it('attach REFUSES the broker even though the request names them', () => {
      // The broker never reaches card.people, so this is caught as
      // person_not_on_card — the gate is closed at the earliest point.
      const g = validateTier0Verdict(card, 'attach', { person_entity_id: 'p-broker' });
      assert.equal(g.ok, false);
      assert.equal(g.error, 'person_not_on_card');
    });

    it('attach REFUSES a person the shape gate rejects at WRITE time', () => {
      // A card rendered before a rename must not carry its assumptions into the
      // write. Here the card was built with a valid name and the row is
      // re-classified as ineligible at verdict time.
      const stale = { ...card, people: [{ ...card.people[0], person_name: 'Tenants In Common' }] };
      const g = validateTier0Verdict(stale, 'attach', { person_entity_id: 'p-ok' });
      assert.equal(g.ok, false);
      assert.equal(g.error, 'person_not_eligible:role_or_legal_form_label');
    });

    it('attach ACCEPTS a valid pick and returns the person', () => {
      const g = validateTier0Verdict(card, 'attach', { person_entity_id: 'p-ok' });
      assert.equal(g.ok, true);
      assert.equal(g.verdict, 'attach');
      assert.equal(g.person.person_id, 'p-ok');
    });

    it('reject and research need no person', () => {
      for (const v of ['reject', 'research']) {
        const g = validateTier0Verdict(card, v, {});
        assert.equal(g.ok, true, v);
        assert.equal(g.verdict, v);
        assert.equal(g.person, null);
      }
    });

    it('a bare "confirm" canonicalizes to attach — and still needs the person', () => {
      assert.equal(validateTier0Verdict(card, 'confirm', {}).error, 'attach_requires_person_entity_id');
      assert.equal(validateTier0Verdict(card, 'confirm', { person_entity_id: 'p-ok' }).verdict, 'attach');
    });

    it('an unknown verdict is refused, never coerced', () => {
      const g = validateTier0Verdict(card, 'merge', {});
      assert.equal(g.ok, false);
      assert.match(g.error, /^unknown_verdict:/);
    });
  });
});
