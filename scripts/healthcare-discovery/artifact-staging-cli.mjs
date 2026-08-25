#!/usr/bin/env node

import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { serializeArtifactStagingReceipt, stageAscArtifacts } from './artifact-staging.mjs';
import { materializeDraftAuthorizationPacket } from './release-packet-preflight.mjs';

const FLAGS = new Set(['--template', '--request', '--approved-root', '--private-packet-output', '--receipt-output']);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function requireInsideRoot(root, candidate, label) {
  if (!isAbsolute(root) || !isAbsolute(candidate)) throw new Error(`${label} and approved root must be absolute paths`);
  const rel = relative(resolve(root), resolve(candidate));
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} must be a file inside the approved private root`);
}

async function requireCanonicalParentInsideRoot(root, candidate, label) {
  const canonicalRoot = await realpath(root);
  const canonicalParent = await realpath(dirname(candidate));
  const rel = relative(canonicalRoot, canonicalParent);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} parent must resolve inside the approved private root`);
}

async function requireCanonicalFileInsideRoot(root, candidate, label) {
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(candidate);
  const rel = relative(canonicalRoot, canonicalFile);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} must resolve inside the approved private root`);
}

async function assertDestinationAvailable(destination) {
  try {
    await lstat(destination);
    throw new Error(`Refusing to overwrite existing output: ${destination}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeAtomic(destination, contents) {
  const temporary = resolve(dirname(destination), `.${destination.split(/[\\/]/).at(-1)}.${process.pid}.tmp`);
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, destination);
}

export function parseArtifactStagingArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!FLAGS.has(flag) || !value || value.startsWith('--')) throw new Error('Arguments must provide template, request, approved root, private packet output, and receipt output');
    const name = flag.slice(2).replaceAll('-', '_');
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: ${flag}`);
    values[name] = value;
  }
  if (Object.keys(values).length !== FLAGS.size) throw new Error('All five staging arguments are required');
  return values;
}

export async function runArtifactStaging(values) {
  if (!isAbsolute(values.approved_root) || !isAbsolute(values.private_packet_output)) throw new Error('Approved root and private packet output must be absolute paths');
  const approvedRoot = resolve(values.approved_root);
  const requestPath = resolve(values.request);
  const privatePacketOutput = resolve(values.private_packet_output);
  const receiptOutput = resolve(values.receipt_output);
  requireInsideRoot(approvedRoot, requestPath, 'Private request');
  await requireCanonicalFileInsideRoot(approvedRoot, requestPath, 'Private request');
  requireInsideRoot(approvedRoot, privatePacketOutput, 'Private packet output');
  await requireCanonicalParentInsideRoot(approvedRoot, privatePacketOutput, 'Private packet output');
  if (privatePacketOutput === receiptOutput) throw new Error('Private packet and aggregate receipt outputs must differ');
  await assertDestinationAvailable(privatePacketOutput);
  await assertDestinationAvailable(receiptOutput);

  const template = JSON.parse(await readFile(resolve(values.template), 'utf8'));
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  const staged = await stageAscArtifacts({
    template,
    approvedRoot,
    artifacts: request.artifacts,
    verifierAttestations: request.verifier_attestations,
  });
  const packet = materializeDraftAuthorizationPacket(template, {
    ...request.authorization_envelope,
    packet_version: 'healthcare_private_run_authorization:1.0',
    source_manifest_release_id: staged.release.release_fingerprint,
    artifacts: staged.release.artifacts,
  });
  if (packet.status !== 'draft_unapproved' || packet.approvals.length !== 0) throw new Error('Staging may only create an unapproved draft packet');

  await writeAtomic(privatePacketOutput, `${canonicalJson(packet)}\n`);
  await writeAtomic(receiptOutput, serializeArtifactStagingReceipt(staged.receipt));
  return { packet, receipt: staged.receipt };
}

export async function run(argv = process.argv.slice(2), io = console) {
  try {
    const values = parseArtifactStagingArgs(argv);
    if (values.help) {
      io.log('Usage: healthcare:artifact-staging -- --template <path> --request <path> --approved-root <absolute-private-path> --private-packet-output <path-inside-private-root> --receipt-output <path>');
      return 0;
    }
    const result = await runArtifactStaging(values);
    io.log(`ASC artifacts staged as ${result.packet.status}; execution remains unauthorized`);
    return 0;
  } catch (error) {
    io.error(error.message);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
