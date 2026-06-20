// CONTACT-SELECTION Slice 4 — Phase C: address reverse-lookup framework tests.
//
// FRAMEWORK only. The safety gate (residential vs registered-agent SERVICE
// address) + the person guard + the feature-flag behavior are validated here;
// the reverse-lookup HTTP is a deferred, deps-injected fetcher.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRegisteredAgentServiceAddress, classifyReverseAddress,
  sanitizeAddressResult, buildAddressReverseAdapter,
} from '../api/_shared/address-reverse.js';

describe('isRegisteredAgentServiceAddress (the principal-vs-agent gate)', () => {
  it('flags commercial registered-agent services + law firms + PO boxes', () => {
    assert.equal(isRegisteredAgentServiceAddress('1201 Hays Street', 'Corporation Service Company'), true);
    assert.equal(isRegisteredAgentServiceAddress('c/o CT Corporation System, 1200 S Pine Island Rd'), true);
    assert.equal(isRegisteredAgentServiceAddress('Registered Agents Inc, 8 The Green Ste A'), true);
    assert.equal(isRegisteredAgentServiceAddress('PO Box 4422, Tampa, FL'), true);
    assert.equal(isRegisteredAgentServiceAddress('Smith & Jones LLP, Attorneys at Law, 500 Main St'), true);
  });
  it('does NOT flag a plain residential street address', () => {
    assert.equal(isRegisteredAgentServiceAddress('4821 Maple Avenue, Springfield, IL 62704'), false);
    assert.equal(isRegisteredAgentServiceAddress('12 Oak Lane, Austin, TX'), false);
  });
});

describe('classifyReverseAddress', () => {
  it('residential street address → eligible', () => {
    assert.equal(classifyReverseAddress('4821 Maple Avenue, Springfield, IL').eligible, true);
  });
  it('agent-service address → ineligible', () => {
    assert.equal(classifyReverseAddress('c/o CSC, 251 Little Falls Dr').eligible, false);
  });
  it('no street number → ineligible', () => {
    assert.equal(classifyReverseAddress('Downtown Tampa').reason, 'no_street_number');
  });
  it('empty → no_address', () => {
    assert.equal(classifyReverseAddress('').reason, 'no_address');
  });
});

describe('sanitizeAddressResult', () => {
  it('accepts a plausible resident', () => {
    assert.deepEqual(sanitizeAddressResult({ person_name: 'Anita Ismail' }), { person_name: 'Anita Ismail', role: 'economic_owner_contact' });
  });
  it('rejects junk / firm', () => {
    assert.equal(sanitizeAddressResult({ person_name: 'Current Resident LLC' }), null);
  });
});

describe('buildAddressReverseAdapter', () => {
  it('unconfigured → unconfigured', async () => {
    delete process.env.OWNER_ENRICH_ADDRESS_URL;
    const r = await buildAddressReverseAdapter({ fetch: async () => ({ person_name: 'Bob Jones' }) })({ notice_address: '12 Oak Lane, Austin, TX' });
    assert.equal(r.reason, 'unconfigured');
  });

  it('residential + resolved → attach', async () => {
    process.env.OWNER_ENRICH_ADDRESS_URL = 'https://example.test/addr';
    try {
      let called = false;
      const fetch = async () => { called = true; return { person_name: 'Mark Tomlin' }; };
      const r = await buildAddressReverseAdapter({ fetch })({ notice_address: '4821 Maple Avenue, Springfield, IL' });
      assert.equal(r.ok, true);
      assert.equal(r.person_name, 'Mark Tomlin');
      assert.equal(called, true);
    } finally { delete process.env.OWNER_ENRICH_ADDRESS_URL; }
  });

  it('agent-service address → no attach, fetcher never called', async () => {
    process.env.OWNER_ENRICH_ADDRESS_URL = 'https://example.test/addr';
    try {
      let called = false;
      const fetch = async () => { called = true; return { person_name: 'Some Agent' }; };
      const r = await buildAddressReverseAdapter({ fetch })({ notice_address: 'c/o CSC, 251 Little Falls Dr', notice_recipient: 'Corporation Service Company' });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'agent_service_address');
      assert.equal(called, false);
    } finally { delete process.env.OWNER_ENRICH_ADDRESS_URL; }
  });
});
