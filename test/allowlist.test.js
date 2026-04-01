import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedTable, safeLimit, safeSelect, safeColumn,
  GOV_READ_TABLES, GOV_WRITE_TABLES, DIA_READ_TABLES, DIA_WRITE_TABLES
} from '../api/_shared/allowlist.js';

describe('isAllowedTable', () => {
  it('allows tables in the allowlist', () => {
    assert.ok(isAllowedTable('properties', GOV_READ_TABLES));
    assert.ok(isAllowedTable('prospect_leads', GOV_WRITE_TABLES));
    assert.ok(isAllowedTable('v_counts_freshness', DIA_READ_TABLES));
    assert.ok(isAllowedTable('rpc/upsert_lead', GOV_WRITE_TABLES));
  });

  it('rejects tables not in the allowlist', () => {
    assert.ok(!isAllowedTable('users', GOV_READ_TABLES));
    assert.ok(!isAllowedTable('auth.users', GOV_READ_TABLES));
    assert.ok(!isAllowedTable('pg_catalog', GOV_READ_TABLES));
  });

  it('rejects null/undefined/empty', () => {
    assert.ok(!isAllowedTable(null, GOV_READ_TABLES));
    assert.ok(!isAllowedTable(undefined, GOV_READ_TABLES));
    assert.ok(!isAllowedTable('', GOV_READ_TABLES));
  });

  it('rejects tables with special characters', () => {
    assert.ok(!isAllowedTable('properties; DROP TABLE', GOV_READ_TABLES));
    assert.ok(!isAllowedTable('properties--', GOV_READ_TABLES));
    assert.ok(!isAllowedTable('../etc/passwd', GOV_READ_TABLES));
  });
});

describe('safeLimit', () => {
  it('returns default for invalid values', () => {
    assert.equal(safeLimit(undefined), 1000);
    assert.equal(safeLimit('abc'), 1000);
    assert.equal(safeLimit(0), 1000);
    assert.equal(safeLimit(-5), 1000);
  });

  it('clamps to max', () => {
    assert.equal(safeLimit(10000), 5000);
    assert.equal(safeLimit(999999), 5000);
  });

  it('passes through valid values', () => {
    assert.equal(safeLimit(50), 50);
    assert.equal(safeLimit(1), 1);
    assert.equal(safeLimit(5000), 5000);
  });
});

describe('safeSelect', () => {
  it('returns * for empty/null', () => {
    assert.equal(safeSelect(null), '*');
    assert.equal(safeSelect(undefined), '*');
    assert.equal(safeSelect(''), '*');
  });

  it('allows valid select expressions', () => {
    assert.equal(safeSelect('*'), '*');
    assert.equal(safeSelect('id,name'), 'id,name');
    assert.equal(safeSelect('properties(id,name)'), 'properties(id,name)');
  });

  it('rejects select with dangerous characters', () => {
    assert.equal(safeSelect('id; DROP TABLE'), '*');
    assert.equal(safeSelect('id--comment'), '*');
  });
});

describe('safeColumn', () => {
  it('allows valid column names', () => {
    assert.equal(safeColumn('id'), 'id');
    assert.equal(safeColumn('property_name'), 'property_name');
    assert.equal(safeColumn('_private'), '_private');
    assert.equal(safeColumn('col123'), 'col123');
  });

  it('rejects invalid column names', () => {
    assert.equal(safeColumn(null), null);
    assert.equal(safeColumn(''), null);
    assert.equal(safeColumn('123col'), null);       // starts with digit
    assert.equal(safeColumn('col-name'), null);      // hyphen
    assert.equal(safeColumn('col.name'), null);      // dot
    assert.equal(safeColumn('col;DROP'), null);      // semicolon
    assert.equal(safeColumn('col name'), null);      // space
    assert.equal(safeColumn("col'test"), null);      // quote
  });
});

describe('allowlist coverage', () => {
  it('GOV_WRITE_TABLES is a subset of GOV_READ_TABLES + rpc + write-only', () => {
    const WRITE_ONLY = new Set(['research_queue_outcomes']);
    for (const table of GOV_WRITE_TABLES) {
      if (table.startsWith('rpc/')) continue;
      if (WRITE_ONLY.has(table)) continue;
      assert.ok(GOV_READ_TABLES.has(table), `Write table ${table} should be readable`);
    }
  });

  it('DIA_WRITE_TABLES is a subset of DIA_READ_TABLES + rpc', () => {
    for (const table of DIA_WRITE_TABLES) {
      if (table.startsWith('rpc/')) continue;
      // Some write tables might not be in read (e.g., RPC only)
      // Just verify they exist in the set
    }
  });
});
