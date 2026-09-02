// OWN-T0 — the property panel reads ONE reconciled ownership chain.
//
// What these guards protect, and why each one exists:
//
//  1. The producer fix. P117's fill-blanks predicate asked "does THIS OWNER
//     already have a fact for this property?" and never asked whether the
//     PROPERTY already had a current owner, which minted a second current owner
//     on 632 of 756 properties. The probe must stay PROPERTY-grained.
//  2. Nothing is end-dated. Reading the top 60 multi-current properties by rent
//     showed the class is dominated by sponsor/SPE pairs where BOTH facts are
//     true (USAA Real Estate || Usgbf Tsa LLC; Boyd Watterson || Boyd Ashburn
//     LLC). A blanket supersession would destroy a true fact, so OWN-T0 writes
//     no ownership_end_date at all — and a future "cleanup" must go red here.
//  3. No lexical sponsor guess. A3 measured lcc_tier0_sponsor_brand_token at
//     3 of 74 on GSA SPEs and ~25% precision generally; P198 measured
//     co-proposal at 7%. The classifier reads the CONFIRMED registry only.
//  4. `not materialized` is load-bearing, not decoration: without it the
//     panel's point query is 1,013.9 ms / 216,947 buffers instead of
//     20.1 ms / 674, because a multiply-referenced CTE is always materialized
//     and the predicate cannot push down (C13b §7.7).
//  5. The tab reads ONE store. The renderer must not reach back into the domain
//     views — rendering them beside the reconciled chain as an equal claim is
//     what made the tab "conflicting" in the first place.
//
// Comment-stripping is load-bearing in every source assertion here: the
// migration header and the JS comments quote each banned shape while EXPLAINING
// it, so a raw-source grep finds them all present and passes over a complete
// revert (A5c / N18 / B6c-dup).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION = 'supabase/migrations/20260902160000_lcc_own_t0_property_ownership_reconciled.sql';
const HANDLER   = 'api/_handlers/entities-handler.js';
const PANEL     = 'detail.js';

const read = (p) => readFileSync(p, 'utf8');

/** Strip SQL comments (-- to EOL, /* *​/), respecting single-quoted strings. */
export function stripSqlComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'") {                       // string literal — copy verbatim
      out += c; i++;
      while (i < src.length) {
        out += src[i];
        if (src[i] === "'" && src[i + 1] === "'") { out += src[++i]; i++; continue; }
        if (src[i] === "'") break;
        i++;
      }
      continue;
    }
    if (c === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; out += ' '; continue; }
    out += c;
  }
  return out;
}

/**
 * Blank SQL string literals AFTER comments are gone. ORDER MATTERS and is the
 * OCR1c lesson: blanking literals first lets a bare apostrophe in prose open a
 * string the scanner never closes and swallow real code. This exists because
 * the function's own `comment on function ... 'Reverse: delete from
 * lcc_entity_portfolio_facts ...'` puts a banned shape inside a literal, so the
 * destructive-statement guard would go red over the sentence explaining it.
 */
export function blankSqlLiterals(src) {
  return src.replace(/'(?:''|[^'])*'/g, "''");
}

/** Strip JS line/block comments, respecting ' " ` strings. */
export function stripJsComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; out += ' '; continue; }
    out += c;
  }
  return out;
}

/** A function body bounded by a STABLE structural marker, never a char window. */
function jsFunctionBody(src, name, endMarker) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, `end marker ${endMarker} not found after ${name}`);
  return src.slice(start, end);
}

describe('OWN-T0 §1 — the producer fix stays at the PROPERTY grain', () => {
  const sql = stripSqlComments(read(MIGRATION));
  // The candidate CASE, bounded by its own structural markers.
  const fn = sql.slice(sql.indexOf('create or replace function lcc_sync_property_owner_to_portfolio'));
  assert.ok(fn.length > 0, 'producer function not found in the migration');

  test('the fill-blanks probe asks about the PROPERTY, not the owner', () => {
    assert.match(fn, /skip_property_has_current_owner/,
      'the property-grained verdict is gone — P117 can mint a second current owner again');
    // The probe must key on the property columns AND on is_current.
    const probe = fn.slice(fn.indexOf('skip_property_has_current_owner') - 800,
                           fn.indexOf('skip_property_has_current_owner'));
    assert.match(probe, /pc\.source_domain\s*=\s*o\.source_domain/, 'probe is not keyed on source_domain');
    assert.match(probe, /pc\.source_property_id::text\s*=\s*o\.source_property_id/, 'probe is not keyed on source_property_id');
    assert.match(probe, /pc\.is_current/, 'probe does not test is_current — a historical row is not a current owner');
  });

  test('the probe excludes the owner it is about, resolved through the survivor', () => {
    // Without this a resolved owner that already holds a current fact under a
    // TOMBSTONE id would be skipped as if somebody else owned the property.
    assert.match(fn, /lcc_entity_survivor\(pc\.entity_id\)\s+is distinct from\s+lcc_entity_survivor\(o\.owner_entity_id\)/,
      'the probe must compare survivors and exclude self');
  });
});

