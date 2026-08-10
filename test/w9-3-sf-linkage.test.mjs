// W9.3 (Prompt 90) — SF linkage drain + live re-score. Unit tests for the three
// PURE planners (re-score name gate, donor account->contacts expansion, assist
// pre-rank) + structural guards proving: the assist is annotation-only (never a
// verdict), auto-link band conservatism (only exact/near-exact), donor propagation
// keys on the person-level sf_contact_id via the SF-contact bridge, and the ledgers
// are reversible + provenance-registered.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  cleanSfName, coreSfName, buildRegistryMaps, scoreQueueRow, planRescoreDisposition,
  rescoreScoredKey, scoreRescoreWithBudget, rescoreBatchTag,
  RESCORE_AUTO_LINK_BAND, RESCORE_NO_MATCH_BAND,
} from '../api/_shared/sf-link-rescore-planner.js';
import {
  donorContactCols, donorOwnerSfCol, personNameSig, buildSfContactSig,
  planDonorStamp, scoreDonorWithBudget,
} from '../api/_shared/sf-donor-handoff-planner.js';
import {
  buildSfAssistPrompt, parseSfAssistJson, normalizeSfAssistProposal,
  sfAssistSortKey, sfAssistAgreement, SF_ASSIST_SOURCE, SF_ASSIST_KIND, SF_ASSIST_DECISION_TYPE,
} from '../api/_shared/sf-link-assist-planner.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminJs = readFileSync(join(root, 'api/admin.js'), 'utf8');
const lccMig = readFileSync(join(root, 'supabase/migrations/20260827120000_lcc_w9_3_sf_linkage_drain.sql'), 'utf8');
const govMig = readFileSync(join(root, 'supabase/migrations/government/20260827120000_gov_w9_3_rescore_and_donor_ledgers.sql'), 'utf8');
const diaMig = readFileSync(join(root, 'supabase/migrations/dialysis/20260827120000_dia_w9_3_rescore_and_donor_ledgers.sql'), 'utf8');

// ============================================================================
describe('WS2 re-score — name normalization', () => {
  it('clean keeps every token; core strips legal forms', () => {
    assert.equal(cleanSfName('2200 Main, LLC'), '2200 main llc');
    assert.equal(cleanSfName('Stream Realty Partners, L.P.'), 'stream realty partners l p');
    assert.equal(coreSfName('2200 Main LLC'), '2200 main');
    assert.equal(coreSfName('UMA Holdings Inc'), 'uma holdings'); // holdings kept, inc dropped
  });
  it('& is expanded so "A & B" == "A and B"', () => {
    assert.equal(cleanSfName('Smith & Jones'), 'smith and jones');
  });
});

