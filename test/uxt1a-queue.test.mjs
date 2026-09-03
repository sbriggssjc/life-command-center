// UX-T1a-queue guard.
//
// Two layers, because neither catches the other's regression:
//   1. BEHAVIOURAL over the pure surface rules (chips, order, paging) -- the gates
//      round had three shape-greps survive their own mutations, so anything that can
//      be exercised by calling the function is.
//   2. SOURCE over the MIGRATION, for the invariants that live only in SQL (the gate
//      states, the refused lexical arms, variant F's OR).
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE ANY SOURCE MATCH. The migration's header explains
// every refused shape by NAMING it -- "reason_to_sell_unmeasured", the 42% regex, `0`,
// `false` -- so a raw-source detector finds them all present and passes over a complete
// revert (A5c / N18 / A1: a fix's own prose satisfies a grep for the bug).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SELLER_QUEUE_CHIPS, SELLER_QUEUE_ORDER, resolveChip, normalizeDomain,
  clampLimit, clampOffset, buildQueuePath, buildChipCountPath, buildPagination,
  SELLER_QUEUE_MAX_LIMIT,
} from '../api/_shared/seller-prospect-queue.js';

const MIGRATION = 'supabase/migrations/20261016120000_lcc_uxt1a_seller_prospect_queue.sql';

/** Strip `--` line comments. SQL has no `#`, and the view body carries no string
 *  literal containing `--`, so a line-comment strip is sufficient and safe here. */
function sqlWithoutComments(src) {
  return src.split('\n').map((line) => {
    const i = line.indexOf('--');
    return i === -1 ? line : line.slice(0, i);
  }).join('\n');
}
const RAW = readFileSync(new URL('../' + MIGRATION, import.meta.url), 'utf8');
const SQL = sqlWithoutComments(RAW);

// ── The comment-stripper itself is positive-controlled ───────────────────────
test('the comment stripper actually removes prose (positive control)', () => {
  assert.ok(RAW.includes('reason_to_sell_unmeasured'), 'raw source names the state');
  assert.ok(/--[^\n]*42%/.test(RAW), 'raw source discusses the 42% regex in a comment');
  assert.ok(!/42%/.test(SQL), 'the stripped source must not carry comment prose');
});

// ── Layer 1: the surface rules, exercised ────────────────────────────────────
test('order is client value first, then lease recency, nullslast on BOTH keys', () => {
  // nullslast on rank_value: an unpriced row is NULL (P180), and Postgres sorts NULLs
  // FIRST on a DESC key -- without it the queue would be headed by the rows nobody can
  // price, the exact inversion of "ranked by client value".
  assert.equal(SELLER_QUEUE_ORDER, 'rank_value.desc.nullslast,years_into_term.asc.nullslast');
  const path = buildQueuePath({ chipKey: 'all', domain: null, limit: 50, offset: 0 });
  assert.ok(path.includes('order=rank_value.desc.nullslast,years_into_term.asc.nullslast'));
});

test('a chip filters SERVER-side, and its count query carries the SAME predicate', () => {
  for (const chip of SELLER_QUEUE_CHIPS) {
    const list = buildQueuePath({ chipKey: chip.key, domain: null, limit: 50, offset: 0 });
    const count = buildChipCountPath({ chipKey: chip.key, domain: null });
    if (chip.where) {
      assert.ok(list.includes('&' + chip.where), `list carries ${chip.key} predicate`);
      assert.ok(count.includes('&' + chip.where), `count carries ${chip.key} predicate`);
    } else {
      // `all` adds no predicate on either side.
      assert.ok(!/reason_debt|newer_lease=|reach_state=/.test(list));
      assert.ok(!/reason_debt|newer_lease=|reach_state=/.test(count));
    }
  }
});

test('every chip count reads the SAME view the list reads', () => {
  // A chip counted off a different object is the C10 class: two surfaces, one label.
  for (const chip of SELLER_QUEUE_CHIPS) {
    assert.ok(buildChipCountPath({ chipKey: chip.key, domain: null })
      .startsWith('v_lcc_seller_prospect_queue?'), chip.key);
  }
});

test('the domain filter reaches both the list and the chip counts', () => {
  assert.ok(buildQueuePath({ chipKey: 'debt', domain: 'government', limit: 10, offset: 0 })
    .includes('source_domain=eq.gov'));
  assert.ok(buildChipCountPath({ chipKey: 'debt', domain: 'dialysis' })
    .includes('source_domain=eq.dia'));
  assert.ok(!buildQueuePath({ chipKey: 'all', domain: 'all', limit: 10, offset: 0 })
    .includes('source_domain='));
});

