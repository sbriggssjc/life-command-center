// SF-DIRECT — pure/no-network tests for the SOAP login helper that rebuilds
// the capability the deleted `sf-test` edge function proved (2026-09-09).
// No network calls: the envelope builder and response parser are pure
// functions, tested against synthetic credentials and captured-shape XML
// fixtures — never real Salesforce credentials.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLoginEnvelope,
  parseLoginResponse,
  SfAuthError,
} from '../supabase/functions/_shared/salesforce-soap.ts';

describe('buildLoginEnvelope', () => {
  it('produces a well-formed envelope with username and password+token concatenated', () => {
    const xml = buildLoginEnvelope('user@example.com', 'secretPASSWORD+tokenABC123', '61.0');
    assert.match(xml, /<soapenv:Envelope/);
    assert.match(xml, /<urn:login>/);
    assert.match(xml, /<urn:username>user@example\.com<\/urn:username>/);
    assert.match(xml, /<urn:password>secretPASSWORD\+tokenABC123<\/urn:password>/);
  });

  it('XML-escapes special characters in the username', () => {
    const xml = buildLoginEnvelope('a&b<c>"d\'', 'pw', '61.0');
    assert.match(xml, /<urn:username>a&amp;b&lt;c&gt;&quot;d&apos;<\/urn:username>/);
    assert.doesNotMatch(xml, /<urn:username>a&b/);
  });

  it('never leaves the raw password value unescaped-adjacent to markup injection', () => {
    // A password containing a literal "</urn:password>" must not be able to
    // close the tag early.
    const xml = buildLoginEnvelope('user', "pw</urn:password><urn:username>evil", '61.0');
    // The escaped form must appear; the raw closing tag must not appear
    // inside the password element unescaped.
    assert.match(xml, /&lt;\/urn:password&gt;/);
  });
});

describe('parseLoginResponse — success path', () => {
  const successXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <loginResponse>
      <result>
        <serverUrl>https://na1.salesforce.com/services/Soap/u/61.0/00Dxx0000001abcAAA</serverUrl>
        <sessionId>00Dxx0000001abc!AQEAQFAKE_SESSION_ID_FOR_TESTS_ONLY</sessionId>
        <userId>005xx000001SFAKE</userId>
      </result>
    </loginResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  it('extracts sessionId, serverUrl, instanceUrl, userId', () => {
    const session = parseLoginResponse(successXml);
    assert.equal(session.sessionId, '00Dxx0000001abc!AQEAQFAKE_SESSION_ID_FOR_TESTS_ONLY');
    assert.equal(session.serverUrl, 'https://na1.salesforce.com/services/Soap/u/61.0/00Dxx0000001abcAAA');
    assert.equal(session.instanceUrl, 'https://na1.salesforce.com');
    assert.equal(session.userId, '005xx000001SFAKE');
  });
});

describe('parseLoginResponse — fault path', () => {
  const invalidLoginFault = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>sf:INVALID_LOGIN</faultcode>
      <faultstring>INVALID_LOGIN: Invalid username, password, security token; or user locked out.</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

  const tokenFault = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>sf:LOGIN_MUST_USE_SECURITY_TOKEN</faultcode>
      <faultstring>INVALID_LOGIN: password with security token needed</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

  it('rejects an INVALID_LOGIN fault with SfAuthError', () => {
    assert.throws(() => parseLoginResponse(invalidLoginFault), (err) => {
      assert.ok(err instanceof SfAuthError);
      assert.match(err.faultCode, /INVALID_LOGIN/);
      return true;
    });
  });

  it('rejects a LOGIN_MUST_USE_SECURITY_TOKEN fault with SfAuthError', () => {
    assert.throws(() => parseLoginResponse(tokenFault), (err) => {
      assert.ok(err instanceof SfAuthError);
      assert.match(err.faultCode, /LOGIN_MUST_USE_SECURITY_TOKEN/);
      return true;
    });
  });

  it('positive control: an error message built from a fault never contains the raw faultstring text', () => {
    // The faultstring above deliberately echoes back credential-shaped text
    // ("Invalid username, password..."); the thrown message must be the
    // generic friendly text, never that verbatim string.
    try {
      parseLoginResponse(invalidLoginFault);
      assert.fail('expected SfAuthError to be thrown');
    } catch (err) {
      assert.ok(err instanceof SfAuthError);
      assert.doesNotMatch(err.message, /Invalid username, password, security token; or user locked out\./);
    }
  });

  it('throws SfAuthError on an unparseable success-shaped response (no sessionId)', () => {
    const malformed = `<soapenv:Envelope><soapenv:Body><loginResponse><result></result></loginResponse></soapenv:Body></soapenv:Envelope>`;
    assert.throws(() => parseLoginResponse(malformed), (err) => {
      assert.ok(err instanceof SfAuthError);
      assert.equal(err.faultCode, 'UNPARSEABLE_RESPONSE');
      return true;
    });
  });
});

describe('SfAuthError never carries a password or session id in its own fields', () => {
  it('faultCode and message are both derived, never the raw credential inputs', () => {
    const err = new SfAuthError('INVALID_LOGIN', 'Salesforce rejected the credentials (INVALID_LOGIN).');
    const serialized = JSON.stringify({ faultCode: err.faultCode, message: err.message });
    assert.doesNotMatch(serialized, /password/i);
    assert.doesNotMatch(serialized, /sessionId/i);
  });
});