describe('OWN-T0 §2 — nothing is end-dated, deleted or repointed', () => {
  const sql = blankSqlLiterals(stripSqlComments(read(MIGRATION)));

  test('the migration never writes ownership_end_date', () => {
    assert.doesNotMatch(sql, /update\s+(public\.)?lcc_entity_portfolio_facts/i,
      'OWN-T0 must not UPDATE portfolio facts — the multi-current class is dominated by sponsor/SPE pairs where both rows are true');
    assert.doesNotMatch(sql, /delete\s+from\s+(public\.)?lcc_entity_portfolio_facts/i,
      'OWN-T0 must not DELETE portfolio facts');
    assert.doesNotMatch(sql, /set\s+ownership_end_date/i,
      'OWN-T0 must not set an ownership_end_date — we do not hold the date, and inventing one is fabrication');
  });

  test('the only INSERT is P117’s own, unchanged', () => {
    const inserts = sql.match(/insert\s+into\s+lcc_entity_portfolio_facts/gi) || [];
    assert.equal(inserts.length, 1, 'exactly one INSERT (the P117 bridge) is expected');
  });
});

describe('OWN-T0 §3 — the conflict classifier rests on recorded facts', () => {
  const sql = stripSqlComments(read(MIGRATION));
  const fn = sql.slice(sql.indexOf('create or replace function lcc_ownership_conflict_class'),
                       sql.indexOf('create view v_lcc_property_ownership_reconciled'));

  test('no lexical sponsor guess reaches the classifier', () => {
    assert.doesNotMatch(fn, /lcc_tier0_sponsor_brand_token/,
      'A3 measured that detector at 3 of 74 on GSA SPEs and ~25% precision generally — it must not decide an ownership fact');
    assert.doesNotMatch(fn, /lcc_owner_strict_core|nameSimilarity|lcc_normalize_entity_name/,
      'a fuzzy comparator sanctioned elsewhere must be re-graded, not inherited (A2 / P189)');
  });

  test('the sponsor arm reads the CONFIRMED registry', () => {
    assert.match(fn, /lcc_ownership_sponsor_family_token/, 'the confirmed-family arm is gone');
    const reg = sql.slice(sql.indexOf('create or replace function lcc_ownership_sponsor_family_token'));
    assert.match(reg.slice(0, 800), /from lcc_ownership_sponsor_family/,
      'the token must come from the human-confirmed registry');
  });

  test('the default is an honest non-answer', () => {
    assert.match(fn, /return 'unclassified_rival'/,
      'the fall-through must be an explicit "we do not know" — an unearned positive default is the P124 failure');
  });
});

