// ENTC (2026-09-03) — PR5c-entities-c-junk80 + PR5c-entities-c-p195-unmerge.
//
// Comments are stripped before every source assertion: the fixes explain
// themselves by naming the exact shapes they removed ("on conflict (id) do
// update", "isJunkContactName", "tm_misparse"), so a raw-source grep finds them
// all present and passes over a complete revert (A5c / N18 / OCR1c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planContactMinting } from '../api/_shared/tm-misparse.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// strip /* */ and // comments, then blank string literals — comments FIRST, or a
// bare apostrophe in ordinary prose opens a string the scanner never closes.
function bare(src) {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/^\s*--[^\n]*/gm, ' ');
  return noComments;
}
function noLiterals(src) {
  return bare(src).replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

const MIGRATION = read('../supabase/migrations/20261014120000_lcc_entc_p195_unmerge_fix.sql');
const CENSUS    = read('../supabase/migrations/20261015120000_lcc_entc_junk80_census.sql');
const ADMIN     = read('../api/admin.js');
const SIDEBAR   = read('../api/_handlers/sidebar-pipeline.js');
const TM        = read('../api/_shared/tm-misparse.js');

// ---------------------------------------------------------------- Half B ----

test('p195 unmerge restores relationships with UPDATE-then-INSERT-missing, never a bare ON CONFLICT DO UPDATE', () => {
  const sql = bare(MIGRATION);
  const fn = sql.slice(sql.indexOf('function public.lcc_p195_unmerge'));
  assert.ok(fn.length > 0, 'the migration must define lcc_p195_unmerge');
  // the shape that stranded two byte-identical brokers edges on the winner
  assert.doesNotMatch(fn, /on conflict \(id\) do update/i,
    'a BEFORE INSERT survivor trigger skips a duplicate row, so it never reaches the conflict clause');
  assert.match(fn, /update public\.entity_relationships\s+r\s+set\s+from_entity_id/i,
    'surviving edges must be REPOINTED with UPDATE — the trigger cannot block an update');
  assert.match(fn, /insert into public\.entity_relationships[\s\S]{0,800}not exists \(select 1 from public\.entity_relationships/i,
    'only rows actually deleted may be re-INSERTed');
  assert.match(fn, /update public\.external_identities[\s\S]{0,400}set entity_id/i,
    'external_identities needs the same shape');
});

test('p195 unmerge reports want-vs-have residue instead of swallowing it', () => {
  const fn = bare(MIGRATION);
  assert.match(fn, /relationships_not_restored/,
    'a trigger-skipped row must be REPORTED — the row count is identical either way');
  assert.match(fn, /identities_not_restored/);
  assert.match(fn, /returns table\([^)]*note text/i,
    'the residue needs somewhere to go: the return type carries note');
});

test('p195 unmerge is NOT retired — it is the only reversal for the pre-P196 batches', () => {
  const sql = bare(MIGRATION);
  assert.doesNotMatch(sql, /drop function if exists public\.lcc_p195_unmerge\(text\)\s*;?\s*$/,
    'the drop must be followed by a re-create, not a retirement');
  assert.match(sql, /create or replace function public\.lcc_p195_unmerge/);
  // and it must not delegate: lcc_unmerge_entity reads lcc_entity_merge_log, which
  // holds no row for the 66 open P195 merges.
  assert.doesNotMatch(sql.slice(sql.indexOf('function public.lcc_p195_unmerge')),
    /perform public\.lcc_unmerge_entity|select \* from public\.lcc_unmerge_entity/i,
    'delegating would make 66 open P195 merges irreversible');
});

test('the definer unmerge surface is narrowed and ASSERTED, not just revoked', () => {
  const sql = bare(MIGRATION);
  // REVOKE FROM anon,authenticated leaves PUBLIC; REVOKE FROM public leaves the
  // explicit Supabase default-privilege grants. Both, or neither works.
  assert.match(sql, /revoke execute on function public\.lcc_p195_unmerge\(text\)\s+from public, anon, authenticated/i);
  assert.match(sql, /has_function_privilege\('anon'/,
    'never read a privilege off the GRANT you just wrote');
  assert.match(sql, /has_function_privilege\('service_role'/,
    'the narrowing must also prove it did not break the caller that needs it');
});

// ---------------------------------------------------------------- Half A ----

test('the junk80 census introduces NO new name regex — only the four shared guards', () => {
  const sql = bare(CENSUS);
  // anchor on the SELECTION predicate, not on the file: every guard name also
  // appears in guards_fired, so a file-wide grep survives deleting one from the
  // WHERE (found by the mutation pass, not by reading this).
  const where = sql.slice(sql.indexOf('with base as ('), sql.indexOf('), flagged as ('));
  for (const g of ['lcc_looks_like_person', 'lcc_is_rejected_contact_name',
                   'lcc_owner_name_is_junk', 'lcc_p131_is_document_row_label',
                   'lcc_is_generic_inbox_localpart']) {
    assert.ok(where.includes('public.' + g + '(e.'),
      'the census SELECTION must call the shared guard ' + g);
  }
});

test('the census holds the rows whose mailbox corroborates their name, and never proposes an action on a hold', () => {
  const sql = bare(CENSUS);
  assert.match(sql, /as email_localpart_corroborates_name/,
    'the six rows that ARE their mailbox must be detectable, or the sweep clears a real person');
  assert.match(sql, /as name_repairable_label_prefix/);
  // every hold arm proposes `uncertain`; only sweep_candidate proposes dismiss
  const verdictCase = sql.slice(sql.lastIndexOf('case'), sql.lastIndexOf('as proposed_verdict'));
  assert.match(verdictCase, /email_localpart_corroborates_name then 'uncertain'/);
  assert.match(verdictCase, /n_salesforce_ids > 0\s+then 'uncertain'/);
  assert.match(verdictCase, /else 'dismiss'/);
});

test('the census emits BOTH mailbox-alone counts — address-scoped and domain-scoped differ (31 vs 37)', () => {
  const sql = bare(CENSUS);
  assert.match(sql, /n_live_persons_on_mailbox_domain_scoped/,
    'the email tier scopes by entities.domain; a single figure is ambiguous');
  assert.match(sql, /as n_live_persons_on_mailbox\b/);
});

test('the confirmed-dismiss un-stamp is keyed on the heuristic CLASS, not on tm_misparse alone', () => {
  // comment-stripped only: neither shape asserted here contains a string literal,
  // and a literal-blanker over 500k chars of admin.js desyncs on regex literals.
  const src = bare(ADMIN);
  assert.match(src, /EMAIL_CONFLATION_HEURISTICS\.has\(review\.heuristic\)/,
    'a junk80 dismiss must also clear the conflated mailbox + identities');
  assert.doesNotMatch(src, /review\.heuristic === TM_MISPARSE_HEURISTIC/,
    'the single-heuristic gate is what made the un-stamp unreachable for junk80');
  assert.match(bare(ADMIN), /EMAIL_CONFLATION_HEURISTICS = new Set\(\[TM_MISPARSE_HEURISTIC, JUNK80_HEURISTIC\]\)/);
});

test('the junk80 seeder is dry-run by default and never writes on GET', () => {
  const src = bare(ADMIN);
  // bound the slice to the function: handleTmMisparseSeed follows it and carries
  // the same `if (!apply) continue;` line, which swallowed the mutation.
  const start = src.indexOf('async function handleJunk80Seed');
  const fn = src.slice(start, src.indexOf('async function handleTmMisparseSeed', start));
  assert.ok(fn.length > 200 && fn.length < 6000, 'the slice must be the function, not the rest of the file');
  assert.match(fn, /const apply = String\(req\.query\.apply \|\| ''\) === 'true' && req\.method === 'POST'/);
  assert.match(fn, /if \(!apply\) continue;/, 'a dry run must not POST a proposal');
  assert.match(fn, /projection/, 'the dry run must carry the projection it is verified on');
});

// --- the producer gate (behavioural, not a grep) ----------------------------

test('planContactMinting routes a junk-named PERSON candidate to review, not to the mint', () => {
  const contacts = [
    { name: 'View Less', email: 'jason@perryguestco.com', type: 'person' },
    { name: 'Debt Service', email: 'sam.murphy@nmrk.com', type: 'person' },
    { name: 'Sarah J. Lee', email: 'sarah@example.com', type: 'person' },
  ];
  const junk = (c) => (c.name === 'Sarah J. Lee' ? null : 'junk_contact_name');
  const plan = planContactMinting(contacts, { personJunkName: junk });
  assert.deepEqual(plan.mint.map((c) => c.name), ['Sarah J. Lee']);
  assert.equal(plan.review.length, 2);
  assert.deepEqual([...new Set(plan.review.map((r) => r.reason))], ['person_junk_name']);
  // recoverable, never a silent drop
  assert.ok(plan.review.every((r) => r.contact && r.evidence));
});

test('planContactMinting is unchanged when no filter is injected — the gate is opt-in per caller', () => {
  const contacts = [{ name: 'View Less', email: 'a@b.com', type: 'person' }];
  const plan = planContactMinting(contacts);
  assert.equal(plan.mint.length, 1, 'no injected filter => byte-identical legacy behaviour');
});

test('the sidebar entity mint injects the gate and scopes it to PERSON candidates only', () => {
  const src = noLiterals(SIDEBAR);
  assert.match(src, /planContactMinting\(contacts, \{/,
    'the entity mint must pass the filter');
  const call = bare(SIDEBAR);
  const i = call.indexOf('planContactMinting(contacts, {');
  const block = call.slice(i, i + 400);
  assert.match(block, /contactEntityType\(c\) === 'person'/,
    'isJunkContactName rejects firm suffixes — running it on an organization blocks every real company mint');
  assert.match(block, /isJunkContactName\(c\.name\)/,
    'reuse the existing shared guard; a second copy is normaliser drift');
});

test('tm-misparse stays pure — the junk-name filter is injected, never imported back', () => {
  const src = noLiterals(TM);
  assert.doesNotMatch(src, /from '\.\.\/_handlers\/sidebar-pipeline\.js'/,
    'sidebar-pipeline imports this module; importing back is circular');
  assert.match(bare(TM), /typeof opts\.personJunkName === 'function'/);
});