test('an unknown chip falls back to All, never to an empty page', () => {
  assert.equal(resolveChip('nope').key, 'all');
  assert.equal(resolveChip(undefined).key, 'all');
});

test('domain normalisation accepts both spellings and passes "all" through as no filter', () => {
  assert.equal(normalizeDomain('government'), 'gov');
  assert.equal(normalizeDomain('dialysis'), 'dia');
  assert.equal(normalizeDomain('gov'), 'gov');
  assert.equal(normalizeDomain(''), null);
  assert.equal(normalizeDomain('both'), null);
});

test('limit is clamped and offset never goes negative', () => {
  assert.equal(clampLimit('999'), SELLER_QUEUE_MAX_LIMIT);
  assert.equal(clampLimit('0'), 1);
  assert.equal(clampLimit('abc'), 50);
  assert.equal(clampOffset('-5'), 0);
  assert.equal(clampOffset('100'), 100);
});

test('pagination reports an exact total and a real has_more', () => {
  const p = buildPagination({ total: 520, limit: 50, offset: 100 });
  assert.equal(p.total, 520);
  assert.equal(p.page, 3);
  assert.equal(p.total_pages, 11);
  assert.equal(p.has_more, true);
  assert.equal(buildPagination({ total: 520, limit: 50, offset: 500 }).has_more, false);
});

test('an UNKNOWN total is null, never 0 — and has_more is null, never false', () => {
  // A pager that reads "0 of 0" over an uncounted page hides the rest of the lane
  // exactly like A1's research page, which served the same first 50 of 545 forever.
  const p = buildPagination({ total: null, limit: 50, offset: 0 });
  assert.equal(p.total, null);
  assert.equal(p.total_pages, null);
  assert.equal(p.has_more, null);
});

// ── Layer 2: the SQL invariants ──────────────────────────────────────────────
test('variant F is an OR of the two signals, never an AND', () => {
  // Variant A (both required) is 23 rows. §0.3 lists newer lease and a reason to sell
  // as characteristics of the sweet spot, and a maturing loan on a MID-TERM lease is a
  // strong prospect that an AND would throw away.
  const m = SQL.match(/WHERE\s+in_band IS TRUE\s+AND\s+\(([^)]*)\)/i);
  assert.ok(m, 'the queue view states its variant-F predicate');
  assert.ok(/newer_lease IS TRUE\s+OR\s+reason_to_sell <> 'reason_to_sell_unmeasured'/.test(m[1]),
    'the two signals are alternatives');
  assert.ok(!/newer_lease IS TRUE\s+AND\s+reason_to_sell/.test(SQL));
});

test('value_unknown yields a NULL in_band, never false and never 0', () => {
  assert.ok(/CASE WHEN g\.value IS NULL THEN NULL\s*\n?\s*ELSE g\.value BETWEEN 2500000 AND 25000000 END AS in_band/.test(SQL),
    'in_band is NULL when the value cannot be sized');
  assert.ok(!/COALESCE\(g\.value, 0\)/.test(SQL), 'value is never coalesced to 0');
});

test('term_unknown yields a NULL newer_lease, never false', () => {
  assert.ok(/CASE WHEN g\.newer_lease_basis = 'term_unknown' THEN NULL/.test(SQL),
    '"we cannot tell" is not "the lease is old"');
});

test('no_linked_person is its own reach state, not folded into never_touched', () => {
  // 847 of 6,480 owners have a linked person: the binding constraint is missing LINKS,
  // not missing touches (C11). Folding them together reports a prospecting gap where
  // the real gap is a data gap.
  assert.ok(/WHEN rc\.owner_id IS NULL THEN 'no_linked_person'/.test(SQL));
  assert.ok(/ELSE 'never_touched'/.test(SQL));
  assert.ok(/'in_pipeline_untouched'/.test(SQL));
});

test('reach counts a linked PERSON entity and only human categories', () => {
  // Owner-entity-only is a false floor (19); any-linked-entity is a false ceiling
  // (1,024, importing machine-written ASSET events). Person link + human category = 33.
  assert.ok(/entity_type = 'person'/.test(SQL), 'links are person-typed');
  assert.ok(/ae\.category IN \('email','call','meeting'\)/.test(SQL), 'human categories only');
  assert.ok(!/entity_type = 'asset'/.test(SQL));
});

