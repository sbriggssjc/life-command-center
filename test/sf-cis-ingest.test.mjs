import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapCisRecord, processCisBatch } from '../api/_handlers/sf-cis-ingest.js';

// ============================================================================
// SF Closed-IS (CIS) national export → dia_nm_cis_closings ingest.
// Pure/deps-injected; no live DB.
// ============================================================================

describe('mapCisRecord — value gate + field normalization', () => {
  it('maps a friendly snake_case record', () => {
    const m = mapCisRecord({
      sf_record_id: 'a0X5t000001AbCdEAK',
      address: '123 Main St, Ste A',
      city: 'Dallas', state: 'tx',
      sold_date: '3/15/2024', sold_price: '$15,729,896',
      listing_broker: 'Team Briggs / Northmarq',
      procuring_broker: 'Colliers',
      deal_name: 'DaVita Dallas',
    });
    assert.equal(m.sf_record_id, 'a0X5t000001AbCdEAK');
    assert.equal(m.normalized_address, '123 Main St, Ste A');
    assert.equal(m.state, 'TX');
    assert.equal(m.sold_date, '2024-03-15');          // M/D/YYYY → ISO
    assert.equal(m.sold_price, 15729896);             // $/comma stripped
    assert.equal(m.listing_broker, 'Team Briggs / Northmarq');
    assert.equal(m.procuring_broker, 'Colliers');
    assert.equal(m.source, 'cis_export');
  });

  it('maps the SF managed-package field names (Id / Deal_Price__c / CloseDate)', () => {
    const m = mapCisRecord({
      Id: '0065t00000XyZ', Name: 'Fresenius WH',
      Property_Address_sjc__c: '20931 Burbank Blvd',
      State_sjc__c: 'CA', CloseDate: '2026-07-24', Deal_Price__c: 15730000,
    });
    assert.equal(m.sf_record_id, '0065t00000XyZ');
    assert.equal(m.normalized_address, '20931 Burbank Blvd');
    assert.equal(m.sold_date, '2026-07-24');
    assert.equal(m.sold_price, 15730000);
  });

  it('rejects a row with no SF record id (idempotency key mandatory)', () => {
    assert.equal(mapCisRecord({ address: '1 X', sold_date: '2024-01-01' }), null);
  });

  it('rejects a row with no address AND no deal name', () => {
    assert.equal(mapCisRecord({ Id: 'x', sold_date: '2024-01-01' }), null);
  });

  it('rejects a row with no sale date', () => {
    assert.equal(mapCisRecord({ Id: 'x', address: '1 X' }), null);
  });

  it('keeps a deal-name-only row (address optional if deal name present)', () => {
    const m = mapCisRecord({ Id: 'x', deal_name: 'Portfolio A', sold_date: '2023-05-01' });
    assert.ok(m);
    assert.equal(m.normalized_address, null);
    assert.equal(m.deal_name, 'Portfolio A');
  });
});

describe('processCisBatch — upsert + ledger + link', () => {
  function makeDq() {
    const calls = [];
    const dq = async (domain, method, path, body, headers) => {
      calls.push({ domain, method, path, body, headers });
      if (path.startsWith('rpc/dia_nm_cis_link')) {
        return { ok: true, status: 200, data: [{ metric: 'property_linked', n: 1 }] };
      }
      return { ok: true, status: 201, data: null };
    };
    return { dq, calls };
  }

  it('upserts valid rows on sf_record_id, logs sf_sync_log, fires the link', async () => {
    const { dq, calls } = makeDq();
    const out = await processCisBatch(
      [
        { sf_record_id: 'A1', address: '1 A St', state: 'TX', sold_date: '2023-01-15', sold_price: 1000000 },
        { sf_record_id: 'A2', deal_name: 'Deal 2', sold_date: '2024-02-20' },
        { address: 'no id', sold_date: '2024-01-01' }, // skipped (no id)
      ],
      { importBatch: 'cis_test' },
      { domainQuery: dq, now: () => new Date('2026-08-08T00:00:00Z') },
    );

    assert.equal(out.total, 3);
    assert.equal(out.staged, 2);
    assert.equal(out.skipped_invalid, 1);
    assert.equal(out.import_batch, 'cis_test');
    assert.deepEqual(out.errors, []);

    const upsert = calls.find((c) => c.path.startsWith('dia_nm_cis_closings'));
    assert.ok(upsert.path.includes('on_conflict=sf_record_id'), 'upsert keys on sf_record_id');
    assert.match(upsert.headers.Prefer, /merge-duplicates/);
    assert.equal(upsert.body.length, 2);
    assert.equal(upsert.body[0].import_batch, 'cis_test');

    const ledger = calls.find((c) => c.path === 'sf_sync_log');
    assert.equal(ledger.body[0].sync_type, 'dia_nm_cis_ingest');
    assert.equal(ledger.body[0].status, 'success');
    assert.equal(ledger.body[0].payload.staged, 2);

    assert.equal(out.link.triggered, true);
    const link = calls.find((c) => c.path.startsWith('rpc/dia_nm_cis_link'));
    assert.equal(link.body.p_dry_run, false);
    assert.equal(link.body.p_batch_tag, 'cis_test');
  });

  it('records an error and skips the link when the upsert fails', async () => {
    const dq = async (domain, method, path) => {
      if (path.startsWith('dia_nm_cis_closings')) return { ok: false, status: 500, data: { error: 'boom' } };
      return { ok: true, status: 201, data: null };
    };
    const out = await processCisBatch(
      [{ sf_record_id: 'A1', address: '1 A St', sold_date: '2023-01-15' }],
      { importBatch: 'cis_err' }, { domainQuery: dq },
    );
    assert.equal(out.staged, 0);
    assert.equal(out.errors.length, 1);
    assert.equal(out.errors[0].stage, 'upsert');
    assert.equal(out.link.triggered, false); // no staged rows → no link
  });

  it('is a no-op on an empty batch', async () => {
    const { dq, calls } = makeDq();
    const out = await processCisBatch([], {}, { domainQuery: dq });
    assert.equal(out.total, 0);
    assert.equal(calls.length, 0);
  });
});
