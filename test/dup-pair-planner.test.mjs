// W8 U2 (Prompt 63) — Ollama duplicate-pair proposals → resolver fuel. Unit tests
// for the PURE planner (near-miss generator incl. block-miss detection + exclusion
// joins + cap, prompt/parse, proposal normalization + drop-unsure) plus structural
// guards proving admin.js emits to the EXISTING owner_reconcile resolver review
// pool (seeder 'w8_u2_ollama_pair'), writes an entity_match_labels row on a human
// verdict, and NEVER a merge.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DUP_PAIR_TARGETS, findDupPairTarget, dupSideRef, dupPairKey, dupPairSubjectRef,
  normalizeOwnerName, nameTokens, ownerCore, sharesTokenBlock,
  trigramSimilarity, levenshtein, levenshteinRatio, nameSimilarity,
  nameInitials, abbreviationMatch, normalizeAddress, isWeakAddress,
  generateCandidatePairs, excludeKnownPairs, buildDupPairPrompt,
  normalizeDupPairProposal, parseDupPairJson, isProposablePair, scoreDupPairsWithBudget,
  coreIsPairable, DISTINCTIVE_CORE_MIN_LEN, dupPairDisposition, DUP_PAIR_NEEDS_HUMAN_SIM,
} from '../api/_shared/dup-pair-planner.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
describe('name normalization + token blocking', () => {
  it('normalizes punctuation, ampersand, case', () => {
    assert.equal(normalizeOwnerName('DaVita, Inc.'), 'davita inc');
    assert.equal(normalizeOwnerName('Smith & Jones'), 'smith and jones');
  });
  it('drops legal-form tokens from the core', () => {
    assert.deepEqual([...nameTokens('DaVita Inc LLC')], ['davita']);
    assert.equal(ownerCore('Oak Street Realty LLC'), ['oak', 'street'].sort().join(' '));
  });
  it('sharesTokenBlock true when a significant word token is shared (resolver already blocks it)', () => {
    assert.equal(sharesTokenBlock('DaVita Dialysis', 'DaVita Renal'), true);
  });
  it('sharesTokenBlock false for a pure typo / abbreviation (the resolver blind spot)', () => {
    assert.equal(sharesTokenBlock('DaVita', 'DaVeta'), false);
    assert.equal(sharesTokenBlock('DVA', 'DaVita'), false);
  });
});

describe('similarity primitives', () => {
  it('levenshtein + ratio', () => {
    assert.equal(levenshtein('davita', 'daveta'), 1);
    assert.ok(levenshteinRatio('davita', 'daveta') > 0.8);
  });
  it('trigram similarity is high for a typo, low for unrelated', () => {
    assert.ok(trigramSimilarity('davita', 'daveta') > 0.5);
    assert.ok(trigramSimilarity('davita', 'blackstone') < 0.2);
  });
  it('nameSimilarity works on the semantic core (ignores legal forms)', () => {
    assert.ok(nameSimilarity('DaVita Inc', 'DaVeta LLC') > 0.8);
  });
});

describe('abbreviation / expansion detection', () => {
  it('matches a known abbreviation (DVA <-> DaVita)', () => {
    const m = abbreviationMatch('DVA', 'DaVita');
    assert.ok(m);
    assert.equal(m.kind, 'known_abbrev');
    assert.equal(m.expansion, 'davita');
  });
  it('matches by initials (USRC <-> US Renal Care)', () => {
    assert.equal(nameInitials('US Renal Care'), 'urc');
    const m = abbreviationMatch('URC', 'US Renal Care');
    assert.ok(m && m.kind === 'initials');
  });
  it('returns null when neither side is a short acronym', () => {
    assert.equal(abbreviationMatch('Blackstone', 'Brookfield'), null);
  });
});

describe('address normalization', () => {
  it('normalizes + strips suite noise', () => {
    assert.equal(normalizeAddress('123 Main St, Suite 400'), '123 main st');
  });
  it('flags weak / P.O.-box addresses', () => {
    assert.equal(isWeakAddress('po box 12'), true);
    assert.equal(isWeakAddress('ab'), true);
    assert.equal(isWeakAddress('123 main st'), false);
  });
});

