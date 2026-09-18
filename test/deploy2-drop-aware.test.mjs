// DEPLOY2-drop-aware: the unapplied-migration check (DEPLOY2-unapplied) must not flag an object
// as "unapplied" when a LATER migration deliberately DROPs it -- the RECON1/RECON2 shape (a lease
// active/expiration guard created by one migration and retired by the next one's refined rule).
// See scripts/build-brief-collector.mjs's DEPLOY2-unapplied header + the buildRetirementMap doc
// comment for the full mechanism.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDroppedObjects,
  buildRetirementMap,
  retiredObjectFinding,
} from '../scripts/build-brief-collector.mjs';

test('parseDroppedObjects: DROP TRIGGER IF EXISTS ... ; DROP FUNCTION IF EXISTS ...', () => {
  const sql = `
    drop trigger if exists trg_dia_recon1_lease_active_guard on dia.leases;
    drop function if exists dia_recon1_lease_active_past_expiration_guard();
  `;
  const got = parseDroppedObjects(sql);
  assert.deepEqual(got, [
    { kind: 'trigger', name: 'trg_dia_recon1_lease_active_guard' },
    { kind: 'function', name: 'dia_recon1_lease_active_past_expiration_guard' },
  ]);
});

test('parseDroppedObjects: schema-qualified name is not captured as part of the object name', () => {
  const got = parseDroppedObjects('DROP VIEW IF EXISTS public.v_stale_thing;');
  assert.deepEqual(got, [{ kind: 'view', name: 'v_stale_thing' }]);
});

test('parseDroppedObjects: comments are stripped first, so a narrated DROP in a header is not counted', () => {
  const sql = `
    -- this migration does NOT drop function foo(), unlike an earlier draft
    create function foo() returns void as $$ begin end; $$ language plpgsql;
  `;
  assert.deepEqual(parseDroppedObjects(sql), []);
});

test('buildRetirementMap: RECON1/RECON2 shape -- the guard is retired by the later filename, in either input order', () => {
  const recon1 = [
    '20260917180000_dia_recon1_lease_active_guard.sql',
    `create function dia_recon1_lease_active_past_expiration_guard() returns trigger as $$ begin return new; end; $$ language plpgsql;
     create trigger trg_dia_recon1_lease_active_guard before update on dia.leases
       for each row execute function dia_recon1_lease_active_past_expiration_guard();`,
  ];
  const recon2 = [
    '20260917220000_dia_recon2_lease_active_past_expiration_ok.sql',
    `drop trigger if exists trg_dia_recon1_lease_active_guard on dia.leases;
     drop function if exists dia_recon1_lease_active_past_expiration_guard();`,
  ];

  for (const pairs of [[recon1, recon2], [recon2, recon1]]) {
    const retiredBy = buildRetirementMap(pairs);
    assert.equal(retiredBy.get('function:dia_recon1_lease_active_past_expiration_guard'), recon2[0]);
    assert.equal(retiredBy.get('trigger:trg_dia_recon1_lease_active_guard'), recon2[0]);
  }
});

test('buildRetirementMap CONTROL: a DROP that precedes the CREATE (by filename) leaves the object NOT retired -- still probed', () => {
  const earlierDrop = [
    '20260101000000_drop_first.sql',
    'drop function if exists still_alive_thing();',
  ];
  const laterCreate = [
    '20260201000000_recreate_it.sql',
    'create function still_alive_thing() returns void as $$ begin end; $$ language plpgsql;',
  ];
  const retiredBy = buildRetirementMap([earlierDrop, laterCreate]);
  assert.equal(retiredBy.has('function:still_alive_thing'), false);
});

test('buildRetirementMap: an object with no DROP anywhere in the window is never retired (negative control)', () => {
  const only = [
    '20260101000000_a.sql',
    'create view v_never_dropped as select 1;',
  ];
  const retiredBy = buildRetirementMap([only]);
  assert.equal(retiredBy.size, 0);
});

test('buildRetirementMap: caller ordering of the input array does not matter -- it sorts by filename itself', () => {
  const a = ['20260101000000_a.sql', 'create table t1 (id int);'];
  const b = ['20260201000000_b.sql', 'drop table if exists t1;'];
  const viaAB = buildRetirementMap([a, b]);
  const viaBA = buildRetirementMap([b, a]);
  assert.equal(viaAB.get('table:t1'), b[0]);
  assert.equal(viaBA.get('table:t1'), b[0]);
});

test('retiredObjectFinding: info severity, names both files', () => {
  const f = retiredObjectFinding('20260917180000_dia_recon1.sql', 'function', 'my_fn', '20260917220000_dia_recon2.sql');
  assert.equal(f.rule, 'migration_object_retired');
  assert.equal(f.severity, 'info');
  assert.equal(f.subject, '20260917180000_dia_recon1.sql');
  assert.equal(f.measured.retired_by, '20260917220000_dia_recon2.sql');
  assert.match(f.detail, /DROPs it/);
});
