import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import { assertAscResearchImport } from '../../api/_shared/asc-research-lane.js';

const USAGE = `Usage:
  npm run healthcare:asc:research-import -- \\
    --worksheet <private-50-row-json> \\
    --sample-receipt <aggregate-sample-receipt-json> \\
    --lcc-url <https://railway-host> [--workspace-id <uuid>]

LCC_API_KEY must be set in the environment. This command imports exactly the
authorized frozen 50 into the private ASC research overlay. It performs no
canonical, Salesforce, outreach, opportunity, or IDTF writes.`;

export function parseAscResearchImportArgs(argv) {
  const allowed = new Set(['worksheet', 'sample-receipt', 'lcc-url', 'workspace-id']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith('--') || !value || value.startsWith('--')) throw new Error(USAGE);
    const key = token.slice(2);
    if (!allowed.has(key) || Object.hasOwn(parsed, key)) throw new Error(USAGE);
    parsed[key] = value;
  }
  for (const key of ['worksheet', 'sample-receipt', 'lcc-url']) if (!parsed[key]) throw new Error(USAGE);
  return parsed;
}

export async function runAscResearchImport({ args, apiKey = process.env.LCC_API_KEY, fetchFn = fetch }) {
  if (!apiKey) throw new Error('LCC_API_KEY is required');
  const [worksheet, receipt] = await Promise.all([
    readFile(args.worksheet, 'utf8').then(JSON.parse),
    readFile(args['sample-receipt'], 'utf8').then(JSON.parse),
  ]);
  const payload = {
    release_id: receipt.release_id,
    selection_fingerprint: receipt.selection_fingerprint,
    candidate_pool_fingerprint: receipt.candidate_pool_fingerprint,
    packet_id: receipt.packet_id,
    candidates: worksheet,
  };
  assertAscResearchImport(payload);
  const url = `${args['lcc-url'].replace(/\/+$/, '')}/api/asc-research-import`;
  const headers = { 'Content-Type': 'application/json', 'X-LCC-Key': apiKey };
  if (args['workspace-id']) headers['X-LCC-Workspace'] = args['workspace-id'];
  const response = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ASC research import failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAscResearchImport({ args: parseAscResearchImportArgs(process.argv.slice(2)) })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