test('reason_to_sell carries only RECORDED arms — no lexical death/divorce rule', () => {
  // The audit's own measurement regex false-positived at 42% on first contact (111 of
  // 265 matched the phrase "REAL ESTATE"). This repo has measured comparable lexical
  // arms at 25% / 7% / 4-of-6 and refused all of them.
  assert.ok(/'debt'/.test(SQL) && /'value_creation_developer'/.test(SQL));
  // ⚠️ ANCHORED ON THE CASE'S ELSE ARM, NOT ON THE TOKEN. A bare search for the string
  // survived its own mutation: the queue view's WHERE clause names it too, so replacing
  // the SELECT's `ELSE 'reason_to_sell_unmeasured'` with `ELSE 'none'` left this green.
  // Found by the mutation pass, not by reading the assertion.
  assert.ok(/ELSE 'reason_to_sell_unmeasured' END AS reason_to_sell/.test(SQL),
    'the absence is an explicit STATE, not "none"');
  for (const banned of [/\\mestate\\M/, /\\mtrust\\M/, /~\*/, /ilike/i]) {
    assert.ok(!banned.test(SQL), `no lexical reason-to-sell arm: ${banned}`);
  }
});

test('the debt arm is keyed on the PROPERTY, not just the owner', () => {
  // A loan is secured by a specific asset, so a maturity is a reason to sell THAT
  // building. Owner-scoping admits 615 rows instead of 520 -- 95 that ride in on a loan
  // against a different property.
  assert.ok(/LEFT JOIN debt dbt ON dbt\.entity_id = g\.entity_id[\s\S]{0,220}?dbt\.source_property_id = g\.source_property_id/.test(SQL),
    'the debt join carries domain AND property');
});

test('the value ladder is domain-aware and never uses sale_price', () => {
  // dia carries ZERO noi; gov's NOI/rent ratio is the 0.703 FS haircut. And
  // facts.sale_price is a PORTFOLIO trade price attributed per property (ratio p50
  // 0.164 at 5+ properties per price), so it would admit portfolio assets as band deals.
  assert.ok(/source_domain = 'gov' AND b\.noi > 0 THEN 'noi_div_cap'/.test(SQL));
  assert.ok(/source_domain = 'dia' AND b\.annual_rent > 0 THEN 'net_rent_div_cap'/.test(SQL));
  assert.ok(/0\.703/.test(SQL), 'the gov FS haircut is applied to a rent-only gov row');
  assert.ok(!/sale_price/.test(SQL), 'sale_price is never the band value');
});

test('the owner guards and the tombstone guard are all present', () => {
  for (const g of ['lcc_owner_name_is_brokerage', 'lcc_is_placeholder_owner_name',
                   'lcc_owner_name_is_not_prospected']) {
    assert.ok(SQL.includes(g), g);
  }
  // ⚠️ THE TOMBSTONE GUARD IS ANCHORED ON THE `base` JOIN, NOT ON THE TOKEN.
  // `merged_into_entity_id IS NULL` legitimately appears three more times (both arms of
  // the person-link CTE), so a file-wide search stayed GREEN after the guard was deleted
  // from the join that decides which owners enter the queue at all -- the documented
  // "a guard that matches a shape is defeated by a name that appears elsewhere", found
  // by the mutation pass. P175: existence is not liveness.
  assert.ok(/JOIN public\.entities e\s*\n\s*ON e\.id = f\.entity_id\s*\n(?:\s*--[^\n]*\n)*\s*AND e\.merged_into_entity_id IS NULL/.test(RAW),
    'the owner join excludes tombstones');
});

test('the multi-label role view is de-duplicated before it is joined', () => {
  // v_lcc_entity_roles is multi-label (C13b): joining it raw fans the row out once per
  // role, silently multiplying the queue.
  assert.ok(/SELECT DISTINCT rr\.entity_id[\s\S]{0,200}v_lcc_entity_roles/.test(SQL));
});

test('the funnel summary counts the excluded populations, not just the queue', () => {
  for (const bucket of ['value_unknown', 'in_band_term_unknown', 'in_band_older_lease',
                        'excluded_touched', 'variant_f_before_reach', 'queue']) {
    assert.ok(SQL.includes(`'${bucket}'`), bucket);
  }
});

// ── The handler is wired end to end ──────────────────────────────────────────
test('the route is mounted in server.js and dispatched in admin.js', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.ok(/\/api\/seller-prospect-queue[\s\S]{0,120}_route = 'seller-prospect-queue'/.test(server));
  const admin = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
  assert.ok(/case 'seller-prospect-queue':\s*return handleSellerProspectQueue/.test(admin));
  // The response must carry the pagination block, or the renderer draws no pager (A1).
  assert.ok(/pagination: buildPagination\(/.test(admin));
});
