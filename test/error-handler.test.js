import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withErrorHandler } from '../api/_shared/ops-db.js';

// Mock response object
function mockRes() {
  const res = {
    _status: null,
    _json: null,
    headersSent: false,
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; res.headersSent = true; return res; }
  };
  return res;
}

describe('withErrorHandler', () => {
  it('passes through successful handlers', async () => {
    const handler = withErrorHandler(async (req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = mockRes();
    await handler({}, res);
    assert.equal(res._status, 200);
    assert.deepEqual(res._json, { ok: true });
  });

  it('catches thrown errors and returns 500', async () => {
    const handler = withErrorHandler(async () => {
      throw new Error('Database connection failed');
    });

    const res = mockRes();
    await handler({ method: 'GET', url: '/test' }, res);
    assert.equal(res._status, 500);
    assert.equal(res._json.error, 'Internal server error');
  });

  it('does not send response if headers already sent', async () => {
    const handler = withErrorHandler(async (req, res) => {
      res.status(200).json({ partial: true });
      throw new Error('After response');
    });

    const res = mockRes();
    await handler({ method: 'GET', url: '/test' }, res);
    // Should still have original response
    assert.equal(res._status, 200);
    assert.deepEqual(res._json, { partial: true });
  });
});
