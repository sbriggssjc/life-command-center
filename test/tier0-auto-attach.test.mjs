// test/tier0-auto-attach.test.mjs
// ============================================================================
// P194 — the Tier 0 auto-attach sweep (prompt 192 §1).
//
// Every case is a NAMED LIVE ROW from the 2026-08-26 lane with a stated expected
// answer, per CLAUDE.md's rule that an aggregate would happily read 95% while the
// one row that matters sailed through. The rows below are the real `auto`
// population (read 9/9 correct) and the real near-misses that must NOT be swept:
// JP Morgan Chase CMBS Trust and Frontier Hub LLC.
// ============================================================================

import { test as it, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  planTier0AutoAttach, buildTier0Card, validateTier0Verdict,
  TIER0_AUTO_DECIDABILITY, TIER0_AUTO_MATCH_STRENGTH,
} from '../api/_shared/tier0-confirm-planner.js';
import {
  tier0ContactRole, tier0BatchTag, TIER0_SOURCE_AUTO, TIER0_SOURCE_CONFIRM,
  TIER0_LANE_SOURCES,
} from '../api/_shared/tier0-attach-effect.js';

const person = (over) => Object.assign({
  person_id: '00000000-0000-0000-0000-0000000000a1',
  person_name: 'Deke Hunter',
  email: 'deke@hunterproperties.com',
  title: null, company: null, role_bucket: 'no_title',
  match_arm: 'core8', match_key: 'hunterpr',
  eligible: true, block_reason: null,
  already_linked: false, from_outlook_sync: false, campaign_names: [],
  evidence: {
    sf_campaign: false, sf_contact: false, outlook: false, correspondence: false,
    company_confirms_employer: false, company_matches_owner: true,
  },
}, over || {});

/** A live `auto` row: exact match, one eligible candidate. */
const autoRow = (over) => Object.assign({
  owner_id: '00000000-0000-0000-0000-0000000000b1',
  owner_name: 'Hunter Properties',
  owner_rent: 1288251,
  domain: 'hunterproperties.com',
  n_candidates: 1, n_eligible: 1, n_excluded: 0,
  n_link_evidence: 1, n_person_evidence: 0,
  match_arms: 'core8+token', match_keys: ['hunterpr'],
  owner_domain_cards: 2,
  match_strength: 'exact', decidability: 'auto',
  people: [person()],
}, over || {});

