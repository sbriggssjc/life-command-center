// EB1 — structural guard for the market-brief foundation migration.
//
// There is no live DB in this environment, so these are SQL-source structural
// tests (the b1-chain-value-floor-split.test.mjs pattern): comments are
// stripped BEFORE matching (the migration's own header discusses staleness,
// supersede chains and RLS at length, so a naive grep would match the prose
// explaining the design and pass over its deletion — the A5c/N18/OCR1c
// defect class, inside a test). Assertions anchor on stable identity tokens
// (table/view/column/constraint names), never on a line number or a sliced
// region.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const FILES = readdirSync('supabase/migrations').filter((f) => f.includes('lcc_eb1_exec_briefs_foundation'));

test('the EB1 foundation migration exists exactly once', () => {
  assert.equal(FILES.length, 1, `expected exactly one EB1 foundation migration, found: ${FILES.join(', ')}`);
});

const RAW = FILES.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');

// Strip line comments (--...) only where they are not inside a dollar-quoted
// string literal — the migration's plpgsql function bodies are the only
// dollar-quoted content here and contain no `--` themselves, so a plain
// line-comment strip is safe (verified below with a positive control).
const SQL = RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('comment stripping actually removes prose, and the positive control proves it', () => {
  // The header discusses the design at length — confirm the RAW file has it,
  // and confirm the STRIPPED sql does not, or every assertion below is
  // testing prose instead of code.
  // "P123's whole point" only appears inside a `--` line comment (the
  // COMMENT ON ... IS string literals discuss the same ideas in different
  // words, which is fine — those are real SQL content, not prose to strip).
  assert.match(RAW, /P123's whole point/i);
  assert.doesNotMatch(SQL, /P123's whole point/i, 'comment stripping is broken — assertions below are unreliable');
  assert.match(RAW, /not a generated document/i);
  assert.doesNotMatch(SQL, /not a generated document/i);
});

test('all five tables are created', () => {
  for (const t of [
    'market_brief_facts',
    'market_brief_issues',
    'build_brief_snapshots',
    'operator_notes',
    'producer_runs',
  ]) {
    assert.match(SQL, new RegExp(`create table if not exists public\\.${t}\\s*\\(`, 'i'),
      `table ${t} not created`);
  }
});

test('market_brief_facts.lane is constrained to exactly the four spec swimlanes', () => {
  const m = SQL.match(/CONSTRAINT chk_mbf_lane CHECK \(lane IN \(([^)]+)\)\)/i);
  assert.ok(m, 'chk_mbf_lane constraint not found');
  const lanes = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(lanes.sort(), ['broad_net_lease', 'dialysis', 'government', 'net_lease'].sort());
});

test('market_brief_facts.section is constrained to exactly the five spec sections', () => {
  const m = SQL.match(/CONSTRAINT chk_mbf_section CHECK \(section IN \(([^)]+)\)\)/i);
  assert.ok(m, 'chk_mbf_section constraint not found');
  const sections = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(
    sections.sort(),
    ['capital_markets', 'implications', 'operators', 'policy', 'trades'].sort(),
  );
});

test('market_brief_facts.status carries the full live/superseded/expired/conflict lifecycle', () => {
  const m = SQL.match(/CONSTRAINT chk_mbf_status CHECK \(status IN \(([^)]+)\)\)/i);
  assert.ok(m);
  const statuses = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(statuses.sort(), ['conflict', 'expired', 'live', 'superseded'].sort());
});

test('market_brief_facts has a stale_after column and a supersedes_id self-FK with a no-self-cycle guard', () => {
  assert.match(SQL, /stale_after\s+timestamptz/i);
  assert.match(SQL, /supersedes_id\s+uuid\s+REFERENCES public\.market_brief_facts\(id\)/i);
  assert.match(SQL, /CONSTRAINT chk_mbf_no_self_supersede CHECK \(supersedes_id IS NULL OR supersedes_id <> id\)/i);
});

test('market_brief_facts has an idempotency unique index on the source-identity natural key', () => {
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_mbf_source_identity[\s\S]*?ON public\.market_brief_facts \(lane, section, source_url, source_date, claim_text\)/i,
  );
});

test('market_brief_issues freezes fact_ids and enforces one issue per (lane, issue_type, issue_date)', () => {
  assert.match(SQL, /fact_ids\s+uuid\[\]\s+NOT NULL DEFAULT '\{\}'/i);
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_mbi_lane_type_date[\s\S]*?ON public\.market_brief_issues \(lane, issue_type, issue_date\)/i,
  );
});

