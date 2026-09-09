// SF-DIRECT-b — pure/no-network tests for the PA-gateway SOQL helper that
// gives sf-ping (and any future edge-function caller) a fallback path when
// direct SOAP is refused by the org's SSO policy (SF-DIRECT).
//
// No network calls: sfGatewayQuery is exercised against a stubbed global
// fetch, never a live Salesforce or Power Automate endpoint. The webhook
// URL used here is synthetic and carries a fake `sig=` fragment purely to
// prove the positive control below — never a real signature.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// This module is Deno-authored (it calls Deno.env.get / uses AbortController,
// setTimeout, fetch — all standard, but the top-level env-read pattern needs
// a `Deno` global to exist before the functions inside it are CALLED). Node
// has no `Deno` global, so — same pattern as
// test/doc18-three-call-sync-extract.test.mjs — install a minimal shim
// before importing.
// Same pattern as test/doc8-doc9-doc10-page-cap-and-thin-floor.test.mjs — a
// permanent minimal Deno shim for this process (Deno.env.get is the only
// member the module reads).
globalThis.Deno = globalThis.Deno || { env: { get: () => undefined } };

const {
  sfGatewayQuery,
  pickFlowMessage,
  SfGatewayError,
} = await import('../supabase/functions/_shared/salesforce-gateway.ts');

const FAKE_URL = 'https://prod-00.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=FAKE_SIGNATURE_NEVER_REAL';

function withEnv(vars, fn) {
  const prevGet = globalThis.Deno.env.get;
  const orig = { ...vars };
  globalThis.Deno.env.get = (k) => (k in orig ? orig[k] : prevGet(k));
  return fn().finally(() => {
    globalThis.Deno.env.get = prevGet;
  });
}

function stubFetch(impl) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = orig; };
}

let restoreFetch = null;

beforeEach(() => {
  restoreFetch = null;
});

afterEach(() => {
  if (restoreFetch) restoreFetch();
});

describe('pickFlowMessage', () => {
  it('returns a plain string unchanged', () => {
    assert.equal(pickFlowMessage('boom'), 'boom');
  });
  it('unwraps the first element of an array', () => {
    assert.equal(pickFlowMessage([{ message: 'first' }, { message: 'second' }]), 'first');
  });
  it('returns empty string for an empty array', () => {
    assert.equal(pickFlowMessage([]), '');
  });
  it('prefers .message on an object', () => {
    assert.equal(pickFlowMessage({ message: 'm', error_description: 'e' }), 'm');
  });
  it('falls back to error_description then errorMessage', () => {
    assert.equal(pickFlowMessage({ error_description: 'ed' }), 'ed');
    assert.equal(pickFlowMessage({ errorMessage: 'em' }), 'em');
  });
  it('JSON-stringifies an object with none of the known keys', () => {
    assert.equal(pickFlowMessage({ foo: 'bar' }), '{"foo":"bar"}');
  });
  it('returns empty string for null/undefined/number', () => {
    assert.equal(pickFlowMessage(null), '');
    assert.equal(pickFlowMessage(undefined), '');
    assert.equal(pickFlowMessage(42), '');
  });
});