describe('WS2 re-score — scoring bands', () => {
  const accounts = [
    { sf_account_id: '001A', sf_account_name: 'Stream Realty Partners, LP' },
    { sf_account_id: '001B', sf_account_name: 'UMA Holdings' },
    { sf_account_id: '001C', sf_account_name: 'Cadence Capital Investments' },
    { sf_account_id: '001D', sf_account_name: 'Cadence Capital Investments LLC' }, // core-collides with 001C
    { sf_account_id: '001E', sf_account_name: 'Main Street Partners' },
    { sf_account_id: '001F', sf_account_name: 'Main Street Partners' }, // exact-clean duplicate id
  ];
  const maps = buildRegistryMaps(accounts);

  it('exact clean-name UNIQUE -> auto_link (0.99)', () => {
    const s = scoreQueueRow({ owner_name: 'Stream Realty Partners LP', canonical_name: 'stream realty partners' }, maps);
    assert.equal(s.band, 'auto_link');
    assert.equal(s.sf_account_id, '001A');
    assert.ok(s.probability >= RESCORE_AUTO_LINK_BAND);
  });
  it('exact clean-name AMBIGUOUS (>1 account) -> needs_review, never auto_link', () => {
    const s = scoreQueueRow({ owner_name: 'Main Street Partners' }, maps);
    assert.equal(s.band, 'needs_review');
    assert.equal(s.ambiguous, true);
    assert.ok(s.probability < RESCORE_AUTO_LINK_BAND);
  });
  it('core-only match (legal-form variant) -> needs_review, never auto_link', () => {
    // "UMA Holdings LLC" clean != "uma holdings" (the account is bare), so it only
    // matches at the CORE tier -> review, not auto.
    const s = scoreQueueRow({ owner_name: 'UMA Holdings LLC' }, maps);
    assert.equal(s.band, 'needs_review');
    assert.equal(s.sf_account_id, '001B');
    assert.ok(s.probability < RESCORE_AUTO_LINK_BAND && s.probability > RESCORE_NO_MATCH_BAND);
  });
  it('no match -> no_match (0), no candidate', () => {
    const s = scoreQueueRow({ owner_name: '900 South Nowhere Trust' }, maps);
    assert.equal(s.band, 'no_match');
    assert.equal(s.sf_account_id, null);
    assert.ok(s.probability <= RESCORE_NO_MATCH_BAND);
  });
  it('BAND CONSERVATISM: auto_link ONLY on an exact UNIQUE clean hit (level 3, unambiguous)', () => {
    // Any auto_link that occurs MUST be a unique exact-clean match — never a fuzzy /
    // core / ambiguous one (the W4.3 band-transfer-failure guard).
    for (const owner of ['Main Street Partners', 'UMA Holdings Corp', 'Totally Unknown Co', 'Cadence Capital Investments']) {
      const s = scoreQueueRow({ owner_name: owner }, maps);
      if (s.band === 'auto_link') {
        assert.equal(s.ambiguous, false);
        assert.equal(s.level, 3);
      }
    }
    // Exact-clean AMBIGUITY (two accounts, identical clean name) must route to review.
    const amb = scoreQueueRow({ owner_name: 'Main Street Partners' }, maps);
    assert.equal(amb.band, 'needs_review');
    assert.equal(amb.ambiguous, true);
    // A core-only (legal-form) collision likewise never auto-links.
    const core = scoreQueueRow({ owner_name: 'UMA Holdings Corp' }, maps); // clean has 'corp' -> core tier
    assert.notEqual(core.band, 'auto_link');
  });
});

describe('WS2 re-score — disposition null-guard', () => {
  const goodScore = { band: 'auto_link', probability: 0.99, sf_account_id: '001A', sf_account_name: 'A' };
  it('clean owner (no existing id) -> writeSource + provenance', () => {
    const p = planRescoreDisposition({ score: goodScore, currentSfId: null });
    assert.equal(p.queueStatus, 'linked');
    assert.equal(p.writeSource, true);
    assert.equal(p.provenance, true);
    assert.equal(p.landedSfId, '001A');
  });
  it('same id already present -> idempotent (no write)', () => {
    const p = planRescoreDisposition({ score: goodScore, currentSfId: '001A' });
    assert.equal(p.queueStatus, 'linked');
    assert.equal(p.writeSource, false);
  });
  it('DIFFERENT id already present -> conflict -> needs_review, NEVER overwrite', () => {
    const p = planRescoreDisposition({ score: goodScore, currentSfId: '999Z' });
    assert.equal(p.conflict, true);
    assert.equal(p.conflictExistingId, '999Z');
    assert.equal(p.queueStatus, 'needs_review');
    assert.equal(p.writeSource, false);
  });
  it('needs_review score -> needs_review, no write', () => {
    const p = planRescoreDisposition({ score: { band: 'needs_review', probability: 0.85, sf_account_id: '001B' } });
    assert.equal(p.queueStatus, 'needs_review');
    assert.equal(p.writeSource, false);
  });
  it('no_match score -> no_match', () => {
    const p = planRescoreDisposition({ score: { band: 'no_match', probability: 0, sf_account_id: null } });
    assert.equal(p.queueStatus, 'no_match');
  });
});

describe('WS2 re-score — budget/resumable', () => {
  it('caps at maxN and reports remaining', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ i }));
    const r = scoreRescoreWithBudget(rows, (x) => x, { maxN: 10, budgetMs: 999999 });
    assert.equal(r.scored.length, 10);
    assert.equal(r.capped, true);
    assert.equal(r.remaining_unscored, 90);
  });
  it('stops at the wall-clock budget', () => {
    let t = 0; const clock = () => (t += 40);
    const rows = Array.from({ length: 100 }, (_, i) => ({ i }));
    const r = scoreRescoreWithBudget(rows, (x) => x, { maxN: 100, budgetMs: 100, now: clock });
    assert.equal(r.budget_exhausted, true);
    assert.ok(r.scored.length < 100);
  });
  it('scored key varies with registry size (re-scores when the registry grows)', () => {
    assert.notEqual(rescoreScoredKey('q1', 15987, 'Acme LLC'), rescoreScoredKey('q1', 16210, 'Acme LLC'));
  });
  it('batch tag is date-stamped + refreshed-registry marked', () => {
    assert.equal(rescoreBatchTag('2026-08-08'), 'w9_3_splink_v2_20260808_refreshed_registry');
  });
});

