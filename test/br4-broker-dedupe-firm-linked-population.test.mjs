// ============================================================================
// BR4 — broker dedupe against the firm-linked population. Reads the migration
// SOURCE (no live Dialysis_DB connection in CI -- the fleet-wide numbers
// below were measured live on Dialysis_DB zqzrriwuavgrquhisnoa on 2026-09-17
// and are recorded in the migration header, not re-derived here) and pins
// the SHAPE of the fix: same-name/different-company groups are never
// merged, a merge repoints every enumerated FK before deleting the loser, a
// minted firm always carries corroborating evidence in its ledger row, and
// the classifier reads NULL vs non-null broker_company_id correctly.
//
// Comments are stripped before matching (A5c/N18/B1/MERGE1 convention)
// because the migration's own header and inline comments quote hazardous
// shapes verbatim while explaining why they are avoided.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_PATH =
  'supabase/migrations/dialysis/20260917120000_dia_br4_broker_dedupe_firm_linked_population.sql';

function stripSqlComments(src) {
  // Strip `-- ...` line comments only, never inside a single-quoted string
  // literal (several of this migration's own review-lane messages contain a
  // literal '--', e.g. "...brokers.company -- never guessed...").
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (!inString && ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === "'" && next === "'") {
        out += "''";
        i++;
        continue;
      }
      if (ch === "'") inString = false;
      out += ch;
      continue;
    }
    if (ch === '-' && next === '-') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

const raw = readFileSync(join(ROOT, MIGRATION_PATH), 'utf8');
const src = stripSqlComments(raw);

function fnBody(text, name) {
  const marker = `function br4_${name}`.toLowerCase();
  const idx = text.toLowerCase().indexOf(marker);
  assert.notEqual(idx, -1, `expected to find function br4_${name}`);
  const start = text.indexOf('as $$', idx);
  assert.notEqual(start, -1, `expected an as $$ body opener for br4_${name}`);
  const end = text.indexOf('$$;', start);
  assert.notEqual(end, -1, `expected a closing $$; for br4_${name}`);
  return text.slice(start, end);
}

// --- 1. The classification view never treats a null-company row as a match

test('the classification view distinguishes NULL broker_company_id from a real one -- both-null groups and one-linked/one-blank groups never read as a true duplicate', () => {
  const idx = src.toLowerCase().indexOf('view v_br4_broker_dup_group_classification');
  assert.notEqual(idx, -1);
  const end = src.indexOf(';', src.indexOf('order by classification, norm_name', idx));
  const view = src.slice(idx, end);
  assert.match(view, /filter\s*\(where broker_company_id is not null\)/i);
  assert.match(view, /both_or_all_blank_company/);
  assert.match(view, /one_linked_one_blank_noted_only/);
  assert.match(view, /different_companies_never_merge/);
  // the eligible-to-merge class requires no blank sibling and exactly one non-null company id
  assert.match(view, /when n_blank > 0 then 'one_linked_one_blank_noted_only'/i);
  assert.match(view, /array_length\(non_null_company_ids,\s*1\)\s*>\s*1\s*then\s*'different_companies_never_merge'/i);
});

// --- 2. Same name, different company -- NEVER merged -----------------------

test('a same-name group with more than one distinct non-null broker_company_id is classified never_merge and the merge driver only ever selects true_duplicate_candidate', () => {
  const merge = fnBody(src, 'merge_broker_duplicates');
  assert.match(merge, /where classification = 'true_duplicate_candidate'/i);
  assert.doesNotMatch(merge, /different_companies_never_merge/i, 'the merge driver must never reference the never-merge classification -- it should be structurally unreachable, not filtered out at runtime');
});

// --- 3. A ';'-composite broker_name is routed to review, never merged ------

test('a true-duplicate group whose broker_name is itself a \';\'-composite shape is routed to the review lane, never auto-merged', () => {
  const view = src.slice(src.toLowerCase().indexOf('view v_br4_broker_dup_group_classification'));
  assert.match(view, /any_composite_shape\s+then\s+'true_duplicate_but_composite_shape_review'/i);
  const route = fnBody(src, 'route_unmergeable_duplicates_to_review');
  assert.match(route, /true_duplicate_but_composite_shape_review/);
  assert.match(route, /true_duplicate_contact_conflict_review/);
});

// --- 4. Every enumerated FK is repointed before the loser is deleted -------

