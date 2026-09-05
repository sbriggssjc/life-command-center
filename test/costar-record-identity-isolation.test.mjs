import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharedSource = readFileSync(join(ROOT, 'extension/shared/property-identity.js'), 'utf8');

function identityApi() {
  const sandbox = { URL };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(sharedSource, sandbox);
  return sandbox.LccPropertyIdentity;
}

test('same-address CoStar records remain distinct by numeric property ID', () => {
  const api = identityApi();
  const medical = 'https://product.costar.com/detail/all-properties/11349159/tenant';
  const retail = 'https://product.costar.com/detail/all-properties/49694/tenant';
  assert.equal(api.costarPropertyId(medical), '11349159');
  assert.equal(api.costarPropertyId(retail), '49694');
  assert.notEqual(api.propertyIdentityKey(medical), api.propertyIdentityKey(retail));
  assert.equal(
    api.propertyIdentityKey(medical),
    api.propertyIdentityKey('https://product.costar.com/detail/all-properties/11349159/public-record'),
    'sub-tabs of one CoStar record must accumulate together',
  );
});

test('context integrity accepts one record and rejects active-tab and field mixing', () => {
  const api = identityApi();
  const medical = 'https://product.costar.com/detail/all-properties/11349159/tenant';
  const retail = 'https://product.costar.com/detail/all-properties/49694/tenant';
  const medicalKey = api.propertyIdentityKey(medical);
  const retailKey = api.propertyIdentityKey(retail);
  const clean = {
    page_url: medical,
    source_property_key: medicalKey,
    _source_field_provenance: { address: medicalKey, parcel_number: medicalKey, tenants: medicalKey },
  };

  assert.equal(api.contextIntegrity(clean, medical).ok, true);
  assert.deepEqual(
    [...api.contextIntegrity(clean, retail).reasons],
    ['active_tab_identity_mismatch'],
  );
  assert.deepEqual(
    [...api.contextIntegrity({
      ...clean,
      _source_field_provenance: { ...clean._source_field_provenance, tenant_name: retailKey },
    }, medical).reasons],
    ['mixed_source_field_provenance'],
  );
});

test('fresh ASC tenant roster replaces stale tenant observations only for the same CoStar record', () => {
  const api = identityApi();
  const tenantUrl = 'https://product.costar.com/detail/lookup/251984/tenant';
  const propertyKey = api.propertyIdentityKey(tenantUrl);
  const context = {
    page_url: tenantUrl,
    source_property_key: propertyKey,
    tenant_name: 'Beverly Hills Plastic Surgery',
    tenants: [{ name: 'Beverly Hills Plastic Surgery' }],
    _source_field_provenance: { address: propertyKey, tenants: propertyKey },
  };
  const fresh = {
    page_url: tenantUrl,
    source_property_key: propertyKey,
    tenant_provenance_key: propertyKey,
    tenants: [
      { name: 'Beverly Hills Plastic Surgery' },
      { name: '436 Beverly Hills Surgery Center' },
    ],
  };

  const merged = api.mergeFreshTenantRoster(context, fresh, tenantUrl);
  assert.equal(merged.ok, true);
  assert.deepEqual(
    [...merged.context.tenants.map((tenant) => tenant.name)],
    ['Beverly Hills Plastic Surgery', '436 Beverly Hills Surgery Center'],
  );
  assert.equal(merged.context.tenant_name, 'Beverly Hills Plastic Surgery');

  const wrongUrl = 'https://product.costar.com/detail/lookup/8355465/tenant';
  const wrongKey = api.propertyIdentityKey(wrongUrl);
  const wrongRecord = api.mergeFreshTenantRoster(context, {
    ...fresh,
    page_url: wrongUrl,
    source_property_key: wrongKey,
    tenant_provenance_key: wrongKey,
  }, tenantUrl);
  assert.equal(wrongRecord.ok, false);
  assert.ok(wrongRecord.reasons.includes('fresh_tenant_identity_mismatch'));

  const empty = api.mergeFreshTenantRoster(context, { ...fresh, tenants: [] }, tenantUrl);
  assert.equal(empty.ok, false);
  assert.ok(empty.reasons.includes('fresh_tenant_roster_empty'));
});