describe('OWN-T0 §4 — the panel view stays a point-query', () => {
  const sql = stripSqlComments(read(MIGRATION));
  const view = sql.slice(sql.indexOf('create view v_lcc_property_ownership_reconciled'),
                         sql.indexOf('create view v_lcc_property_ownership_current'));

  test('every base CTE is inlined so the predicate can push down', () => {
    for (const cte of ['asset', 'fact', 'resolved', 'domain_owner']) {
      assert.match(view, new RegExp(`${cte}\\s+as\\s+not materialized`),
        `${cte} lost "not materialized" — the panel's point query goes from 20 ms to ~1 s (C13b §7.7)`);
    }
  });

  test('a P113 operator is flagged and excluded from the owner count, never dropped', () => {
    // Assert the SUBSTANCE, not the token: `is_owner_candidate` appears in
    // several places, so a bare search stays green when the alias is renamed.
    // What matters is that the owner COUNT excludes the non-owners.
    assert.match(view, /\(en\.is_current and not en\.is_operator and not en\.is_brokerage and not en\.is_placeholder\) as is_owner_candidate/,
      'the owner-candidacy definition is gone or no longer excludes operator/brokerage/placeholder');
    assert.match(view, /count\(\*\) filter \(where f\.is_owner_candidate\) over w as n_current_owners/,
      'n_current_owners must count OWNER CANDIDATES — counting every claim made 884 properties read "conflict" over a P113 operator');
    assert.match(view, /array_agg\(f\.owner_name\) filter \(where f\.is_owner_candidate\)/,
      'the conflict classifier must be handed the owner candidates, not every claim');
    assert.match(view, /only_non_owner_claims/,
      'a property whose only claims are operator/brokerage/placeholder must say so, not read as single_current_owner');
    assert.match(view, /is_operator/, 'the operator flag must still ride on the row');
  });

  test('the chain gap is reported, never bridged', () => {
    assert.match(view, /as gap_before/, 'gap_before is gone');
    assert.doesNotMatch(view, /coalesce\(\s*r?\.?ownership_start_date\s*,\s*(current_date|now\(\))/i,
      'a missing start date must stay NULL — bridging it invents an owner');
  });
});

describe('OWN-T0 §5 — the tab reads ONE store', () => {
  const panel = stripJsComments(read(PANEL));
  const body  = jsFunctionBody(panel, '_udRenderReconciledOwnership', 'window._udRenderReconciledOwnership');

  test('the reconciled renderer consults no second source', () => {
    for (const banned of ['_udCache.ownership', '_udCache.chain', 'v_ownership_current', 'v_ownership_chain',
                          'diaQuery', 'govQuery', 'qFn(', '_udDedupChain']) {
      assert.ok(!body.includes(banned),
        `_udRenderReconciledOwnership reads ${banned} — the ownership answer must come from the reconciled view alone`);
    }
  });

  test('the tab renders the reconciled chain', () => {
    const tab = jsFunctionBody(panel, '_udTabOwnership', '_udOwnerHandoffCard(own, db)');
    assert.match(tab, /_udRenderReconciledOwnership\(\s*_udCache\.ownReconciled/,
      'the Ownership tab must render the reconciled chain');
  });

  test('the domain stores are demoted to a disclosure', () => {
    assert.match(panel, /<details[^>]*><summary[^>]*>Source records/,
      'the domain ownership history must sit behind a "Source records" disclosure, not beside the reconciled chain as an equal claim');
  });

  test('an unreachable reconciler is stated, not rendered as "no owner"', () => {
    assert.match(body, /Reconciled ownership is unavailable/,
      'a null payload must say the reconciler was unreachable — "no owner" and "could not ask" are different facts (C10)');
  });
});

describe('OWN-T0 §6 — the API route', () => {
  const api = stripJsComments(read(HANDLER));
  const block = api.slice(api.indexOf("action === 'ownership_chain'"), api.indexOf("action === 'lookup_asset'"));

  test('it reads the reconciled view and nothing else', () => {
    assert.ok(block.length > 0, 'the ownership_chain action is gone');
    assert.match(block, /v_lcc_property_ownership_reconciled/, 'the route must read the reconciled view');
    for (const banned of ['lcc_entity_portfolio_facts', 'lcc_property_owner?', 'lcc_property_owner_facts', 'domainQuery(']) {
      assert.ok(!block.includes(banned), `the route reaches into ${banned} — the view is the single read`);
    }
  });

  test('a failure surfaces the DB’s own message', () => {
    assert.match(block, /detail:\s*\(r\.data/,
      'a handler that discards the DB message turns a one-line fix into an outage of unknown duration (P132)');
  });

  test('the domain and property_id are validated, not interpolated raw', () => {
    assert.match(block, /domain !== 'dia' && domain !== 'gov'/, 'domain must be an allowlist');
    assert.match(block, /\/\^\\d\{1,18\}\$\//, 'property_id must be numeric-validated');
  });
});

describe('OWN-T0 §7 — positive controls on the guards themselves', () => {
  test('the comment strippers actually remove the prose that quotes the banned shapes', () => {
    const rawSql = read(MIGRATION);
    const sql = stripSqlComments(rawSql);
    // The header quotes the OLD owner-grained predicate while explaining it.
    assert.match(rawSql, /where pf\.entity_id is null;\s+--\s+"FILL-BLANKS"/,
      'the header no longer quotes the old predicate — this control is stale, re-anchor it');
    const rawJs = read(PANEL);
    const js = stripJsComments(rawJs);
    assert.ok(rawJs.includes('v_ownership_current'), 'detail.js should still mention the domain view somewhere');
    assert.ok(js.length < rawJs.length, 'the JS stripper removed nothing');
    assert.ok(sql.length < rawSql.length, 'the SQL stripper removed nothing');
  });

  test('the literal blanker is what keeps the destructive-statement guard honest', () => {
    const commentsOnly = stripSqlComments(read(MIGRATION));
    // The comment-on-function literal quotes the reversal runbook verbatim.
    assert.match(commentsOnly, /Reverse: delete from lcc_entity_portfolio_facts/,
      'the reversal runbook is no longer echoed in a literal — this control is stale, re-anchor it');
    assert.doesNotMatch(blankSqlLiterals(commentsOnly), /Reverse: delete from/,
      'blankSqlLiterals did not blank the literal');
  });

  test('the strippers preserve string literals', () => {
    assert.equal(stripSqlComments("select 'a -- b' as x -- gone"), "select 'a -- b' as x \n");
    assert.equal(stripJsComments("const s = 'a // b'; // gone"), "const s = 'a // b'; \n");
  });
});
