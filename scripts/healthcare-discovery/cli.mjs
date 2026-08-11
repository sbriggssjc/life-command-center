#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export const COMMANDS = Object.freeze({
  manifest: { required: ['release', 'private-root'], optional: [] },
  validate: { required: ['manifest'], optional: [] },
  profile: { required: ['manifest', 'output'], optional: [] },
  load: { required: ['manifest', 'mode'], optional: [] },
  sample: { required: ['run-id', 'size', 'seed'], optional: [] },
  verify: { required: ['run-id'], optional: [] },
});

export function usage(command) {
  const spec = COMMANDS[command];
  if (!spec) return 'Usage: healthcare:nppes:<manifest|validate|profile|load|sample|verify> --help';
  const args = spec.required.map((name) => `--${name} <value>`).join(' ');
  return `Usage: healthcare:nppes:${command} -- ${args}`;
}

export function parseArgs(command, argv) {
  const spec = COMMANDS[command];
  if (!spec) throw new Error(`Unknown command: ${command || '(missing)'}`);
  if (argv.includes('--help')) return { help: true };

  const allowed = new Set([...spec.required, ...spec.optional]);
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('Arguments must use --name <value> pairs');
    }
    const name = flag.slice(2);
    if (!allowed.has(name)) throw new Error(`Unknown argument: --${name}`);
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: --${name}`);
    values[name] = value;
  }
  const missing = spec.required.filter((name) => !values[name]);
  if (missing.length) throw new Error(`Missing required argument(s): ${missing.map((x) => `--${x}`).join(', ')}`);
  if (command === 'load' && values.mode !== 'dry-run') {
    throw new Error('Phase A supports only --mode dry-run');
  }
  return { help: false, values };
}

export function run(argv = process.argv.slice(2), io = console) {
  const [command, ...args] = argv;
  try {
    const parsed = parseArgs(command, args);
    if (parsed.help) {
      io.log(usage(command));
      return 0;
    }
    io.error(`healthcare:nppes:${command} is contract-only in Phase A0; execution is not implemented`);
    return 2;
  } catch (error) {
    io.error(error.message);
    io.error(usage(command));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = run();