describe('sfGatewayQuery — client-side guards (never reach the network)', () => {
  it('rejects a non-SELECT statement without calling fetch', async () => {
    let called = false;
    restoreFetch = stubFetch(async () => { called = true; return new Response('{}', { status: 200 }); });
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await assert.rejects(
        () => sfGatewayQuery('UPDATE Account SET Name = \'x\''),
        (err) => err instanceof SfGatewayError && err.reason === 'soql_rejected',
      );
    });
    assert.equal(called, false, 'fetch must not be called when the guard rejects');
  });

  it('rejects a statement containing a semicolon without calling fetch', async () => {
    let called = false;
    restoreFetch = stubFetch(async () => { called = true; return new Response('{}', { status: 200 }); });
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await assert.rejects(
        () => sfGatewayQuery("SELECT Id FROM Account; DELETE FROM Account"),
        (err) => err instanceof SfGatewayError && err.reason === 'soql_rejected',
      );
    });
    assert.equal(called, false);
  });

  it('rejects an empty soql string without calling fetch', async () => {
    let called = false;
    restoreFetch = stubFetch(async () => { called = true; return new Response('{}', { status: 200 }); });
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await assert.rejects(
        () => sfGatewayQuery('   '),
        (err) => err instanceof SfGatewayError && err.reason === 'soql_rejected',
      );
    });
    assert.equal(called, false);
  });

  it('accepts a leading-lowercase "select" and tolerates surrounding whitespace', async () => {
    restoreFetch = stubFetch(async () => new Response(JSON.stringify({
      ok: true, operation: 'soql', total_size: 0, done: true, records: [],
    }), { status: 200 }));
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      const result = await sfGatewayQuery('  select Id from Account limit 1  ');
      assert.equal(result.ok, true);
    });
  });
});

describe('sfGatewayQuery — gateway not configured', () => {
  it('throws gateway_not_configured when SF_LOOKUP_WEBHOOK_URL is unset', async () => {
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: undefined }, async () => {
      await assert.rejects(
        () => sfGatewayQuery('SELECT Id FROM Account LIMIT 1'),
        (err) => err instanceof SfGatewayError && err.reason === 'gateway_not_configured',
      );
    });
  });
});

describe('sfGatewayQuery — request shape', () => {
  it('POSTs operation/soql/max_rows/schema_version as JSON', async () => {
    let seenBody = null;
    let seenUrl = null;
    let seenMethod = null;
    let seenContentType = null;
    restoreFetch = stubFetch(async (url, init) => {
      seenUrl = String(url);
      seenMethod = init.method;
      seenContentType = init.headers['Content-Type'];
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, operation: 'soql', total_size: 1, done: true, records: [{ Id: '001x' }] }), { status: 200 });
    });
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await sfGatewayQuery('SELECT Id FROM Account LIMIT 1', { maxRows: 10 });
    });
    assert.equal(seenUrl, FAKE_URL);
    assert.equal(seenMethod, 'POST');
    assert.equal(seenContentType, 'application/json');
    assert.deepEqual(seenBody, {
      operation: 'soql',
      soql: 'SELECT Id FROM Account LIMIT 1',
      max_rows: 10,
      schema_version: 1,
    });
  });

  it('clamps max_rows to the hard ceiling of 500', async () => {
    let seenBody = null;
    restoreFetch = stubFetch(async (_url, init) => {
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, operation: 'soql', total_size: 0, done: true, records: [] }), { status: 200 });
    });
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await sfGatewayQuery('SELECT Id FROM Account', { maxRows: 999999 });
    });
    assert.equal(seenBody.max_rows, 500);
  });

  it('defaults max_rows to 200 when omitted, zero, or non-finite', async () => {
    const seen = [];
    restoreFetch = stubFetch(async (_url, init) => {
      seen.push(JSON.parse(init.body).max_rows);
      return new Response(JSON.stringify({ ok: true, operation: 'soql', total_size: 0, done: true, records: [] }), { status: 200 });
    });
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await sfGatewayQuery('SELECT Id FROM Account');
      await sfGatewayQuery('SELECT Id FROM Account', { maxRows: 0 });
      await sfGatewayQuery('SELECT Id FROM Account', { maxRows: NaN });
    });
    assert.deepEqual(seen, [200, 200, 200]);
  });
});

