// GOVDUP1-a — guard for the Salesforce auto-create fan-out dedupe.
//
// Source-only (offline, no DB, no secrets — the suite's standing rule).
// Comments are stripped before every substance assertion: both migrations'
// headers name every hazard, every rejected option and every banned predicate
// while EXPLAINING them, so a raw-source detector would find them all present
// and pass over a complete revert (the A5c/N18/B1 "strip comments first"
// rule).
//
// What this guards, and why each one is here:
//   1. The dedupe key is `sf_property_id`, and the lookup is keyed on it —
//      never on the address. The address is exactly what varies between the
//      duplicate mints ('700 technology dr'/Charleston vs
//      '700 Technology Dr'/South Charleston), so an address-keyed dedupe is
//      structurally unable to catch this producer.
//   2. It is enforced BEFORE INSERT on sf_property_staging — strictly ahead
//      of the mint. The deployed writer selects on `linked_property_id is
//      null`; pre-filling that column is what removes the row from its
//      selection. A guard placed after the property INSERT is too late.
//   3. `staging_id` is never the dedupe key. That is what the pipeline
//      already had (uq_sf_property_staging_dedup carries import_batch, which
//      changes every hourly crawl) and it is precisely the defect.
//   4. The identity map is FILL-BLANKS: the first identity recorded wins.
//      Re-pointing an existing mapping at a newer mint is how a fan-out
//      would rotate its own canonical row and defeat the dedupe.
//   5. A genuinely NEW sf_property_id is still allowed to mint once — the
//      trigger returns unchanged when the map has no row. A dedupe that
//      blocked first mints would be a different, worse defect.
//   6. Nothing is deleted. The live-row disposition is an UPDATE to
//      status='archived' logged in gov_property_dup_retire_log, and the
//      advisories are resolved by a status flip, never a DELETE.
//   7. 22102 and 18945 are NOT retired. They predate the producer, carry
//      gov_master_backfill_r71_anchored, and are the sole live row at their
//      address; archiving them would delete the only record of the property.
//   8. expire_orphan_pending_updates keeps its archived-parent arm — the
//      auto-retire predicate GOVDUP1's retire left with nothing to fire it.
//   9. The repo's committed intake-salesforce source carries an explicit
//      drift warning naming the deployed version as the writer. Without it
//      the next reader repeats GOVDUP1's mistake: reading the repo file,
//      correctly concluding "no INSERT path into gov.properties", and
//      reasoning about a different program from the one that runs.
//
// Mutation pass: 12 mutations run, 12 RED, 0 survivors (see the final summary
// in the GOVDUP1-a response for the list).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const govMig = (f) => join(__dirname, '..', 'supabase', 'migrations', 'government', f);

const DEDUPE_PATH = govMig('20260905130000_gov_govdup1a_sf_property_identity_dedupe.sql');
const DISPOSITION_PATH = govMig('20260905140000_gov_govdup1a_live_row_disposition.sql');
const EDGE_PATH = join(__dirname, '..', 'supabase', 'functions', 'intake-salesforce', 'index.ts');

function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

