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

test('all three runtime layers enforce the shared record boundary', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'extension/manifest.json'), 'utf8'));
  const costarScript = manifest.content_scripts.find((entry) =>
    entry.matches.some((match) => match.includes('costar.com'))
  );
  assert.equal(costarScript.js[0], 'shared/property-identity.js');
  assert.equal(manifest.version, '1.0.47');

  const content = readFileSync(join(ROOT, 'extension/content/costar.js'), 'utf8');
  const background = readFileSync(join(ROOT, 'extension/background.js'), 'utf8');
  const sidepanel = readFileSync(join(ROOT, 'extension/sidepanel.js'), 'utf8');
  assert.match(content, /accumulated\._property_key !== propertyKey/);
  assert.match(content, /snapshot\._source_field_provenance/);
  assert.match(background, /discarded stale or mixed-record snapshot/);
  assert.match(background, /senderTabKey !== incomingKey/);
  assert.match(sidepanel, /Capture blocked — CoStar record changed/);
  assert.match(sidepanel, /validateCostarContext\(liveCtx\)/);
  assert.match(
    sidepanel,
    /costar_property_id: domain === 'costar'[\s\S]*LccPropertyIdentity\.costarPropertyId\(liveCtx\.page_url\)/,
    'ASC attach payload must carry the validated CoStar source-record ID',
  );
});