// ---------------------------------------------------------------------------
describe('generateCandidatePairs — the deterministic near-miss generator', () => {
  const recs = [
    { ref: 'dia:true_owners:1', name: 'DaVita Inc' },
    { ref: 'dia:true_owners:2', name: 'DaVeta Inc' },              // typo of #1, no shared token
    { ref: 'dia:true_owners:3', name: 'DaVita Dialysis LLC' },     // shares "davita" with #1 -> resolver sees it
    { ref: 'dia:true_owners:4', name: 'Blackstone Real Estate' },  // unrelated
    { ref: 'dia:true_owners:5', name: 'DVA' },                     // abbreviation of DaVita
  ];

  it('flags a name near-miss the resolver blocking would miss', () => {
    const pairs = generateCandidatePairs(recs, { nameThreshold: 0.8 });
    const nm = pairs.find((p) => p.method === 'name_near_miss');
    assert.ok(nm, 'expected a name_near_miss pair');
    const refs = [nm.a.ref, nm.b.ref].sort();
    assert.deepEqual(refs, ['dia:true_owners:1', 'dia:true_owners:2']);
    assert.ok(nm.similarity >= 0.8);
    assert.match(nm.evidence, /no shared word token/);
  });

  it('NEVER emits a pair that shares a resolver token block', () => {
    const pairs = generateCandidatePairs(recs, { nameThreshold: 0.6 });
    for (const p of pairs) {
      assert.equal(sharesTokenBlock(p.a.name, p.b.name), false,
        `pair ${p.a.name} / ${p.b.name} shares a token block — resolver already sees it`);
    }
  });

  it('flags an abbreviation/expansion pair (DVA <-> DaVita)', () => {
    const pairs = generateCandidatePairs(recs, { nameThreshold: 0.9 });
    const ab = pairs.find((p) => p.method === 'abbrev_expansion');
    assert.ok(ab, 'expected an abbrev_expansion pair');
    assert.deepEqual([ab.a.ref, ab.b.ref].sort(), ['dia:true_owners:1', 'dia:true_owners:5']);
  });

  it('flags same-address / different-name pairs', () => {
    const withAddr = [
      { ref: 'gov:true_owners:10', name: 'North Star Holdings', address: '500 Oak Ave' },
      { ref: 'gov:true_owners:11', name: 'Southbay Capital', address: '500 Oak Ave' },
    ];
    const pairs = generateCandidatePairs(withAddr, {});
    const sa = pairs.find((p) => p.method === 'same_address_diff_name');
    assert.ok(sa, 'expected a same_address_diff_name pair');
    assert.match(sa.evidence, /same mailing address/);
  });

  it('canonical pair key is order-independent + pairs are deduped', () => {
    assert.equal(dupPairKey('a', 'b'), dupPairKey('b', 'a'));
    const pairs = generateCandidatePairs(recs, { nameThreshold: 0.6 });
    const keys = pairs.map((p) => p.pairKey);
    assert.equal(new Set(keys).size, keys.length, 'no duplicate pair keys');
  });

  it('respects the maxPairs cap', () => {
    const many = [];
    for (let i = 0; i < 20; i++) many.push({ ref: 'lcc:entities:' + i, name: 'Acme Holding' + (i % 2 === 0 ? 's' : '') + ' number' + i });
    const pairs = generateCandidatePairs(many, { nameThreshold: 0.5, maxPairs: 3 });
    assert.ok(pairs.length <= 3);
  });

  it('does NOT pair identical cores (that is a match the resolver sees)', () => {
    const same = [
      { ref: 'lcc:entities:1', name: 'Acme Holdings LLC' },
      { ref: 'lcc:entities:2', name: 'Acme Holdings, L.L.C.' },   // identical core -> shared token anyway
    ];
    const pairs = generateCandidatePairs(same, { nameThreshold: 0.5 });
    assert.equal(pairs.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Prompt 68 — distinctive-core similarity, coverage, value inversion.
describe('distinctive-core stoplist + pairability (Prompt 68)', () => {
  it('strips the generic-CRE-noun stoplist to the distinctive core', () => {
    // The high-frequency CRE nouns that used to dominate char-similarity are gone.
    assert.equal(ownerCore('P & A Investments LLC'), '');          // only initials + stopwords
    assert.equal(ownerCore('B & W REALTY INVESTMENT LTD'), '');
    assert.equal(ownerCore('T.D. Service Company'), '');
    assert.equal(ownerCore('I. C. E. SERVICES, INC'), '');
    assert.equal(ownerCore('Owner'), '');
    assert.equal(ownerCore('Invester Properties LLC'), 'invester'); // distinctive word survives
    assert.equal(ownerCore('Winbrook Management'), 'winbrook');
  });
  it('coreIsPairable requires a substantial, non-initials core', () => {
    assert.equal(coreIsPairable('Invester Properties LLC'), true);
    assert.equal(coreIsPairable('Harrison Capital'), true);
    assert.equal(coreIsPairable('P & A Investments LLC'), false); // empty core
    assert.equal(coreIsPairable('Owner'), false);                 // stoplisted → empty
    assert.equal(coreIsPairable('T.D. Service Company'), false);  // initials + stopwords
    assert.equal(coreIsPairable('AB CD LLC'), false);             // purely 2-char initials
    assert.ok(DISTINCTIVE_CORE_MIN_LEN >= 4);
  });
});

describe('generateCandidatePairs — Prompt 68 regression fixtures (verbatim)', () => {
  const recs = [
    { ref: 'a:1', name: 'Invester Properties LLC' },
    { ref: 'a:2', name: 'Investar Properties Llc' },
    { ref: 'a:3', name: 'P & A Investments LLC' },
    { ref: 'a:4', name: 'B & W REALTY INVESTMENT LTD' },
    { ref: 'a:5', name: 'Owner' },
    { ref: 'a:6', name: 'Downer & Associates' },
    { ref: 'a:7', name: 'Harrison Capital' },
    { ref: 'a:8', name: 'Garrison Capital' },
    { ref: 'a:9', name: 'WINBROOK MANAGEMENT' },
    { ref: 'a:10', name: 'Twinbrook Properties' },
    { ref: 'a:11', name: 'T.D. Service Company' },
    { ref: 'a:12', name: 'I. C. E. SERVICES, INC' },
  ];
  const pairs = generateCandidatePairs(recs, { nameThreshold: 0.82 });
  const has = (n1, n2) => pairs.some((p) => [p.a.name, p.b.name].sort().join('|') === [n1, n2].sort().join('|'));

  it('Invester ↔ Investar → PROPOSED (the best catch, never dropped)', () => {
    assert.ok(has('Invester Properties LLC', 'Investar Properties Llc'));
  });
  it('Winbrook ↔ Twinbrook → generated', () => {
    assert.ok(has('WINBROOK MANAGEMENT', 'Twinbrook Properties'));
  });
  it('Harrison ↔ Garrison → generated (distinct persists as a hard negative downstream)', () => {
    assert.ok(has('Harrison Capital', 'Garrison Capital'));
  });
  it('P & A ↔ B & W → NEVER generated (initials-vs-initials noise)', () => {
    assert.ok(!has('P & A Investments LLC', 'B & W REALTY INVESTMENT LTD'));
  });
  it('Owner ↔ Downer & Associates → NEVER generated (generic word)', () => {
    assert.ok(!has('Owner', 'Downer & Associates'));
  });
  it('T.D. Service ↔ I.C.E. Services → NEVER generated (generic vocabulary)', () => {
    assert.ok(!has('T.D. Service Company', 'I. C. E. SERVICES, INC'));
  });
  it('no generated pair has an empty / unpairable core on either side', () => {
    for (const p of pairs) {
      if (p.method !== 'name_near_miss') continue;
      assert.ok(coreIsPairable(p.a.name) && coreIsPairable(p.b.name),
        `name pair on an unpairable core: ${p.a.name} / ${p.b.name}`);
    }
  });
});

describe('dupPairDisposition — Prompt 68 three-way value logic', () => {
  it('a decided verdict above the floor → propose', () => {
    assert.equal(dupPairDisposition({ verdict: 'same_party', confidence: 0.8 }, { similarity: 0.9 }), 'propose');
    assert.equal(dupPairDisposition({ verdict: 'distinct', confidence: 0.9 }, { similarity: 0.875 }), 'propose');
  });
  it('a high-core-similarity unsure → needs_human (routed, NOT dropped)', () => {
    assert.equal(dupPairDisposition({ verdict: 'unsure', confidence: 0.2 }, { similarity: 0.9 }), 'needs_human');
    assert.equal(dupPairDisposition({ verdict: 'unsure', confidence: 0.2 }, { similarity: DUP_PAIR_NEEDS_HUMAN_SIM }), 'needs_human');
  });
  it('a low-similarity unsure / below-floor verdict → drop', () => {
    assert.equal(dupPairDisposition({ verdict: 'unsure', confidence: 0.99 }, { similarity: 0.6 }), 'drop');
    assert.equal(dupPairDisposition({ verdict: 'same_party', confidence: 0.3 }, { similarity: 0.9 }), 'drop');
  });
});

describe('excludeKnownPairs — the exclusion join', () => {
  it('drops pairs whose canonical key is already known', () => {
    const pairs = [
      { pairKey: 'a|b', a: {}, b: {} },
      { pairKey: 'c|d', a: {}, b: {} },
    ];
    const out = excludeKnownPairs(pairs, new Set(['a|b']));
    assert.equal(out.length, 1);
    assert.equal(out[0].pairKey, 'c|d');
  });
  it('is a no-op with an empty known set', () => {
    const pairs = [{ pairKey: 'a|b' }];
    assert.equal(excludeKnownPairs(pairs, new Set()).length, 1);
  });
});

// ---------------------------------------------------------------------------
describe('buildDupPairPrompt', () => {
  const pair = { a: { name: 'DaVita Inc' }, b: { name: 'DaVeta Inc' }, method: 'name_near_miss', similarity: 0.9, evidence: 'typo' };
  it('is proposal-only + asks for same_party/distinct/unsure JSON', () => {
    const p = buildDupPairPrompt(pair, []);
    assert.match(p, /You ONLY propose/);
    assert.match(p, /never merge/);
    assert.match(p, /same_party/);
    assert.match(p, /distinct/);
    assert.match(p, /unsure/);
    assert.match(p, /DaVita Inc/);
    assert.match(p, /DaVeta Inc/);
  });
  it('folds in few-shot operator verdicts', () => {
    const p = buildDupPairPrompt(pair, [{ a: 'Foo LLC', b: 'Foo Inc', verdict: 'same_party' }]);
    assert.match(p, /Operator rubric/);
    assert.match(p, /Foo LLC/);
  });
});

describe('parse + normalize proposal', () => {
  const pair = { a: { name: 'DaVita Inc' }, b: { name: 'DaVeta Inc' }, method: 'name_near_miss', evidence: 'gen-evidence' };
  it('parses fenced + bare JSON', () => {
    assert.equal(parseDupPairJson('```json\n{"verdict":"same_party"}\n```').verdict, 'same_party');
    assert.equal(parseDupPairJson('noise {"verdict":"distinct"} tail').verdict, 'distinct');
    assert.equal(parseDupPairJson('not json'), null);
  });
  it('normalizes verdict synonyms + clamps confidence', () => {
    assert.equal(normalizeDupPairProposal({ verdict: 'MATCH', confidence: 5 }, pair).verdict, 'same_party');
    assert.equal(normalizeDupPairProposal({ verdict: 'different', confidence: -1 }, pair).confidence, 0);
    assert.equal(normalizeDupPairProposal({ verdict: 'garbage' }, pair).verdict, 'unsure');
  });
  it('falls back to deterministic evidence when the quote is not verbatim', () => {
    const n = normalizeDupPairProposal({ verdict: 'same_party', evidence_quote: 'made up' }, pair);
    assert.equal(n.evidence_quote, 'gen-evidence');
  });
  it('keeps a verbatim quote', () => {
    const n = normalizeDupPairProposal({ verdict: 'same_party', evidence_quote: 'DaVita' }, pair);
    assert.equal(n.evidence_quote, 'DaVita');
  });
});

describe('isProposablePair — value gate (drop unsure / low-confidence)', () => {
  it('proposes decided verdicts above the floor', () => {
    assert.equal(isProposablePair({ verdict: 'same_party', confidence: 0.7 }, 0.6), true);
    assert.equal(isProposablePair({ verdict: 'distinct', confidence: 0.9 }, 0.6), true);
  });
  it('drops unsure + low-confidence', () => {
    assert.equal(isProposablePair({ verdict: 'unsure', confidence: 0.99 }, 0.6), false);
    assert.equal(isProposablePair({ verdict: 'same_party', confidence: 0.3 }, 0.6), false);
  });
});

describe('scoreDupPairsWithBudget', () => {
  it('caps at maxN and stops at the wall-clock budget', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const r = await scoreDupPairsWithBudget(items, async (x) => x, { maxN: 3 });
    assert.equal(r.scored, 3);
    assert.equal(r.remaining_unscored, 7);
    let clock = 0;
    const r2 = await scoreDupPairsWithBudget(items, async (x) => x, { maxN: 10, budgetMs: 5, now: () => (clock += 10) });
    assert.ok(r2.budget_exhausted);
  });
});

// ---------------------------------------------------------------------------
describe('target catalogue', () => {
  it('covers ops entities + gov/dia true_owners (per the U2 prompt)', () => {
    assert.ok(findDupPairTarget('lcc', 'entities'));
    assert.ok(findDupPairTarget('gov', 'true_owners'));
    assert.ok(findDupPairTarget('dia', 'true_owners'));
    assert.ok(findDupPairTarget('government', 'true_owners'), 'aliases government->gov');
  });
  it('every target declares a merged-pointer so merged rows are skipped', () => {
    for (const t of DUP_PAIR_TARGETS) assert.ok(t.mergedCol, `${t.domain}:${t.table} needs mergedCol`);
  });
  it('dupSideRef canonicalizes the domain', () => {
    assert.equal(dupSideRef('dialysis', 'true_owners', 7), 'dia:true_owners:7');
  });
  it('dupPairSubjectRef is namespaced + order-independent', () => {
    assert.equal(dupPairSubjectRef('x', 'y'), dupPairSubjectRef('y', 'x'));
    assert.match(dupPairSubjectRef('x', 'y'), /^ownrec:w8u2:/);
  });
});

// ---------------------------------------------------------------------------
// Structural guards on admin.js — the wiring the doctrine requires.
describe('admin.js wiring — emit to the EXISTING resolver review pool, verdict → label, NEVER merge', () => {
  const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');

  it('route + handler exist', () => {
    assert.match(admin, /case 'dup-pair-tick':\s+return handleDupPairTick/);
    assert.match(admin, /async function handleDupPairTick/);
    assert.match(server, /\/api\/dup-pair-tick/);
  });

  it('is a 4th folded seeder in the EXISTING owner_reconcile lane (NOT a new lane)', () => {
    // No new FEDERATED_DECISION_TYPES entry — it rides owner_reconcile. Extract
    // the Set literal (non-greedy up to its close) and assert the token is absent.
    const setBlock = admin.match(/FEDERATED_DECISION_TYPES = new Set\(\[[\s\S]*?\]\)/)[0];
    assert.doesNotMatch(setBlock, /'w8_u2_ollama_pair'/);
    // The owner_reconcile fetch reads the proposal view + the verdict dispatch
    // handles the kind.
    assert.match(admin, /v_w8_u2_dup_pair_open/);
    assert.match(admin, /kind === 'w8_u2_ollama_pair'/);
    assert.match(admin, /if \(s\.kind === 'w8_u2_ollama_pair'\)/);
  });

  it('the accepted verdict writes an entity_match_labels row (seeder w8_u2_ollama_pair)', () => {
    // The label writer uses `kind === 'ore' ? 'ore_reconcile' : kind`, so kind
    // 'w8_u2_ollama_pair' flows straight into entity_match_labels.seeder.
    assert.match(admin, /writeEntityMatchLabel/);
    // The kind branch dispositions the proposal row (confirmed_match / rejected).
    assert.match(admin, /w8_u2_dup_pair\?pair_id=eq/);
  });

  it('the kind branch NEVER merges (zero merges from this unit)', () => {
    // Isolate the w8_u2_ollama_pair branch body and assert it does not call the
    // merge RPC (unlike the 'ore' branch which does).
    const start = admin.indexOf("} else if (kind === 'w8_u2_ollama_pair')");
    assert.ok(start > 0, 'expected the owner_reconcile verdict-dispatch branch');
    const branch = admin.slice(start, start + 1400);
    assert.doesNotMatch(branch, /lcc_merge_entity/);
    assert.match(branch, /effects\.merged = false/);
  });

  it('the apply path is flag-gated (no-op while OFF) + proposal-only value-gated', () => {
    assert.match(admin, /W8_U2_DUP_PAIRS/);
    assert.match(admin, /skipped: 'feature_flag_off'/);
    assert.match(admin, /isProposablePair/);
    assert.match(admin, /dropped_unsure/);
  });

  it('Prompt 68: scan failures are surfaced LOUDLY, not swallowed to records:0', () => {
    assert.match(admin, /SCAN FAILED/);
    assert.match(admin, /dupPairScanErrors/);
    assert.match(admin, /scan_errors/);
    // The pull returns a real error object on !r.ok instead of an empty page.
    assert.match(admin, /if \(!r\.ok\)/);
  });

  it('Prompt 68: the lcc scan is a resumable keyset window (cursor in the ledger)', () => {
    assert.match(admin, /fetchDupPairScanCursors/);
    assert.match(admin, /scan_cursors/);
    assert.match(admin, /=gt\.'/);        // keyset predicate on the ascending pk
    assert.match(admin, /nextCursor/);
  });

  it('Prompt 68: the write path routes needs_human to the review lane (three-way disposition)', () => {
    assert.match(admin, /dupPairDisposition/);
    assert.match(admin, /needs_human/);
  });
});

describe('target catalogue — Prompt 68 coverage fix', () => {
  it('gov true_owners addrCol is null (no scalar mailing column → no 400)', () => {
    const gov = findDupPairTarget('gov', 'true_owners');
    assert.equal(gov.addrCol, null);
  });
  it('dia true_owners uses the real notice_address_1 column', () => {
    const dia = findDupPairTarget('dia', 'true_owners');
    assert.equal(dia.addrCol, 'notice_address_1');
  });
});

describe('buildDupPairPrompt — Prompt 68 rubric additions', () => {
  it('teaches typo-variant → same_party and different surnames → distinct', () => {
    const p = buildDupPairPrompt({ a: { name: 'Invester' }, b: { name: 'Investar' }, method: 'name_near_miss' }, []);
    assert.match(p, /Invester/);
    assert.match(p, /Harrison/);
    assert.match(p, /spelling variant/i);
    assert.match(p, /surname/i);
  });
});

describe('migration + flag registration', () => {
  const mig = readFileSync(join(root, 'supabase/migrations/20260807160000_lcc_w8_u2_dup_pair_proposals.sql'), 'utf8');
  it('registers the W8_U2_DUP_PAIRS flag OFF in-migration (36y rule)', () => {
    assert.match(mig, /feature_flags_registry/);
    assert.match(mig, /'W8_U2_DUP_PAIRS'/);
    assert.match(mig, /'off'/);
  });
  it('creates the proposal table + reversible ledger + open view + health tile', () => {
    assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.w8_u2_dup_pair\b/);
    assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.w8_u2_dup_pair_batch/);
    assert.match(mig, /CREATE OR REPLACE VIEW public\.v_w8_u2_dup_pair_open/);
    assert.match(mig, /v_lcc_w8_u2_dup_pair_health/);
  });
  it('the proposal table CHECK forbids a merge status (proposal-only lifecycle)', () => {
    assert.match(mig, /status IN \('proposed', 'confirmed_match', 'rejected', 'superseded'\)/);
    assert.doesNotMatch(mig, /'merged'/);
  });
  it('schedules the nightly cron that no-ops while OFF', () => {
    assert.match(mig, /dup-pair-tick/);
    assert.match(mig, /lcc_cron_post\('\/api\/dup-pair-tick'/);
  });
});