function stripTsComments(ts) {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const dedupe = stripSqlComments(readFileSync(DEDUPE_PATH, 'utf8'));
const disposition = stripSqlComments(readFileSync(DISPOSITION_PATH, 'utf8'));
const edgeRaw = readFileSync(EDGE_PATH, 'utf8');

// ── 1. the key is the SF identity, and the lookup uses it ──────────────────
test('the identity map is keyed on sf_property_id as its primary key', () => {
  assert.match(
    dedupe,
    /create table if not exists public\.gov_sf_property_identity\s*\(\s*sf_property_id\s+text\s+primary key/i,
    'gov_sf_property_identity must be PK-keyed on sf_property_id — one canonical gov property per Salesforce property',
  );
});

test('the BEFORE INSERT lookup resolves by sf_property_id, not by address', () => {
  const fn = dedupe.slice(
    dedupe.indexOf('function public.gov_sf_staging_identity_dedupe'),
    dedupe.indexOf('trg_gov_sf_staging_identity_dedupe'),
  );
  assert.ok(fn.length > 200, 'could not slice the dedupe trigger function');
  assert.match(
    fn,
    /where\s+i\.sf_property_id\s*=\s*btrim\(new\.sf_property_id\)/i,
    'the lookup must key on sf_property_id',
  );
  // The address is exactly what varies between the duplicate mints, so it must
  // never appear as a lookup predicate in this function.
  assert.doesNotMatch(
    fn,
    /new\.(normalized_address|street|city|zip_code)\s*=/i,
    'the dedupe must never resolve on an address column — the address is what varies',
  );
});

test('staging_id is never the dedupe key', () => {
  const fn = dedupe.slice(
    dedupe.indexOf('function public.gov_sf_staging_identity_dedupe'),
    dedupe.indexOf('trg_gov_sf_staging_identity_dedupe'),
  );
  // \b matters: the function's OWN NAME (gov_sf_staging_identity_dedupe)
  // contains the substring "staging_id" ("staging" + "_identity"), so a bare
  // /staging_id/ is a false positive — the documented "a guard that matches a
  // shape is defeated by a name that legitimately appears elsewhere" footgun,
  // caught here by the guard failing on correct code.
  assert.doesNotMatch(
    fn,
    /staging_id\b/i,
    'a staging_id-keyed dedupe is what the pipeline already had and is precisely the defect',
  );
});

// ── 2. enforced ahead of the mint ──────────────────────────────────────────
test('the dedupe fires BEFORE INSERT on sf_property_staging', () => {
  assert.match(
    dedupe,
    /create trigger trg_gov_sf_staging_identity_dedupe\s+before insert on public\.sf_property_staging/i,
    'must be BEFORE INSERT on sf_property_staging — an AFTER trigger, or one on properties, is too late to prevent the mint',
  );
});

test('the dedupe pre-fills linked_property_id, which is what removes the row from the writer selection', () => {
  const fn = dedupe.slice(
    dedupe.indexOf('function public.gov_sf_staging_identity_dedupe'),
    dedupe.indexOf('trg_gov_sf_staging_identity_dedupe'),
  );
  assert.match(
    fn,
    /new\.linked_property_id\s*:=\s*v_pid/i,
    'the deployed writer selects on `linked_property_id=is.null`; pre-filling it is the whole mechanism',
  );
});

// ── 3. fill-blanks, and first-mint still allowed ───────────────────────────
test('the identity map is fill-blanks — an existing mapping is never re-pointed', () => {
  const fn = dedupe.slice(
    dedupe.indexOf('function public.gov_sf_identity_record'),
    dedupe.indexOf('revoke all on function public.gov_sf_identity_record'),
  );
  assert.ok(fn.length > 200, 'could not slice gov_sf_identity_record');
  assert.match(
    fn,
    /on conflict \(sf_property_id\) do update[\s\S]*?where\s+public\.gov_sf_property_identity\.property_id\s*=\s*excluded\.property_id/i,
    'the DO UPDATE must be gated so a differing property_id never overwrites the recorded identity',
  );
});

test('a genuinely new sf_property_id is still free to mint once', () => {
  const fn = dedupe.slice(
    dedupe.indexOf('function public.gov_sf_staging_identity_dedupe'),
    dedupe.indexOf('trg_gov_sf_staging_identity_dedupe'),
  );
  assert.match(
    fn,
    /if v_pid is null then\s+return new;/i,
    'no mapping must mean "let it through" — blocking first mints would be a worse defect',
  );
});

// ── 4. nothing is deleted ──────────────────────────────────────────────────
test('neither migration deletes a property or an advisory', () => {
  for (const [name, sql] of [['dedupe', dedupe], ['disposition', disposition]]) {
    assert.doesNotMatch(
      sql,
      /delete\s+from\s+public\.(properties|pending_updates)\b/i,
      `${name}: nothing is deleted — retirement is a reversible status flip`,
    );
  }
});

test('the retire is an archived status flip logged to gov_property_dup_retire_log', () => {
  assert.match(
    disposition,
    /insert into public\.gov_property_dup_retire_log\s*\([\s\S]*?govdup1a_sf_autocreate_retire_20260905/i,
    'every retired property must be logged with its batch tag so the flip is reversible',
  );
  assert.match(
    disposition,
    /update public\.properties p\s+set status = 'archived'/i,
    'retirement is UPDATE status=archived, never a DELETE',
  );
});

// ── 5. the two rows that must NOT be retired ───────────────────────────────
test('22102 and 18945 are never retired — they predate the producer and are the sole live row at their address', () => {
  const ids = disposition.match(/property_id in \(([^)]*)\)/i);
  assert.ok(ids, 'could not find the retire id list');
  const list = ids[1].replace(/\s/g, '').split(',');
  assert.deepEqual(list.sort(), ['36822', '36823', '39128'].sort(),
    'the retire set is exactly 36822/36823/39128');
  for (const keep of ['22102', '18945', '39064']) {
    assert.ok(!list.includes(keep), `${keep} must not be in the retire set`);
  }
});

// ── 6. the auto-retire predicate that had nothing to fire it ───────────────
test('expire_orphan_pending_updates gains the archived-parent arm', () => {
  assert.match(
    dedupe,
    /pu\.table_name = 'properties'\s+and exists \(select 1 from public\.properties p\s+where p\.property_id = pu\.property_id and p\.status = 'archived'\)/i,
    'the sweep must resolve an advisory whose parent EXISTS but is archived — the pre-existing arm only fired when the parent did not exist at all',
  );
  assert.match(dedupe, /properties_archived_parent/,
    'the new arm must be reported separately, never folded into the existing properties count');
});

// ── 7. the drift warning that stops the next reader repeating GOVDUP1 ──────
test('the committed intake-salesforce source warns that the deployed version is the writer', () => {
  const head = edgeRaw.slice(0, 4000);
  assert.match(head, /GOVDUP1-a/,
    'the repo copy must name GOVDUP1-a so the drift is discoverable from the file itself');
  // Pin the WARNING, not just the ticket id: an assertion that only checks for
  // "GOVDUP1-a" survives deleting the sentence that does the actual work.
  assert.match(head, /NOT\*{0,2}\s*WHAT RUNS/i,
    'the header must say plainly that this file is not what runs');
  assert.match(head, /sf-2026-05-v8/,
    'the header must name the deployed PAYLOAD_VERSION so the drift is checkable');
  assert.match(head, /autoCreateProperty/,
    'the warning must name the deployed function that does the minting');
  // The body must still genuinely lack the auto-create path — if someone syncs
  // the deployed source into the repo, this assertion is the prompt to
  // re-verify the whole finding rather than let the warning silently rot.
  assert.doesNotMatch(
    stripTsComments(edgeRaw),
    /function autoCreateProperty/,
    'the committed source still has no auto-create path; if that changes, re-verify the GOVDUP1-a drift note',
  );
});