describe('P194 planTier0AutoAttach — the sweep population', () => {
  it('accepts the live auto rows, and names the person it would attach', () => {
    // All nine read individually on 2026-08-26; three spot-checked here.
    const live = [
      ['Hunter Properties', 'hunterproperties.com', 'Deke Hunter', 'deke@hunterproperties.com'],
      ['Paolino Properties', 'paolinoproperties.com', 'Joseph Paolino', 'jrpjr@paolinoproperties.com'],
      ['Healthcare Realty Trust', 'healthcarerealty.com', 'John Bryant', 'jbryant@healthcarerealty.com'],
    ];
    for (const [ownerName, domain, pname, pemail] of live) {
      const plan = planTier0AutoAttach(autoRow({
        owner_name: ownerName, domain,
        people: [person({ person_name: pname, email: pemail })],
      }));
      assert.equal(plan.eligible, true, ownerName);
      assert.equal(plan.reason, 'exact_single_candidate');
      assert.equal(plan.person.person_name, pname);
    }
  });

  // ⚠️ THE WHOLE POINT OF THE GATE. One tier of match strength separates 11/11
  // from ~9/12, and the 9/12's failures are severe.
  it('REFUSES domain_is_core_prefix — JP Morgan CMBS Trust and Frontier Hub', () => {
    const jpm = planTier0AutoAttach(autoRow({
      owner_name: 'JP Morgan Chase Commercial Mortgage Securities Trust 2018PTC',
      domain: 'jpmorgan.com',
      match_strength: 'domain_is_core_prefix', decidability: 'ask',
      people: [person({ person_name: 'A Banker', email: 'a@jpmorgan.com' })],
    }));
    assert.equal(jpm.eligible, false);
    assert.match(jpm.reason, /^not_auto_decidability/);

    // Even if a future view change marked it `auto`, the match_strength arm holds.
    const frontier = planTier0AutoAttach(autoRow({
      owner_name: 'Frontier Hub LLC', domain: 'frontier.net',
      match_strength: 'domain_is_core_prefix', decidability: 'auto',
      people: [person({ person_name: 'Some Person', email: 's@frontier.net' })],
    }));
    assert.equal(frontier.eligible, false);
    assert.equal(frontier.reason, 'not_exact_match:domain_is_core_prefix');
  });

  it('refuses a multi-candidate exact match — the person choice is a real decision', () => {
    const plan = planTier0AutoAttach(autoRow({
      n_eligible: 2,
      people: [person(), person({ person_id: 'x2', person_name: 'Ann Hunter', email: 'ann@hunterproperties.com' })],
    }));
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'not_single_candidate:2');
  });

  // The SQL n_eligible and the JS shape gate legitimately disagree; when the one
  // SQL-eligible candidate fails the JS guards there is nothing to attach.
  it('refuses when the JS shape gate removes the only candidate', () => {
    const plan = planTier0AutoAttach(autoRow({
      people: [person({ person_name: 'Tenants In Common', email: 'x@hunterproperties.com' })],
    }));
    assert.equal(plan.eligible, false);
    assert.match(plan.reason, /js_gate_left_0_candidates|person_not_eligible/);
  });

  it('refuses a broker outright at any deal size', () => {
    const plan = planTier0AutoAttach(autoRow({
      owner_rent: 90000000,
      people: [person({ role_bucket: 'broker' })],
    }));
    assert.equal(plan.eligible, false);
  });

  // Defensive: the view guarantees this today. Asserting it means a future join
  // change cannot quietly attach a person from a different firm's domain.
  it('refuses when the candidate email domain is not the card domain', () => {
    const plan = planTier0AutoAttach(autoRow({
      people: [person({ email: 'deke@someotherfirm.com' })],
    }));
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'person_domain_mismatch:someotherfirm.com');
  });

  it('every skip NAMES itself — a silent filter is indistinguishable from a bug', () => {
    for (const row of [
      autoRow({ decidability: 'parked_domain_only' }),
      autoRow({ match_strength: 'weak_partial' }),
      autoRow({ n_eligible: 0, people: [] }),
    ]) {
      const plan = planTier0AutoAttach(row);
      assert.equal(plan.eligible, false);
      assert.ok(plan.reason && plan.reason.length > 3, 'reason must be populated');
    }
  });

  it('is PURE — the same row twice gives the same answer and mutates nothing', () => {
    const r = autoRow();
    const before = JSON.stringify(r);
    const a = planTier0AutoAttach(r);
    const b = planTier0AutoAttach(r);
    assert.equal(JSON.stringify(r), before);
    assert.equal(a.eligible, b.eligible);
    assert.equal(a.person.person_id, b.person.person_id);
  });
});