test('operator_notes covers every spec §6 channel and every disposition value', () => {
  const chanM = SQL.match(/CONSTRAINT chk_on_channel CHECK \(channel IN \(([\s\S]*?)\)\)/i);
  assert.ok(chanM, 'chk_on_channel not found');
  const channels = chanM[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  for (const c of ['outlook_reply', 'outlook_tagged', 'in_app_note', 'teams', 'mcp', 'cowork']) {
    assert.ok(channels.includes(c), `channel ${c} missing from chk_on_channel`);
  }

  const dispM = SQL.match(/CONSTRAINT chk_on_disposition CHECK \(disposition IN \(([\s\S]*?)\)\)/i);
  assert.ok(dispM, 'chk_on_disposition not found');
  const dispositions = dispM[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  for (const d of ['open', 'routed', 'in_progress', 'closed', 'superseded', 'refuted']) {
    assert.ok(dispositions.includes(d), `disposition ${d} missing from chk_on_disposition`);
  }
});

test('producer_runs is opened at entry (default started) and a skip must carry a reason', () => {
  assert.match(SQL, /status\s+text\s+NOT NULL DEFAULT 'started'/i);
  assert.match(
    SQL,
    /CONSTRAINT chk_pr_skip_has_reason CHECK \(status <> 'skipped' OR skip_reason IS NOT NULL\)/i,
  );
  const stM = SQL.match(/CONSTRAINT chk_pr_status CHECK \(status IN \(([^)]+)\)\)/i);
  assert.ok(stM);
  const statuses = stM[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(statuses.sort(), ['completed', 'failed', 'skipped', 'started'].sort());
});

test('RLS is enabled and both a service_role-all and an authenticated-read policy exist for every new table', () => {
  const tables = ['market_brief_facts', 'market_brief_issues', 'build_brief_snapshots', 'operator_notes', 'producer_runs'];
  assert.match(SQL, /tbls text\[\] := ARRAY\[/);
  for (const t of tables) {
    assert.match(SQL, new RegExp(`'${t}'`), `${t} missing from the RLS-enable array`);
  }
  // The policy names are built as t || '_service_role_all' / '_authenticated_read'
  // inside a DO block (format('CREATE POLICY %I ...')) — assert the two
  // literal templates exist rather than expanding the loop.
  assert.match(SQL, /'_service_role_all'/);
  assert.match(SQL, /'_authenticated_read'/);
  assert.match(SQL, /FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/);
  assert.match(SQL, /FOR SELECT TO authenticated USING \(true\)/);
});

test('v_market_brief_live filters to status=live and exposes a computed is_stale, never a stored one', () => {
  const start = SQL.indexOf('CREATE OR REPLACE VIEW public.v_market_brief_live');
  assert.notEqual(start, -1);
  const end = SQL.indexOf(';', SQL.indexOf('CREATE OR REPLACE VIEW public.v_market_brief_staleness'));
  const body = SQL.slice(start, SQL.indexOf('CREATE OR REPLACE VIEW public.v_market_brief_staleness'));
  assert.match(body, /WHERE f\.status = 'live'/i);
  assert.match(body, /f\.stale_after IS NOT NULL AND f\.stale_after <= now\(\)\)\s+AS is_stale/i);
  void end;
});

test('v_market_brief_staleness cross-joins every (lane, section) cell BEFORE left-joining facts (Class 20)', () => {
  const start = SQL.indexOf('CREATE OR REPLACE VIEW public.v_market_brief_staleness');
  assert.notEqual(start, -1);
  const end = SQL.indexOf('$$', start) === -1 ? SQL.indexOf('GRANT SELECT ON public.v_market_brief_staleness', start) : start;
  const body = SQL.slice(start, SQL.indexOf('GRANT SELECT ON public.v_market_brief_staleness', start));
  assert.match(body, /CROSS JOIN sections s/i, 'the view must cross-join lanes x sections into a cells CTE');
  assert.match(body, /LEFT JOIN fact_agg fa ON fa\.lane = c\.lane AND fa\.section = c\.section/i);
  assert.match(body, /is_missing/i);
  void end;
});

test('v_market_brief_staleness reports live/stale as two DISTINCT counts, not one lumped bucket', () => {
  const start = SQL.indexOf('CREATE OR REPLACE VIEW public.v_market_brief_staleness');
  const body = SQL.slice(start, SQL.indexOf('GRANT SELECT ON public.v_market_brief_staleness', start));
  // live = status live AND not past stale_after
  assert.match(body, /count\(\*\) FILTER \(WHERE f\.status = 'live' AND \(f\.stale_after IS NULL OR f\.stale_after > now\(\)\)\) AS live_count/i);
  // stale = status STILL live but past stale_after (a real fact this file's
  // doctrine insists on: stale_after crossing does not silently flip status)
  assert.match(body, /count\(\*\) FILTER \(WHERE f\.status = 'live' AND f\.stale_after IS NOT NULL AND f\.stale_after <= now\(\)\) AS stale_count/i);
});

test('v_market_brief_staleness joins the LATEST producer_runs row per lane, not an unordered pick', () => {
  const start = SQL.indexOf('CREATE OR REPLACE VIEW public.v_market_brief_staleness');
  const body = SQL.slice(start, SQL.indexOf('GRANT SELECT ON public.v_market_brief_staleness', start));
  assert.match(body, /DISTINCT ON \(pr\.lane\)/i);
  assert.match(body, /ORDER BY pr\.lane, pr\.started_at DESC/i);
});