// ============================================================================
describe('WS3 donor handoff — name matching', () => {
  it('person signature is order-independent + drops initials', () => {
    assert.equal(personNameSig('John A. Smith'), personNameSig('Smith, John'));
    assert.equal(personNameSig('JANE DOE'), 'doe jane');
  });
  it('unique name match -> fill with the real sf_contact_id', () => {
    const idx = buildSfContactSig([
      { sf_contact_id: 'c1', name: 'John Smith', email: 'j@x.com', phone: null },
      { sf_contact_id: 'c2', name: 'Jane Doe', email: null, phone: '555' },
    ]);
    const p = planDonorStamp({ contact: { sf_contact_id: null, name: 'Smith, John' }, sigIndex: idx });
    assert.equal(p.fill, true);
    assert.equal(p.sfContactId, 'c1');
  });
  it('already-has key -> skip (fill-blanks only)', () => {
    const idx = buildSfContactSig([{ sf_contact_id: 'c1', name: 'John Smith' }]);
    const p = planDonorStamp({ contact: { sf_contact_id: 'existing', name: 'John Smith' }, sigIndex: idx });
    assert.equal(p.fill, false);
    assert.equal(p.reason, 'already_has_sf_contact_id');
  });
  it('AMBIGUOUS (two SF contacts share the name) -> skip, never guess', () => {
    const idx = buildSfContactSig([
      { sf_contact_id: 'c1', name: 'John Smith' },
      { sf_contact_id: 'c2', name: 'John Smith' },
    ]);
    const p = planDonorStamp({ contact: { sf_contact_id: null, name: 'John Smith' }, sigIndex: idx });
    assert.equal(p.fill, false);
    assert.equal(p.reason, 'ambiguous_sf_contact');
  });
  it('no SF-contact match -> skip', () => {
    const idx = buildSfContactSig([{ sf_contact_id: 'c1', name: 'John Smith' }]);
    const p = planDonorStamp({ contact: { sf_contact_id: null, name: 'Nobody Here' }, sigIndex: idx });
    assert.equal(p.fill, false);
    assert.equal(p.reason, 'no_sf_contact_match');
  });
  it('domain column maps + owner sf col are correct', () => {
    assert.equal(donorContactCols('dia').nameCol, 'contact_name');
    assert.equal(donorContactCols('gov').nameCol, 'name');
    assert.equal(donorOwnerSfCol('gov'), 'sf_account_id');
    assert.equal(donorOwnerSfCol('dia'), 'sf_company_id');
  });
  it('budget driver drops nulls + reports remaining', () => {
    const r = scoreDonorWithBudget([1, 2, 3, 4], (x) => (x % 2 ? x : null), { maxN: 10, budgetMs: 999999 });
    assert.deepEqual(r.results, [1, 3]);
    assert.equal(r.covered, 4);
  });
});

// ============================================================================
describe('WS1 assist — prompt/parse/normalize', () => {
  it('prompt forbids fabrication + asks for verdict/confidence/reason', () => {
    const p = buildSfAssistPrompt({ owner_name: 'Acme LLC', sf_account_name_resolved: 'Acme Holdings' });
    assert.match(p, /never invent facts/i);
    assert.match(p, /verdict/);
    assert.match(p, /confidence/);
    assert.match(p, /Acme LLC/);
  });
  it('parses fenced JSON + clamps confidence', () => {
    const parsed = parseSfAssistJson('```json\n{"verdict":"merge","confidence":1.4,"reason":"same name"}\n```');
    const n = normalizeSfAssistProposal(parsed);
    assert.equal(n.verdict, 'merge');
    assert.equal(n.confidence, 1);
  });
  it('unknown verdict -> uncertain', () => {
    assert.equal(normalizeSfAssistProposal({ verdict: 'yes', confidence: 0.5 }).verdict, 'uncertain');
  });
  it('sort key: decisive high-confidence ranks above uncertain', () => {
    assert.ok(sfAssistSortKey({ verdict: 'merge', confidence: 0.9 }) > sfAssistSortKey({ verdict: 'uncertain', confidence: 0.9 }));
    assert.ok(sfAssistSortKey({ verdict: 'not', confidence: 0.8 }) > sfAssistSortKey({ verdict: 'merge', confidence: 0.3 }));
    assert.equal(sfAssistSortKey(null), 0);
  });
});

