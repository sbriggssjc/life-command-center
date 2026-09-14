import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseAscResearchImportArgs, runAscResearchImport } from '../scripts/healthcare-discovery/asc-research-import-cli.mjs';

const sha = (digit) => digit.repeat(64);

test('ASC research import CLI requires the private worksheet, receipt, and LCC URL', () => {
  assert.deepEqual(parseAscResearchImportArgs([
    '--worksheet', 'worksheet.json', '--sample-receipt', 'receipt.json', '--lcc-url', 'https://lcc.example',
  ]), { worksheet: 'worksheet.json', 'sample-receipt': 'receipt.json', 'lcc-url': 'https://lcc.example' });
  assert.throws(() => parseAscResearchImportArgs(['--worksheet', 'worksheet.json']), /Usage/);
  assert.throws(() => parseAscResearchImportArgs(['--unknown', 'x']), /Usage/);
});

test('ASC research import CLI sends exactly one bound 50-row private request', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asc-research-import-'));
  const worksheet = Array.from({ length: 50 }, (_, index) => ({
    candidate_fingerprint: index.toString(16).padStart(64, '0'),
    sampling_cell: 'south__single_site',
    cms_identity: { ccn: String(100000 + index), address: `${index + 1} Main St`, city: 'Tulsa', state: 'OK', zip: '74103' },
    cms_evidence: {},
  }));
  const receipt = { release_id: sha('a'), selection_fingerprint: sha('b'), candidate_pool_fingerprint: sha('c'), packet_id: sha('d') };
  const worksheetPath = path.join(root, 'worksheet.json'); const receiptPath = path.join(root, 'receipt.json');
  await Promise.all([writeFile(worksheetPath, JSON.stringify(worksheet)), writeFile(receiptPath, JSON.stringify(receipt))]);
  let call;
  const result = await runAscResearchImport({
    args: { worksheet: worksheetPath, 'sample-receipt': receiptPath, 'lcc-url': 'https://lcc.example' },
    apiKey: 'test-key',
    fetchFn: async (url, options) => { call = { url, options }; return { ok: true, status: 201, json: async () => ({ ok: true }) }; },
  });
  assert.equal(result.ok, true);
  assert.equal(call.url, 'https://lcc.example/api/asc-research-import');
  assert.equal(JSON.parse(call.options.body).candidates.length, 50);
  assert.equal(call.options.headers['X-LCC-Key'], 'test-key');
});
