#!/usr/bin/env node

import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { executeAuthorizedAscSample, serializeSampleExecutionReceipt } from './sample-execution.mjs';

const FLAGS = new Set(['--approved-root', '--authorized-packet', '--authorization-receipt', '--sampling-contract', '--candidates', '--private-frame-output', '--receipt-output']);

async function assertInside(root, candidate, label, existing = true) {
  if (!isAbsolute(root) || !isAbsolute(candidate)) throw new Error(`${label} and approved root must be absolute paths`);
  const canonicalRoot = await realpath(root);
  const target = existing ? await realpath(candidate) : await realpath(dirname(candidate));
  const rel = relative(canonicalRoot, target);
  if ((existing && !rel) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} must resolve inside the approved private root`);
}

async function assertAbsent(path) {
  try { await lstat(path); throw new Error(`Refusing to overwrite existing output: ${path}`); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function writeAtomic(path, contents) {
  const temp = resolve(dirname(path), `.${path.split(/[\\/]/).at(-1)}.${process.pid}.tmp`);
  await writeFile(temp, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}

export function parseSampleExecutionArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!FLAGS.has(flag) || !value || value.startsWith('--')) throw new Error('Arguments must provide the seven sample-execution paths');
    const name = flag.slice(2).replaceAll('-', '_');
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: ${flag}`);
    values[name] = value;
  }
  if (Object.keys(values).length !== FLAGS.size) throw new Error('All seven sample-execution arguments are required');
  return values;
}

export async function runSampleExecution(values) {
  const root = resolve(values.approved_root);
  const packetPath = resolve(values.authorized_packet);
  const contractPath = resolve(values.sampling_contract);
  const candidatesPath = resolve(values.candidates);
  const frameOutput = resolve(values.private_frame_output);
  const receiptOutput = resolve(values.receipt_output);
  await Promise.all([
    assertInside(root, packetPath, 'Authorized packet'),
    assertInside(root, contractPath, 'Sampling contract'),
    assertInside(root, candidatesPath, 'Candidate file'),
    assertInside(root, frameOutput, 'Private frame output', false),
  ]);
  if (frameOutput === receiptOutput) throw new Error('Private frame and aggregate receipt outputs must differ');
  await Promise.all([assertAbsent(frameOutput), assertAbsent(receiptOutput)]);
  const [packet, authorizationReceipt, contract, candidates] = await Promise.all([
    readFile(packetPath, 'utf8').then(JSON.parse),
    readFile(resolve(values.authorization_receipt), 'utf8').then(JSON.parse),
    readFile(contractPath, 'utf8').then(JSON.parse),
    readFile(candidatesPath, 'utf8').then(JSON.parse),
  ]);
  const result = executeAuthorizedAscSample({ packet, authorizationReceipt, contract, candidates });
  await writeAtomic(frameOutput, `${JSON.stringify(result.frame, null, 2)}\n`);
  await writeAtomic(receiptOutput, serializeSampleExecutionReceipt(result.receipt));
  return result;
}

export async function run(argv = process.argv.slice(2), io = console) {
  try {
    const values = parseSampleExecutionArgs(argv);
    if (values.help) { io.log('Usage: healthcare:sample-execution -- --approved-root <absolute-private-path> --authorized-packet <private-path> --authorization-receipt <path> --sampling-contract <private-path> --candidates <private-path> --private-frame-output <private-path> --receipt-output <path>'); return 0; }
    const result = await runSampleExecution(values);
    io.log(`ASC private sample frozen: ${result.frame.sample_size} properties`);
    return 0;
  } catch (error) { io.error(error.message); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
