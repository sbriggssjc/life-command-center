#!/usr/bin/env node

import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildOfficialAscCandidatePack, serializeOfficialAscCandidatePackReceipt } from './official-asc-candidate-pack.mjs';

const FLAGS = new Set(['--approved-root', '--authorized-packet', '--authorization-receipt', '--private-candidates-output', '--private-crosswalk-output', '--private-contract-output', '--receipt-output']);

async function assertInside(root, candidate, label, existing = true) {
  if (!isAbsolute(root) || !isAbsolute(candidate)) throw new Error(`${label} and approved root must be absolute paths`);
  const canonicalRoot = await realpath(root);
  const target = existing ? await realpath(candidate) : await realpath(dirname(candidate));
  const rel = relative(canonicalRoot, target);
  if ((existing && !rel) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} must resolve inside the approved private root`);
}

async function assertAbsent(filePath) {
  try { await lstat(filePath); throw new Error(`Refusing to overwrite existing output: ${filePath}`); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function writeAtomic(filePath, contents) {
  const temp = resolve(dirname(filePath), `.${filePath.split(/[\\/]/).at(-1)}.${process.pid}.tmp`);
  await writeFile(temp, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temp, filePath);
}

export function parseOfficialAscCandidatePackArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!FLAGS.has(flag) || !value || value.startsWith('--')) throw new Error('Arguments must provide the seven candidate-pack paths');
    const name = flag.slice(2).replaceAll('-', '_');
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: ${flag}`);
    values[name] = value;
  }
  if (Object.keys(values).length !== FLAGS.size) throw new Error('All seven candidate-pack arguments are required');
  return values;
}

export async function runOfficialAscCandidatePack(values) {
  const root = resolve(values.approved_root);
  const packetPath = resolve(values.authorized_packet);
  const candidatesOutput = resolve(values.private_candidates_output);
  const crosswalkOutput = resolve(values.private_crosswalk_output);
  const contractOutput = resolve(values.private_contract_output);
  const receiptOutput = resolve(values.receipt_output);
  const posPath = join(root, 'cms_pos_iqies_q2_2026.csv');
  const qualityPath = join(root, 'cms_ascqr_facility_2026-05-13.csv');
  const enrollmentPath = join(root, 'cms_ffs_enrollment_2026-07-17.csv');
  const paymentPath = join(root, 'cms_asc_payment_july_2026.zip');
  await Promise.all([
    assertInside(root, packetPath, 'Authorized packet'), assertInside(root, posPath, 'POS source'),
    assertInside(root, qualityPath, 'ASCQR source'), assertInside(root, enrollmentPath, 'Enrollment source'),
    assertInside(root, paymentPath, 'ASC payment source'),
    assertInside(root, candidatesOutput, 'Candidate output', false), assertInside(root, crosswalkOutput, 'Crosswalk output', false),
    assertInside(root, contractOutput, 'Contract output', false),
  ]);
  const outputs = [candidatesOutput, crosswalkOutput, contractOutput, receiptOutput];
  if (new Set(outputs).size !== outputs.length) throw new Error('Candidate-pack outputs must be distinct');
  await Promise.all(outputs.map(assertAbsent));
  const [packet, authorizationReceipt] = await Promise.all([
    readFile(packetPath, 'utf8').then(JSON.parse),
    readFile(resolve(values.authorization_receipt), 'utf8').then(JSON.parse),
  ]);
  const result = await buildOfficialAscCandidatePack({ packet, authorizationReceipt, posPath, qualityPath, enrollmentPath, paymentPath });
  await writeAtomic(candidatesOutput, `${JSON.stringify(result.candidates, null, 2)}\n`);
  await writeAtomic(crosswalkOutput, `${JSON.stringify(result.crosswalk, null, 2)}\n`);
  await writeAtomic(contractOutput, `${JSON.stringify(result.contract, null, 2)}\n`);
  await writeAtomic(receiptOutput, serializeOfficialAscCandidatePackReceipt(result.receipt));
  return result;
}

export async function run(argv = process.argv.slice(2), io = console) {
  try {
    const values = parseOfficialAscCandidatePackArgs(argv);
    if (values.help) { io.log('Usage: healthcare:asc:candidate-pack -- --approved-root <absolute-private-path> --authorized-packet <private-path> --authorization-receipt <path> --private-candidates-output <private-path> --private-crosswalk-output <private-path> --private-contract-output <private-path> --receipt-output <path>'); return 0; }
    const result = await runOfficialAscCandidatePack(values);
    io.log(`Official ASC candidate pack created: ${result.candidates.length} certified candidates; 50 sample slots allocated`);
    return 0;
  } catch (error) { io.error(error.message); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