describe('sfGatewayQuery — response parsing (four error shapes + success)', () => {
  it('parses a success response, truncating records to max_rows', async () => {
    restoreFetch = stubFetch(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'soql',
      total_size: 3,
      done: true,
      records: [{ Id: '1' }, { Id: '2' }, { Id: '3' }],
    }), { status: 200 }));
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      const result = await sfGatewayQuery('SELECT Id FROM Account', { maxRows: 2 });
      assert.equal(result.ok, true);
      assert.equal(result.total_size, 3);
      assert.equal(result.done, true);
      assert.deepEqual(result.records, [{ Id: '1' }, { Id: '2' }]);
    });
  });

  it('throws flow_unreachable when fetch itself rejects (network failure)', async () => {
    restoreFetch = stubFetch(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await assert.rejects(
        () => sfGatewayQuery('SELECT Id FROM Account'),
        (err) => err instanceof SfGatewayError && err.reason === 'flow_unreachable',
      );
    });
  });

  it('throws flow_http_error on a non-2xx HTTP response', async () => {
    restoreFetch = stubFetch(async () => new Response(JSON.stringify({ error: { message: 'gateway 500' } }), { status: 500 }));
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await assert.rejects(
        () => sfGatewayQuery('SELECT Id FROM Account'),
        (err) => err instanceof SfGatewayError && err.reason === 'flow_http_error' && err.status === 500 && err.detail === 'gateway 500',
      );
    });
  });

  it('throws flow_reported_failure on a 200 with ok:false and a detail string', async () => {
    restoreFetch = stubFetch(async () => new Response(JSON.stringify({
      ok: false, reason: 'flow_reported_failure', detail: 'MALFORMED_QUERY: unexpected token',
    }), { status: 200 }));
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await assert.rejects(
        () => sfGatewayQuery('SELECT Id FROM Account'),
        (err) => err instanceof SfGatewayError
          && err.reason === 'flow_reported_failure'
          && err.detail === 'MALFORMED_QUERY: unexpected token',
      );
    });
  });

  it('passes through a flow-supplied soql_rejected reason from a 200 body', async () => {
    restoreFetch = stubFetch(async () => new Response(JSON.stringify({ ok: false, reason: 'soql_rejected' }), { status: 200 }));
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await assert.rejects(
        () => sfGatewayQuery('SELECT Id FROM Account'),
        (err) => err instanceof SfGatewayError && err.reason === 'soql_rejected',
      );
    });
  });

  it('coerces a non-string {message} error shape via pickFlowMessage rather than throwing TypeError', async () => {
    restoreFetch = stubFetch(async () => new Response(JSON.stringify({
      ok: false, detail: { message: 'wrapped error object' },
    }), { status: 200 }));
    await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, async () => {
      await assert.rejects(
        () => sfGatewayQuery('SELECT Id FROM Account'),
        (err) => err instanceof SfGatewayError && err.detail === 'wrapped error object',
      );
    });
  });
});

describe('positive control — no error path ever leaks the webhook URL or its signature', () => {
  const cases = [
    ['soql_rejected (client-side)', async () => {
      await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, () => sfGatewayQuery('DELETE FROM Account'));
    }],
    ['gateway_not_configured', async () => {
      await withEnv({ SF_LOOKUP_WEBHOOK_URL: undefined }, () => sfGatewayQuery('SELECT Id FROM Account'));
    }],
  ];

  for (const [label, run] of cases) {
    it(`${label} — thrown error carries no URL/sig fragment`, async () => {
      try {
        await run();
        assert.fail('expected sfGatewayQuery to throw');
      } catch (err) {
        const serialized = `${err.message} ${err.reason} ${err.detail ?? ''}`;
        assert.doesNotMatch(serialized, /sig=/);
        assert.doesNotMatch(serialized, /logic\.azure\.com/);
        assert.doesNotMatch(serialized, /FAKE_SIGNATURE/);
      }
    });
  }

  it('flow_http_error detail from a response body never happens to contain the request URL', async () => {
    restoreFetch = stubFetch(async () => new Response(JSON.stringify({ error: { message: 'upstream 503' } }), { status: 503 }));
    try {
      await withEnv({ SF_LOOKUP_WEBHOOK_URL: FAKE_URL }, () => sfGatewayQuery('SELECT Id FROM Account'));
      assert.fail('expected a throw');
    } catch (err) {
      assert.doesNotMatch(String(err.detail), /sig=/);
      assert.doesNotMatch(String(err.detail), /FAKE_SIGNATURE/);
    }
  });
});