describe('WS1 assist — agreement self-measurement', () => {
  it('merge vs same_party = agree; not vs distinct = agree', () => {
    assert.deepEqual(sfAssistAgreement('merge', 'same_party'), { measured: true, agreed: true, assist_verdict: 'merge', human_verdict: 'same_party' });
    assert.equal(sfAssistAgreement('not', 'distinct').agreed, true);
  });
  it('merge vs distinct = disagree', () => {
    assert.equal(sfAssistAgreement('merge', 'distinct').agreed, false);
  });
  it('uncertain is NOT measured (honest denominator)', () => {
    assert.equal(sfAssistAgreement('uncertain', 'same_party').measured, false);
  });
});

// ============================================================================
describe('structural guards — annotation-never-verdict', () => {
  it('the assist tick writes lcc_clean_assist_proposals, NOT the queue status', () => {
    // isolate the assist tick handler body
    const start = adminJs.indexOf('async function handleSfLinkAssistTick');
    const end = adminJs.indexOf('async function handleSfDonorHandoffTick');
    assert.ok(start > 0 && end > start);
    const body = adminJs.slice(start, end);
    assert.match(body, /upsertSfAssist/);
    // it must NEVER PATCH the queue / write an SF id column
    assert.ok(!/PATCH'?,\s*'sf_link_research_queue/.test(body), 'assist tick must not disposition the queue');
    assert.ok(!/entity_match_labels/.test(body), 'assist tick must not write a training label (that is the human verdict)');
  });
  it('the assist store uses a distinct source (never collides with prompt-32)', () => {
    assert.equal(SF_ASSIST_SOURCE, 'w9_3_sf_assist');
    assert.equal(SF_ASSIST_KIND, 'review_triage');
    assert.equal(SF_ASSIST_DECISION_TYPE, 'sf_link_candidate');
    assert.match(adminJs, /source:\s*SA\.SF_ASSIST_SOURCE/);
  });
  it('the lane sorts easy-first via the assist (attachSfLinkAssist)', () => {
    assert.match(adminJs, /attachSfLinkAssist\(g\.concat\(d\)\)/);
    assert.match(adminJs, /SA\.sfAssistSortKey/);
  });
});

