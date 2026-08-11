#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { runLaneProfile } from './lane-profile.mjs';

export async function run(argv = process.argv.slice(2), io = console) {
  const values = {};
  try {
    if (argv.includes('--help')) {
      io.log('Usage: healthcare:lane:profile -- --manifest <path> --output <path>');
      return 0;
    }
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (!['--manifest', '--output'].includes(flag) || !value || value.startsWith('--')) throw new Error('Arguments must be --manifest <path> --output <path>');
      const name = flag.slice(2);
      if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: ${flag}`);
      values[name] = value;
    }
    if (!values.manifest || !values.output) throw new Error('Both --manifest and --output are required');
    await runLaneProfile(values.manifest, values.output);
    io.log('Healthcare lane aggregate profile receipt written');
    return 0;
  } catch (error) {
    io.error(error.message);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