test('every FK column referencing brokers.broker_id (13 constraints across 11 tables) is repointed before the loser row is deleted', () => {
  const merge = fnBody(src, 'merge_broker_duplicates');
  const repointStart = merge.indexOf("foreach v_loser_id in array v_grp.broker_ids loop");
  const deleteIdx = merge.indexOf('delete from brokers where broker_id = v_loser_id', repointStart);
  assert.notEqual(repointStart, -1);
  assert.notEqual(deleteIdx, -1);
  const region = merge.slice(repointStart, deleteIdx);
  const expectedFks = [
    'sales_transactions set listing_broker_id',
    'sales_transactions set procuring_broker_id',
    'contacts set known_broker',
    'broker_company_history set broker_id',
    'broker_market_coverage set broker_id',
    'available_listings set broker_id',
    'available_portfolios set listing_broker_id',
    'available_portfolios set procuring_broker_id',
    'broker_market_summary set broker_id',
    'sales_portfolios set listing_broker_id',
    'sales_portfolios set procuring_broker_id',
    'loans set broker_id',
    'sale_brokers set broker_id',
  ];
  for (const fk of expectedFks) {
    assert.match(region, new RegExp('update\\s+' + fk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `expected ${fk} to be repointed before the delete`);
  }
  // and the loser row must be snapshotted before it is deleted
  const backupIdx = merge.indexOf('dia_br4_broker_merge_log', repointStart);
  assert.ok(backupIdx > -1 && backupIdx < deleteIdx, 'the loser row must be snapshotted before it is deleted');
});

test('sale_brokers (UNIQUE(sale_id, broker_id, role)) drops only the loser row that duplicates one the survivor already holds -- never a blind repoint', () => {
  const merge = fnBody(src, 'merge_broker_duplicates');
  const idx = merge.indexOf('sale_brokers');
  const region = merge.slice(idx, merge.indexOf('sale_brokers.broker_id', idx) + 40);
  assert.match(region, /delete from sale_brokers/i);
  assert.match(region, /sb2\.sale_id\s*=\s*sb\.sale_id/i);
  assert.match(region, /sb2\.role is not distinct from sb\.role/i);
});

// --- 5. Fill-blanks only -- a survivor never has a populated field overwritten

test('the survivor only ever receives a fill-blank -- a populated company/email/phone is never overwritten by the loser', () => {
  const merge = fnBody(src, 'merge_broker_duplicates');
  assert.match(merge, /if v_survivor_row\.company is null and v_loser_row\.company is not null then/i);
  assert.match(merge, /if v_survivor_row\.email is null and v_loser_row\.email is not null then/i);
  assert.match(merge, /if v_survivor_row\.phone is null and v_loser_row\.phone is not null then/i);
});

// --- 6. Survivor selection is evidence-based, deterministic ---------------

test('survivor selection ranks by FK-link count, then populated contact fields, then recency -- never "first row wins"', () => {
  const merge = fnBody(src, 'merge_broker_duplicates');
  const idx = merge.indexOf('v_cand_score.link_count > v_best_link_count');
  assert.notEqual(idx, -1, 'expected link_count to be the primary ranking key');
  const secondIdx = merge.indexOf('v_cand_score.contact_field_count > v_best_contact_count');
  assert.notEqual(secondIdx, -1);
  const thirdIdx = merge.indexOf('v_cand_score.created_at > v_best_created_at');
  assert.notEqual(thirdIdx, -1);
  assert.ok(idx < secondIdx && secondIdx < thirdIdx, 'expected the ranking order: link_count, then contact fields, then recency');
});

test('the evidence-score function enumerates every referencing table, not a subset', () => {
  const score = fnBody(src, 'broker_evidence_score');
  for (const table of [
    'sales_transactions', 'sale_brokers', 'available_listings', 'available_portfolios',
    'sales_portfolios', 'loans', 'contacts', 'broker_company_history',
    'broker_market_coverage', 'broker_market_summary',
  ]) {
    assert.match(score, new RegExp(`from ${table} `), `expected the evidence score to count links in ${table}`);
  }
});

// --- 7. Firm minting requires independent corroborating evidence -----------

test('a firm string only mints when >=3 distinct brokers share it AND >=2 of them share one email domain -- never on count alone', () => {
  const sigIdx = src.toLowerCase().indexOf('function br4_resolve_unmatched_firm_strings(');
  assert.notEqual(sigIdx, -1);
  const sig = src.slice(sigIdx, src.indexOf('as $$', sigIdx));
  assert.match(sig, /p_min_brokers int default 3/);
  assert.match(sig, /p_min_domain_brokers int default 2/);
  const resolve = fnBody(src, 'resolve_unmatched_firm_strings');
  assert.match(resolve, /if v_grp\.n_on_domain is null or v_grp\.n_on_domain < p_min_domain_brokers then/i);
});

test('the firm resolver reuses br1_resolve_firm as the sole minting path -- it never inserts into broker_companies itself', () => {
  const resolve = fnBody(src, 'resolve_unmatched_firm_strings');
  assert.match(resolve, /select \* into v_resolved from br1_resolve_firm\(/i);
  assert.doesNotMatch(resolve, /insert into broker_companies/i);
});

test('a minted firm always records evidence (norm_firm, broker count, dominant domain, domain count) in the ledger', () => {
  const resolve = fnBody(src, 'resolve_unmatched_firm_strings');
  const insertIdx = resolve.indexOf('insert into dia_br4_firm_mint_evidence');
  assert.notEqual(insertIdx, -1);
  const region = resolve.slice(insertIdx, insertIdx + 400);
  assert.match(region, /norm_firm/);
  assert.match(region, /n_brokers_in_group/);
  assert.match(region, /dominant_email_domain/);
  assert.match(region, /n_brokers_on_domain/);
});

test('the evidence table schema requires the evidence columns to be populated for a mint (broker_company_id and norm_firm are NOT NULL)', () => {
  const idx = src.toLowerCase().indexOf('create table if not exists dia_br4_firm_mint_evidence');
  assert.notEqual(idx, -1);
  const region = src.slice(idx, src.indexOf(');', idx));
  assert.match(region, /broker_company_id bigint not null references broker_companies/i);
  assert.match(region, /norm_firm text not null/i);
  assert.match(region, /broker_ids int\[\] not null/i);
});

test('a junk-shaped firm token (an address fragment, a digit-led token, or an over-long run-on) is excluded from minting even if it clears the count thresholds', () => {
  const resolve = fnBody(src, 'resolve_unmatched_firm_strings');
  assert.match(resolve, /,\\s\*\[a-z\]\{2\}\\s\+\\d\{5\}/);
  assert.match(resolve, /v_grp\.norm_firm\s*~\s*'\^\\d'/);
  assert.match(resolve, /length\(v_grp\.norm_firm\)\s*>\s*60/);
});

test('the mint representative text is drawn verbatim from the raw source data -- never a fabricated or expanded spelling', () => {
  const resolve = fnBody(src, 'resolve_unmatched_firm_strings');
  const idx = resolve.indexOf('select btrim(split_part(raw_text');
  assert.notEqual(idx, -1);
  assert.doesNotMatch(resolve.slice(0, idx), /values\s*\(\s*'[A-Z]/, 'no hardcoded/invented firm-name literal should appear before the representative-text query');
});

// --- 8. Non-broker (firm/operator-shaped) rows are flagged, never merged or deleted

test('a firm/operator-shaped brokers.broker_name is flagged into the review lane -- the flagging function never merges or deletes', () => {
  const flag = fnBody(src, 'flag_nonperson_broker_rows');
  assert.doesNotMatch(flag, /delete from brokers/i);
  assert.doesNotMatch(flag, /update brokers set broker_id/i);
  assert.match(flag, /org_marker/);
  assert.match(flag, /known_dialysis_operator_name/);
  assert.match(flag, /matches_operators_registry/);
  assert.match(flag, /never merged, never deleted/i);
});

test('the org-marker regex requires a word boundary (\\y) so it cannot match a substring inside an unrelated name', () => {
  const flag = fnBody(src, 'flag_nonperson_broker_rows');
  assert.match(flag, /\\y\(llc\|/);
});

// --- 9. Dry-run default on every driver function ---------------------------

test('every BR4 driver function defaults p_dry_run to true', () => {
  for (const name of ['merge_broker_duplicates', 'route_unmergeable_duplicates_to_review', 'resolve_unmatched_firm_strings', 'flag_nonperson_broker_rows']) {
    const sigIdx = src.toLowerCase().indexOf(`function br4_${name}(`);
    assert.notEqual(sigIdx, -1, `expected function br4_${name}`);
    const sigEnd = src.indexOf(')', src.indexOf('returns table', sigIdx) > -1 ? src.indexOf('(', sigIdx) : sigIdx);
    const openParen = src.indexOf('(', sigIdx);
    const closeParen = src.indexOf(')\nreturns table', openParen);
    const header = src.slice(openParen, closeParen === -1 ? openParen + 300 : closeParen);
    assert.match(header, /p_dry_run boolean default true/i, `expected ${name} to default p_dry_run to true`);
  }
});

// --- 10. Reversibility: batch tag + snapshot on every write -----------------

test('every merge is batch-tagged and snapshots the full dropped row before delete', () => {
  const merge = fnBody(src, 'merge_broker_duplicates');
  assert.match(merge, /v_snapshot\s*:=\s*to_jsonb\(v_loser_row\)/i);
  assert.match(merge, /batch_tag, survivor_broker_id, dropped_broker_id, action, row_snapshot, fk_repoints, filled_fields, note/i);
});

test('the migration header documents a reversal runbook naming the exact restore query', () => {
  assert.match(raw, /REVERSAL RUNBOOK/i);
  assert.match(raw, /INSERT INTO brokers/i);
  assert.match(raw, /ON CONFLICT \(broker_id\) DO NOTHING/i);
});