test('fresh tenant scans target the provenance-producing frame and reject another active tab', () => {
  const api = identityApi();
  const context = { _source_tab_id: 41, _tenant_source_frame_id: 7 };

  assert.deepEqual(
    { ...api.freshTenantFrameTarget(context, 41) },
    { ok: true, tabId: 41, frameId: 7 },
  );
  assert.deepEqual(
    [...api.freshTenantFrameTarget(context, 42).reasons],
    ['fresh_tenant_tab_identity_mismatch'],
  );
  assert.equal(api.freshTenantFrameTarget({ _source_tab_id: 41 }, 41).frameId, 0);
  assert.deepEqual(
    [...api.freshTenantFrameTarget(context, null).reasons],
    ['missing_active_costar_tab'],
  );
});

test('structured CoStar tenant grids retain a secondary ASC tenant without column drift', () => {
  const api = identityApi();
  const rows = [
    ['Tenant', 'Industry', 'Floor', 'SF Occupied', '# Emps', 'Move Date', 'Exp Date'],
    ['Beverly Hills Plastic Surgery', 'Health Care and Social Assistance', '2nd, 3rd', '6,832', '6', '-', '-'],
    ['The Practice Healthcare', '', '1st', '6,283', '-', '-', '-'],
    ['Bedford Breast Center', 'Health Care and Social Assistance', '3rd', '4,948', '15', '-', '-'],
    ['Anastasia Beverly Hills', 'Retailer', '1st', '4,722', '3', '-', '-'],
    ['436 Beverly Hills Surgery Center', 'Health Care and Social Assistance', '1st', '4,575', '30', 'Jan 2007', '-'],
    ['Bedford Dental', 'Health Care and Social Assistance', '3rd', '4,200', '10', '-', '-'],
  ];
  const tenants = api.tenantRosterFromGridRows(rows);
  assert.deepEqual(
    [...tenants.map((tenant) => tenant.name)],
    ['Beverly Hills Plastic Surgery', 'The Practice Healthcare', 'Bedford Breast Center',
      'Anastasia Beverly Hills', '436 Beverly Hills Surgery Center', 'Bedford Dental'],
  );
  assert.equal(tenants[4].sf, '4,575 SF');
  assert.deepEqual([...api.tenantRosterFromGridRows([
    ['Owner', 'Address', 'Value'], ['436 Beverly Hills Surgery Center', '436 N Bedford', '$1'],
  ])], []);
});

test('all three runtime layers enforce the shared record boundary', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'extension/manifest.json'), 'utf8'));
  const costarScript = manifest.content_scripts.find((entry) =>
    entry.matches.some((match) => match.includes('costar.com'))
  );
  assert.equal(costarScript.js[0], 'shared/property-identity.js');
  assert.equal(manifest.version, '1.0.51');

  const content = readFileSync(join(ROOT, 'extension/content/costar.js'), 'utf8');
  const background = readFileSync(join(ROOT, 'extension/background.js'), 'utf8');
  const sidepanel = readFileSync(join(ROOT, 'extension/sidepanel.js'), 'utf8');
  assert.match(content, /accumulated\._property_key !== propertyKey/);
  assert.match(content, /snapshot\._source_field_provenance/);
  assert.match(background, /discarded stale or mixed-record snapshot/);
  assert.match(background, /senderTabKey !== incomingKey/);
  assert.match(background, /incoming\._tenant_source_frame_id = sender\?\.frameId \?\? 0/);
  assert.match(sidepanel, /Capture blocked — CoStar record changed/);
  assert.match(sidepanel, /validateCostarContext\(liveCtx\)/);
  assert.match(content, /GET_FRESH_ASC_TENANT_CONTEXT/);
  assert.match(content, /extractStructuredTenantGrid\(\)/);
  assert.match(content, /tenantRosterFromGridRows\(rows\)/);
  assert.match(sidepanel, /getFreshAscTenantContext\(liveCtx\)/);
  assert.match(sidepanel, /mergeFreshTenantRoster\(ctx, fresh, activeUrl\)/);
  assert.match(sidepanel, /freshTenantFrameTarget\(ctx, tabId\)/);
  assert.match(sidepanel, /frameId: target\.frameId/);
  assert.match(sidepanel, /formatAscIdentityDiagnostics\(capture\.data\?\.identity_diagnostics\)/);
  assert.match(
    sidepanel,
    /costar_property_id: domain === 'costar'[\s\S]*LccPropertyIdentity\.costarPropertyId\(liveCtx\.page_url\)/,
    'ASC attach payload must carry the validated CoStar source-record ID',
  );
});