describe('structural guards — nightly LLM tick anti-joins its OWN output (walk-the-pool)', () => {
  // prompt 92: the sf-link-assist tick MUST exclude subject_refs it has already
  // annotated so it walks the ~3.3k pool instead of re-scoring the same top-N nightly
  // (3rd instance of this class — U1 prompt-84 scan, U5 prompt-83 window). This shared
  // assertion pins the anti-join for the assist tick; reuse it for any future nightly
  // LLM tick that upserts into a table it also reads candidates from.
  function assertTickAntiJoinsOwnOutput({ src, tickHandler, dedupeHelper }) {
    // (a) the dedupe helper reads back this source's own annotations, correctly ordered
    //     by the REAL pk column (proposal_id — an invalid `id` column silently 500s
    //     PostgREST and returns an empty set, which is exactly the treadmill this fixes).
    const hs = src.indexOf('async function ' + dedupeHelper);
    assert.ok(hs > 0, dedupeHelper + ' helper missing');
    const hbody = src.slice(hs, hs + 900);
    assert.match(hbody, /decision_type=eq\.sf_link_candidate&source=eq\.'\s*\+\s*SA\.SF_ASSIST_SOURCE/);
    assert.match(hbody, /order=proposal_id\.asc/, 'anti-join read must order by the real PK (proposal_id), not id');
    assert.ok(!/order=id\.asc/.test(hbody), 'ordering by a non-existent `id` column silently empties the exclusion set');
    // (b) the tick fetches candidates, then filters out the already-annotated set.
    const ts = src.indexOf('async function ' + tickHandler);
    const te = src.indexOf('async function ', ts + 10);
    const tbody = src.slice(ts, te > ts ? te : ts + 6000);
    assert.match(tbody, new RegExp('const annotated = await ' + dedupeHelper + '\\(\\)'));
    assert.match(tbody, /\.filter\(\(it\) => it\.subject_ref && !annotated\.has\(it\.subject_ref\)\)/,
      'tick must anti-join the fetched candidates against its own annotated set');
    // (c) belt + braces: a per-item skip-before-LLM guard inside the scoring loop.
    assert.match(tbody, /if \(annotated\.has\(item\.subject_ref\)\) \{ summary\.skipped \+= 1; continue; \}/,
      'tick must skip-before-LLM if an annotation already exists for the item');
    // (d) the exclusion count is surfaced honestly in the response.
    assert.match(tbody, /already_annotated_excluded/, 'the excluded count must be surfaced');
  }

  it('handleSfLinkAssistTick excludes fetchSfAssistAnnotated() and surfaces the count', () => {
    assertTickAntiJoinsOwnOutput({
      src: adminJs, tickHandler: 'handleSfLinkAssistTick', dedupeHelper: 'fetchSfAssistAnnotated',
    });
  });
});

describe('structural guards — re-score writes are conservative + reversible', () => {
  it('auto-link owner write is null-guarded (never overwrites)', () => {
    assert.match(adminJs, /sfCol \+ '=is\.null'/); // PATCH filter re-asserts null
  });
  it('auto-links write splink_v2 provenance + a reversible ledger row', () => {
    assert.match(adminJs, /source: 'splink_v2'/);
    assert.match(adminJs, /'w9_3_rescore_log'/);
  });
  it('re-score is resumable via score_resolved (a scored row drops out)', () => {
    assert.match(adminJs, /status=eq\.no_match&score_resolved=is\.null/);
  });
});

describe('structural guards — donor propagation keys on sf_contact_id', () => {
  it('handoff reads the SF-contact bridge (gov sf_contacts_import / dia salesforce_contacts)', () => {
    assert.match(adminJs, /sf_contacts_import\?sf_account_id=in\./);
    assert.match(adminJs, /salesforce_contacts\?sf_account_id=in\./);
  });
  it('stamp fills contacts.sf_contact_id fill-blanks (=is.null guard) with provenance', () => {
    assert.match(adminJs, /contacts\?' \+ c\.pkCol \+ '=eq\.' \+ encodeURIComponent\(contact\.contact_id\) \+ '&sf_contact_id=is\.null'/);
    assert.match(adminJs, /source: 'sf_account_contact_expansion'/);
    assert.match(adminJs, /'w9_3_donor_handoff_log'/);
  });
  it('coverage metric (the acceptance number) is recorded per run', () => {
    assert.match(adminJs, /lcc_w9_3_donor_coverage_log/);
  });
});

describe('structural guards — migrations (flags OFF, provenance, reversible ledgers)', () => {
  it('all three flags registered OFF in-migration', () => {
    for (const f of ['W9_3_SF_ASSIST', 'W9_3_RESCORE', 'W9_3_DONOR_HANDOFF']) {
      assert.ok(lccMig.includes("'" + f + "'"), f + ' flag missing');
    }
    assert.match(lccMig, /'off', DATE '2026-08-08'/);
  });
  it('splink_v2 + sf_account_contact_expansion registered in field_source_priority', () => {
    assert.match(lccMig, /'splink_v2', 50, 0\.9, 'record_only'/);
    assert.match(lccMig, /'sf_account_contact_expansion', 45/);
  });
  it('the flush allowlist preserves the two new sources', () => {
    assert.match(lccMig, /'splink_v1','sf_link_review_human','splink_v2','sf_account_contact_expansion'/);
  });
  it('U4 assist accuracy view + metadata-only recorder exist', () => {
    assert.match(lccMig, /v_lcc_w9_3_sf_assist_accuracy/);
    assert.match(lccMig, /lcc_record_sf_assist_agreement/);
  });
  it('domain ledgers are reversible (prior_status + prior_sf_value captured)', () => {
    for (const m of [govMig, diaMig]) {
      assert.match(m, /w9_3_rescore_log/);
      assert.match(m, /prior_status/);
      assert.match(m, /prior_sf_value/);
      assert.match(m, /w9_3_donor_handoff_log/);
    }
  });
});
