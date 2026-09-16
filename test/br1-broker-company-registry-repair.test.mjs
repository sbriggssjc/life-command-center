// ============================================================================
// BR1/BR3 — broker_companies is a corrupted firm registry: 73 of 131 rows
// carried a literal ';' composite capture artifact ("<firm>; <agent surname>",
// or rarely a genuinely ambiguous multi-party capture), and brokers had
// broker_company_id wired on only 184 of 2,542 rows (7.2%).
//
// This guard reads the migration SOURCE (no live Dialysis_DB connection in
// CI -- the fleet-wide numbers below were measured live on Dialysis_DB
// zqzrriwuavgrquhisnoa on 2026-09-16 and are recorded in the migration
// header, not re-derived here) and pins the SHAPE of the fix: the
// classifier's ambiguity rules, the never-split-a-firm-abbreviation-on-&
// fix, the fill-blanks-only FK discipline, the write guard, and the
// review-lane routing for anything the classifier or backfill cannot
// resolve on evidence alone.
//
// Comments are stripped before matching (A5c/N18/B1/MERGE1 convention)
// because the migration's own header quotes hazardous shapes verbatim while
// explaining why they were removed or avoided.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_PATH =
  'supabase/migrations/dialysis/20260916120000_dia_br1_broker_company_registry_repair.sql';