describe('P194 — the grade and the write cannot disagree', () => {
  // The P140 rule: what Scott reads in the GET dry-run must be exactly what the
  // POST writes, or the flag is being flipped on evidence about something else.
  it('a planned row also passes the human verdict gate with the same person', () => {
    const row = autoRow();
    const plan = planTier0AutoAttach(row);
    assert.equal(plan.eligible, true);
    const gate = validateTier0Verdict(plan.card, 'attach',
      { person_entity_id: plan.person.person_id });
    assert.equal(gate.ok, true);
    assert.equal(gate.person.person_id, plan.person.person_id);
  });

  it('a REJECTED row is also refused by the verdict gate', () => {
    const row = autoRow({ people: [person({ role_bucket: 'broker' })] });
    const card = buildTier0Card(row);
    const plan = planTier0AutoAttach(row, card);
    assert.equal(plan.eligible, false);
    // Nothing eligible on the card, so an attach naming that person is refused.
    const gate = validateTier0Verdict(card, 'attach',
      { person_entity_id: '00000000-0000-0000-0000-0000000000a1' });
    assert.equal(gate.ok, false);
  });

  it('the tick calls the planner for BOTH the dry run and the write', () => {
    const src = readFileSync(new URL('../api/_handlers/tier0-auto-attach-tick.js', import.meta.url), 'utf8');
    const calls = src.match(/planTier0AutoAttach\(/g) || [];
    assert.ok(calls.length >= 2,
      'the dry-run listing and the write loop must both go through planTier0AutoAttach');
    // And the write path must re-read before it writes — a scan result is stale
    // by definition, and a proposal is never an authorisation.
    assert.ok(/reReadRow\(/.test(src), 'the write path must re-read the card');
    assert.ok(/validateTier0Verdict\(/.test(src), 'the write path must re-run the human verdict gate');
  });
});

describe('P194 attach-effect — one writer, two callers', () => {
  it('the auto source is distinguishable from a human verdict, forever', () => {
    assert.notEqual(TIER0_SOURCE_AUTO, TIER0_SOURCE_CONFIRM);
    assert.ok(tier0BatchTag(TIER0_SOURCE_AUTO, '2026-08-26T00:00:00Z').startsWith('t0auto_'));
    assert.ok(tier0BatchTag(TIER0_SOURCE_CONFIRM, '2026-08-26T00:00:00Z').startsWith('t0cl_'));
  });

  // ⚠️ The trap P194 caught before shipping: the lane view excluded owners whose
  // pivot source was `<> 'tier0_confirm'`, so 'tier0_auto' read as an OUTSIDE
  // source and would have hidden the same owner's other open cards. Measured:
  // 3 of 9 auto owners hold a second card, two of them live `ask` questions.
  it('BOTH lane sources are in the set the lane view exempts', () => {
    assert.deepEqual([...TIER0_LANE_SOURCES].sort(), ['tier0_auto', 'tier0_confirm']);
    const mig = readFileSync(
      new URL('../supabase/migrations/20260827090000_lcc_p194_tier0_auto_attach_and_park_watch.sql', import.meta.url),
      'utf8');
    // ⚠️ Strip `--` comments BEFORE asserting. The migration header deliberately
    // QUOTES the old `<> 'tier0_confirm'` predicate to explain the trap, so a
    // naive negative grep over the raw file matches the prose and reports a
    // breach that does not exist — the block-slice footgun, caught by this very
    // test on its first run. Anchor on the SQL, never on the file.
    const sql = mig.replace(/--[^\n]*/g, '');
    assert.ok(/not in \('tier0_confirm','tier0_auto'\)/.test(sql),
      'the lane view must exempt BOTH lane sources, or an auto attach hides the owner’s other cards');
    assert.ok(!/<>\s*'tier0_confirm'/.test(sql),
      'the single-literal inequality must be gone from the SQL — a new source silently changes its meaning');
  });

  it('the role is never promoted from a job title', () => {
    // authority_level 5 means "captured"; "President" in a CRM field does not
    // establish legal or control authority. The bucket rides in the ROLE field.
    assert.equal(tier0ContactRole({ role_bucket: 'acquisitions' }), 'acquisitions');
    assert.equal(tier0ContactRole({ role_bucket: 'no_title' }), 'prospecting_contact');
    assert.equal(tier0ContactRole({}), 'prospecting_contact');
  });

  it('admin.js writes through the shared effect, not a second copy', () => {
    const admin = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
    assert.ok(/applyTier0Attach\(/.test(admin),
      'the human verdict must call the shared effect');
    // The tier0 block must not carry its own pivot write any more — two writers
    // of owner_contact_pivot.active_contact_entity_id is the drift this repo
    // documents in a dozen places.
    const block = admin.slice(
      admin.indexOf("decision.decision_type === 'tier0_owner_contact'"),
      admin.indexOf("return res.status(400).json({ error: 'unsupported_decision_type'"));
    assert.ok(block.length > 500, 'tier0 verdict block not located');
    assert.ok(!/owner_contact_pivot\?entity_id=eq\./.test(block),
      'the tier0 verdict block must not PATCH owner_contact_pivot directly');
  });
});
