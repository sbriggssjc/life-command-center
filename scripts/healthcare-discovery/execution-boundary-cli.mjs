#!/usr/bin/env node

import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { authorizeExecutionBoundary, serializeExecutionBoundaryReceipt } from './execution-boundary.mjs';

const FLAGS = new Set(['--approved-root', '--draft-packet', '--staging-receipt', '--approvals', '--authorized-packet-output', '--receipt-output']);

async function assertInside(root, candidate, label, existing = true) {
  if (!isAbsolute(root) || !isAbsolute(candidate)) throw new Error(`${label} and approved root must be absolute paths`);
  const canonicalRoot = await realpath(root);
  const target = existing ? await realpath(candidate) : await realpath(dirname(candidate));
  const rel = relative(canonicalRoot, target);
  if ((existing && !rel) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} must resolve inside the approved private root`);
}

async function assertAbsent(path) {
  try {
    await lstat(path);
    throw new Error(`Refusing to overwrite existing output: ${path}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeAtomic(path, contents) {
  const temp = resolve(dirname(path), `.${path.split(/[\\/]/).at(-1)}.${process.pid}.tmp`);
  await writeFile(temp, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}

export function parseExecutionBoundaryArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!FLAGS.has(flag) || !value || value.startsWith('--')) throw new Error('Arguments must provide the six execution-boundary paths');
    const name = flag.slice(2).replaceAll('-', '_');
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: ${flag}`);
    values[name] = value;
  }
  if (Object.keys(values).length !== FLAGS.size) throw new Error('All six execution-boundary arguments are required');
  return values;
}

export async function runExecutionBoundary(values) {
  const root = resolve(values.approved_root);
  const draft = resolve(values.draft_packet);
  const staging = resolve(values.staging_receipt);
  const approvalsPath = resolve(values.approvals);
  const authorizedOutput = resolve(values.authorized_packet_output);
  const receiptOutput = resolve(values.receipt_output);
  await assertInside(root, draft, 'Draft packet');
  await assertInside(root, approvalsPath, 'Approvals file');
  await assertInside(root, authorizedOutput, 'Authorized packet output', false);
  if (authorizedOutput === receiptOutput) throw new Error('Authorized packet and aggregate receipt outputs must differ');
  await assertAbsent(authorizedOutput);
  await assertAbsent(receiptOutput);
  const [packet, stagingReceipt, approvals] = await Promise.all([
    readFile(draft, 'utf8').then(JSON.parse),
    readFile(staging, 'utf8').then(JSON.parse),
    readFile(approvalsPath, 'utf8').then(JSON.parse),
  ]);
  const result = authorizeExecutionBoundary({ packet, stagingReceipt, approvals });
  await writeAtomic(authorizedOutput, `${JSON.stringify(result.packet, null, 2)}\n`);
  await writeAtomic(receiptOutput, serializeExecutionBoundaryReceipt(result.receipt));
  return result;
}

export async function run(argv = process.argv.slice(2), io = console) {
  try {
    const values = parseExecutionBoundaryArgs(argv);
    if (values.help) {
      io.log('Usage: healthcare:execution-boundary -- --approved-root <absolute-private-path> --draft-packet <path> --staging-receipt <path> --approvals <path> --authorized-packet-output <path-inside-private-root> --receipt-output <path>');
      return 0;
    }
    const result = await runExecutionBoundary(values);
    io.log(`ASC execution boundary validated: ${result.packet.status}`);
    return 0;
  } catch (error) {
    io.error(error.message);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