function stripSqlComments(src) {
  // Strip `-- ...` line comments only, but NEVER inside a single-quoted
  // string literal -- several of this migration's own review-lane messages
  // contain a literal '--' (e.g. "...brokers.company -- never guessed...").
  // A naive line.replace(/--.*$/, '') would swallow that string content as
  // though it were a comment and both corrupt the SQL and blind a test that
  // asserts on that exact message (the OCR1c "blank literals, never strip a
  // bare comment marker inside a string" lesson).
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (!inString && ch === "'" ) {
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
      if (ch === "'") {
        inString = false;
      }
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
  const marker = `function br1_${name}`.toLowerCase();
  const idx = text.toLowerCase().indexOf(marker);
  assert.notEqual(idx, -1, `expected to find function br1_${name}`);
  const start = text.indexOf('as $$', idx);
  assert.notEqual(start, -1, `expected an as $$ body opener for br1_${name}`);
  const end = text.indexOf('$$;', start);
  assert.notEqual(end, -1, `expected a closing $$; for br1_${name}`);
  return text.slice(start, end);
}

// --- 1. The agent-splitter must require whitespace around "&" -------------

test('the agent-token splitter requires whitespace on both sides of "&" (never shreds a tight firm abbreviation like m&m/c&w/b&e)', () => {
  const classify = fnBody(src, 'classify_composite');
  const repair = fnBody(src, 'repair_broker_companies');

  // The regex must be \s+&\s+ (mandatory surrounding whitespace), never a
  // bare '&' or '\s*&\s*' (optional whitespace) -- the latter splits "m&m"
  // into "m","m" and makes the classifier blind to "cole; m&m" naming a
  // second real firm in its agent segment.
  const SPLIT_PATTERN = "regexp_split_to_array(v_rest, '\\s+&\\s+|,\\s*|\\s+and\\s+')";
  const SPLIT_PATTERN_REPAIR = SPLIT_PATTERN.replace('v_rest', 'v_cls.rest');
  assert.ok(classify.includes(SPLIT_PATTERN), 'expected classify_composite to split on the whitespace-guarded & pattern');
  assert.ok(repair.includes(SPLIT_PATTERN_REPAIR), 'expected repair_broker_companies to split on the whitespace-guarded & pattern');

  // Guard against the loose form regressing back in anywhere in the file.
  const LOOSE_PATTERN = "'\\s*(&|,| and )\\s*'";
  assert.ok(!src.includes(LOOSE_PATTERN), 'the loose (zero-whitespace) split pattern must never reappear');
});

// --- 2. Ambiguity rules present and generic (not a hand-enumerated list) ---

test('the classifier flags a multi-semicolon (>2 segment) row as ambiguous, never auto-splits it', () => {
  const classify = fnBody(src, 'classify_composite');
  assert.match(classify, /v_seg_count\s*>\s*2/);
  assert.match(classify, /more than one semicolon/i);
});

test('the classifier flags a mixed delimiter (colon alongside semicolon) as ambiguous', () => {
  const classify = fnBody(src, 'classify_composite');
  assert.match(classify, /p_company_name\s*~\s*':'/);
  assert.match(classify, /mixed delimiter/i);
});

test('the classifier flags reversed-order captures (firm/agent share a prefix) symmetrically, in both directions', () => {
  const classify = fnBody(src, 'classify_composite');
  assert.match(classify, /position\(lower\(v_firm\)\s+in\s+lower\(v_rest\)\)\s*=\s*1/);
  assert.match(classify, /position\(lower\(v_rest\)\s+in\s+lower\(v_firm\)\)\s*=\s*1/);
});

test('the classifier flags an agent token that itself names an existing firm (the "cole; m&m" shape)', () => {
  const classify = fnBody(src, 'classify_composite');
  assert.match(classify, /bc2\.company_name\s*!~\s*';'/);
  assert.match(classify, /itself names another firm in the registry/i);
});

test('the classifier never hand-enumerates a raw string ("colliers"/"m&m"/"cbre") in its ambiguity logic -- the rules are generic', () => {
  const classify = fnBody(src, 'classify_composite');
  for (const literal of ['colliers', 'cbre', 'reichel', 'silver group', 'ccp']) {
    assert.doesNotMatch(classify, new RegExp(literal, 'i'), `br1_classify_composite must not special-case '${literal}' by name`);
  }
});

// --- 3. & is never split when resolving the FIRM segment itself -----------

test('the firm segment (before the first semicolon) is never split on "&" anywhere in the driver', () => {
  const repair = fnBody(src, 'repair_broker_companies');
  // v_cls.firm_seg / firm_seg must flow straight into br1_resolve_firm with
  // no intervening split_to_array call -- only v_cls.rest is ever split.
  const firmUses = [...repair.matchAll(/v_cls\.firm_seg/g)];
  assert.ok(firmUses.length > 0, 'expected the driver to reference v_cls.firm_seg');
  assert.doesNotMatch(repair, /split_to_array\(v_cls\.firm_seg/);
});

// --- 4. Resolution order: exact match, then alias, then mint verbatim -----

test('br1_resolve_firm tries an exact non-composite match, then the alias table, then mints VERBATIM (never an invented expansion)', () => {
  const resolve = fnBody(src, 'resolve_firm');
  const exactIdx = resolve.indexOf('company_name !~');
  const aliasIdx = resolve.indexOf('dia_broker_company_alias');
  const mintIdx = resolve.indexOf('insert into broker_companies');
  assert.ok(exactIdx > -1 && aliasIdx > -1 && mintIdx > -1, 'expected all three resolution branches');
  assert.ok(exactIdx < aliasIdx, 'exact match must be tried before the alias table');
  assert.ok(aliasIdx < mintIdx, 'the alias table must be tried before minting');
  // The mint path must insert the RAW token text, not a synthesized/expanded name.
  assert.match(resolve, /values\s*\(btrim\(p_firm_token\),\s*v_norm,\s*now\(\)\)/);
});

test('the alias table seed is evidence-backed: both rows cite a fuller spelling already present verbatim in broker_companies', () => {
  assert.match(src, /'m&m',\s*br1_norm_token\('m&m'\),\s*v_mm_id/);
  assert.match(src, /'c&w',\s*br1_norm_token\('c&w'\),\s*v_cw_id/);
  assert.match(src, /already present as its own bare canonical row/i);
  assert.match(src, /appears verbatim as the firm-token of another composite row/i);
  // never a hardcoded outside-knowledge full name with no in-table evidence
  assert.doesNotMatch(src, /'kw'\s*,.*'keller williams'/i);
});

// --- 5. Fill-blanks discipline on brokers.broker_company_id ----------------

test('an existing broker_company_id is only ever filled when NULL -- a conflicting non-null value is routed to review, never overwritten', () => {
  const repair = fnBody(src, 'repair_broker_companies');
  const backfill = fnBody(src, 'backfill_broker_company_id');

  assert.match(repair, /elsif v_existing_broker_company_id is null then/i);
  assert.match(repair, /elsif v_existing_broker_company_id <> v_resolved\.company_id then/i);
  assert.match(repair, /existing broker_company_id conflicts with the composite-derived resolution -- never overwritten/i);

  // The fleet-wide backfill only ever targets rows that are still NULL.
  assert.match(backfill, /where broker_company_id is null/i);
  assert.doesNotMatch(backfill, /update brokers set broker_company_id[\s\S]{0,80}where broker_id = v_row\.broker_id\)/i);
});

test('brokers.company text that still contains ";" and has no exact/alias firm match is routed to review, never used to mint a company', () => {
  const backfill = fnBody(src, 'backfill_broker_company_id');
  assert.match(backfill, /no exact or alias match for the firm token in brokers\.company -- never guessed, never used to mint a company/i);
  assert.doesNotMatch(backfill, /insert into broker_companies/i, 'the fleet-wide brokers.company backfill must never mint a new company row');
});

// --- 6. new_broker_id is a GENERATED ALWAYS identity column ---------------

test('a newly minted brokers row never explicitly inserts new_broker_id (it is GENERATED ALWAYS AS IDENTITY)', () => {
  const repair = fnBody(src, 'repair_broker_companies');
  const insertIdx = repair.indexOf('insert into brokers (broker_name, broker_company_id)');
  assert.notEqual(insertIdx, -1);
  assert.doesNotMatch(repair.slice(insertIdx, insertIdx + 200), /new_broker_id/);
});

// --- 7. Every FK off a collapsed composite id is repointed before delete --

test('every FK table referencing broker_companies (brokers, broker_company_history, sale_brokers) is repointed before the composite row is deleted', () => {
  const repair = fnBody(src, 'repair_broker_companies');
  const repointStart = repair.indexOf('if v_row.broker_company_id <> v_resolved.company_id then');
  assert.notEqual(repointStart, -1);
  const deleteIdx = repair.indexOf('delete from broker_companies', repointStart);
  const region = repair.slice(repointStart, deleteIdx);
  for (const table of ['update brokers set broker_company_id', 'update broker_company_history set broker_company_id', 'update sale_brokers set broker_company_id']) {
    assert.match(region, new RegExp(table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `expected ${table} to run before the delete`);
  }
  // and the composite row must be snapshotted (backed up) before deletion
  const backupIdx = repair.indexOf('br1_broker_companies_backup', repointStart);
  assert.ok(backupIdx > -1 && backupIdx < deleteIdx, 'the composite row must be snapshotted before it is deleted');
});

// --- 8. Write guard rejects a NEW composite insert/update ------------------

test('the write guard trigger fires BEFORE INSERT OR UPDATE OF company_name and rejects any value containing ";"', () => {
  const guardFn = fnBody(src, 'guard_no_composite_company_name');
  assert.match(guardFn, /if new\.company_name ~ ';' then/i);
  assert.match(guardFn, /raise exception/i);
  assert.match(src, /before insert or update of company_name on broker_companies/i);
});

// --- 9. SECURITY DEFINER privilege discipline (repo-standard) --------------

test('every new function revokes public/anon/authenticated execute (no SECURITY DEFINER function is left open)', () => {
  for (const fn of [
    'br1_norm_token(text)',
    'br1_classify_composite(text)',
    'br1_resolve_firm(text, text, boolean)',
    'br1_repair_broker_companies(boolean, text)',
    'br1_backfill_broker_company_id(boolean, text)',
    'br1_guard_no_composite_company_name()',
  ]) {
    const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      src,
      new RegExp(`revoke all on function ${escaped} from public, anon, authenticated`, 'i'),
      `expected a revoke stanza for ${fn}`
    );
  }
});

test('every plpgsql/sql function pins a fixed search_path (closes function_search_path_mutable)', () => {
  for (const fn of ['br1_norm_token', 'br1_classify_composite', 'br1_resolve_firm', 'br1_repair_broker_companies', 'br1_backfill_broker_company_id', 'br1_guard_no_composite_company_name']) {
    const body = fnBody(src, fn.replace('br1_', ''));
    // search_path is set on the CREATE FUNCTION statement, which precedes the
    // "as $$" body opener we sliced from -- check the statement immediately
    // preceding the body marker instead.
    const marker = `function br1_${fn.replace('br1_', '')}`.toLowerCase();
    const idx = src.toLowerCase().indexOf(marker);
    const stmtStart = src.lastIndexOf('create or replace function', idx);
    const stmtRegion = src.slice(stmtStart, src.indexOf('as $$', idx));
    assert.match(stmtRegion, /set search_path = public, pg_temp/i, `expected a fixed search_path on ${fn}`);
  }
});

// --- 10. New tables carry RLS + a service_role-only policy -----------------

test('every new BR1 table enables RLS and carries a service_role-only policy', () => {
  for (const table of [
    'br1_broker_companies_backup',
    'br1_broker_backfill_log',
    'dia_broker_company_alias',
    'dia_broker_company_composite_review',
  ]) {
    assert.match(src, new RegExp(`alter table ${table} enable row level security`, 'i'));
    assert.match(src, new RegExp(`create policy br1_service_role_only on ${table}`, 'i'));
  }
});

// --- 11. Reversibility: batch-tagged backup + a written runbook -----------

test('the migration header documents a REVERSAL RUNBOOK keyed on batch_tag', () => {
  assert.match(raw, /REVERSAL RUNBOOK/);
  assert.match(raw, /batch_tag/);
});

test('the parity view flags any broker_count movement not explained by a recorded composite collapse', () => {
  assert.match(src, /v_br1_broker_company_parity/);
  assert.match(src, /composites_collapsed_in/);
  assert.match(src, /anything else moving indicates a wrongful merge/i);
});

// --- 12. Idempotency (measured live, not re-derived here; the header must
//         record the re-run proof) ----------------------------------------

test('the migration header records a measured idempotent re-run (composites_seen without a corresponding write)', () => {
  assert.match(raw, /idempotent/i);
  assert.match(raw, /composites_seen=10/);
  assert.match(raw, /resolved_collapsed=0, companies_minted=0/);
});
