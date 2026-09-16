// ID3d-reconcile — ported from the Dialysis repo's pytest guard
// (tests/test_id3d_guarantor_registry_resolver.py, PR #7415) to this repo's node --test suite,
// because the migration it guards was relocated to supabase/migrations/dialysis/ per this repo's
// "ONE REPO OWNS EACH DATABASE'S OBJECTS" doctrine. Offline structural guard over the migration
// SQL itself (no live DB access) — asserts the properties measured live against Dialysis_DB
// before this migration was written:
//
// - The DaVita-family and Fresenius-family SUBSIDIARIES each get their own `guarantors` row with
//   `parent_company_id` set to their corporate parent, and are NEVER folded into the parent's own
//   alias list (the confirmed trap: `dia_operator_aliases` resolves these subsidiary spellings as
//   pure aliases of the parent operator, which is correct for "who runs this clinic" and wrong
//   for "who legally signed the guaranty").
// - The generic-placeholder text ("Corporate", "Corporate Guarantee", ...) routes to its own
//   `generic_unspecified` sentinel row, never to a named company.
// - A brand-new resolver (`dia_guarantor_aliases` / `dia_resolve_guarantor`) is built, and
//   `dia_operator_aliases` is never joined against for this column.
// - The write guard on `leases` is fill-blanks only (guards on `new.guarantor_id is null` before
//   resolving).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATION = path.join(
  ROOT,
  'supabase/migrations/dialysis/20260916120000_dia_id3d_guarantor_registry_resolver.sql'
);

function sql() {
  return readFileSync(MIGRATION, 'utf8');
}

test('ID3d-reconcile: migration file exists at its ported location', () => {
  assert.ok(existsSync(MIGRATION), `expected migration at ${MIGRATION}`);
});

test('ID3d-reconcile: never joins dia_operator_aliases for guarantor resolution', () => {
  // dia_operator_aliases is legitimately NAMED, both in '--' comments and inside a
  // COMMENT ON ... IS 'text' string literal, explaining why it is NOT reused. The guard checks
  // for an actual reference construct (FROM/JOIN/UPDATE ... FROM), not bare presence of the name
  // -- a naive substring ban would be tripped by its own explanatory prose (the P182 footgun this
  // repo documents repeatedly).
  const code = sql();
  assert.ok(
    !/(from|join)\s+dia_operator_aliases\b/i.test(code),
    'ID3d must not reuse dia_operator_aliases (ID2a) for guarantor resolution -- measured live ' +
      'to collapse legally-distinct DaVita/Fresenius subsidiaries into their parent operator alias.'
  );
  // and the reasoning must still be documented in the migration
  assert.ok(code.includes('dia_operator_aliases'));
});

test('ID3d-reconcile: a new dedicated alias table and resolver are defined, exact-match only', () => {
  const code = sql();
  assert.ok(code.includes('create table if not exists dia_guarantor_aliases'));
  assert.ok(code.includes('create or replace function dia_resolve_guarantor'));

  const m = code.match(/create or replace function dia_resolve_guarantor[\s\S]*?\$\$;/);
  assert.ok(m, 'expected the resolver function body');
  const body = m[0].toLowerCase();
  assert.ok(!body.includes('ilike'));
  assert.ok(!body.includes('similarity('));
});

test('ID3d-reconcile: DaVita subsidiaries get their own rows with a parent link', () => {
  const code = sql();
  const subsidiaries = [
    'Total Renal Care, Inc.',
    'DVA Healthcare Renal Care, Inc.',
    'DVA Renal Healthcare, Inc.',
    'Renal Treatment Centers-Illinois, Inc.',
    'Renal Treatment Centers-Mid-Atlantic, Inc.',
    'Renal Treatment Centers of Florida',
  ];
  for (const name of subsidiaries) {
    assert.ok(code.includes(name), `missing seed row for DaVita subsidiary: ${name}`);
  }

  const parentLinkRe =
    /update guarantors s\s+set parent_company_id = p\.guarantor_id\s+from guarantors p\s+where p\.normalized_name = 'davita inc'[\s\S]*?;/;
  const m = code.match(parentLinkRe);
  assert.ok(m, 'expected the DaVita parent-link UPDATE');
  assert.ok(m[0].includes('total renal care inc'));
  assert.ok(m[0].includes('dva healthcare renal care inc'));
  assert.ok(m[0].includes('dva renal healthcare inc'));
});

test('ID3d-reconcile: Fresenius subsidiaries get their own rows with a parent link', () => {
  const code = sql();
  const subsidiaries = [
    'National Medical Care, Inc.',
    'RCG Mississippi Inc',
    'Bio-Medical Applications of Florida, Inc.',
    'Bio-Medical Applications of Louisiana, LLC',
    'Bio-Medical Applications of Georgia, Inc.',
    'Bio-Medical Applications of West Virginia, Inc.',
    'Bio-Medical Applications of Missouri, Inc.',
    'Bio-Medical Applications of South Carolina, Inc.',
    'Bio-Medical Applications Management Company, Inc.',
  ];
  for (const name of subsidiaries) {
    assert.ok(code.includes(name), `missing seed row for Fresenius subsidiary: ${name}`);
  }

  const parentLinkRe =
    /update guarantors s\s+set parent_company_id = p\.guarantor_id\s+from guarantors p\s+where p\.normalized_name = 'fresenius medical care holdings inc'[\s\S]*?;/;
  const m = code.match(parentLinkRe);
  assert.ok(m, 'expected the Fresenius parent-link UPDATE');
  assert.ok(m[0].includes('national medical care inc'));
  assert.ok(m[0].includes('bio medical applications of florida inc'));
});

test('ID3d-reconcile: the generic placeholder routes to its own sentinel, never a named company', () => {
  const code = sql();
  assert.ok(code.includes('generic_unspecified'));
  assert.ok(code.includes('Unspecified Corporate Guarantor'));
  for (const placeholder of ['Corporate', 'Corporate Guarantee', 'corporate guaranteed']) {
    assert.ok(
      code.includes(`'unspecified corporate guarantor','${placeholder}'`),
      `placeholder text ${JSON.stringify(placeholder)} must alias to the generic sentinel, never to a named company`
    );
  }
});

test('ID3d-reconcile: the backfill is fill-blanks only', () => {
  const code = sql();
  const m = code.match(/update leases\s+set guarantor_id = dia_resolve_guarantor\(guarantor\)\s+where[\s\S]*?;/);
  assert.ok(m, 'expected the backfill UPDATE');
  assert.ok(
    m[0].includes('guarantor_id is null'),
    'the backfill must only fill blank guarantor_id, never overwrite an existing value'
  );
});

test('ID3d-reconcile: the write-guard trigger is fill-blanks only', () => {
  const code = sql();
  const m = code.match(/create or replace function dia_leases_guarantor_resolve_biu\(\)[\s\S]*?\$\$;/);
  assert.ok(m, 'expected the trigger function body');
  assert.ok(
    m[0].includes('new.guarantor_id is null'),
    'the write guard must only auto-resolve when guarantor_id is blank -- it must never ' +
      'overwrite a value someone (manual or otherwise) already set'
  );
});

test('ID3d-reconcile: the FK constraint is added', () => {
  const code = sql();
  assert.ok(
    code.includes(
      'add constraint fk_leases_guarantor_id foreign key (guarantor_id) references guarantors(guarantor_id)'
    )
  );
});
