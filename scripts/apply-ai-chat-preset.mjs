import fs from 'node:fs';
import path from 'node:path';

function parseEnvText(raw) {
  const env = {};
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    env[key] = value;
  });
  return env;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return parseEnvText(fs.readFileSync(filePath, 'utf8'));
}

function buildEnvText(env, existingRaw = '') {
  const lines = existingRaw ? existingRaw.split(/\r?\n/) : [];
  const seen = new Set();
  const output = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      output.push(line);
      continue;
    }
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      output.push(`${key}=${env[key]}`);
      seen.add(key);
    } else {
      output.push(line);
    }
  }

  const missingKeys = Object.keys(env).filter((key) => !seen.has(key));
  if (missingKeys.length) {
    if (output.length && output[output.length - 1] !== '') output.push('');
    output.push('# AI chat preset overrides');
    missingKeys.forEach((key) => output.push(`${key}=${env[key]}`));
  }

  return output.join('\n');
}

const args = process.argv.slice(2);
const presetArg = args[0];
if (!presetArg) {
  console.error('Usage: node scripts/apply-ai-chat-preset.mjs <preset-file> [--target .env.local] [--write]');
  process.exit(1);
}

let target = '.env.local';
let write = false;
for (let i = 1; i < args.length; i += 1) {
  if (args[i] === '--target' && args[i + 1]) {
    target = args[i + 1];
    i += 1;
  } else if (args[i] === '--write') {
    write = true;
  }
}

const presetPath = path.resolve(process.cwd(), presetArg);
const targetPath = path.resolve(process.cwd(), target);
if (!fs.existsSync(presetPath)) {
  console.error(`Preset file not found: ${presetPath}`);
  process.exit(1);
}

const presetRaw = fs.readFileSync(presetPath, 'utf8');
const presetEnv = parseEnvText(presetRaw);
const targetRaw = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
const targetEnv = parseEnvText(targetRaw);

const merged = { ...targetEnv, ...presetEnv };
const changedKeys = Object.keys(presetEnv).filter((key) => targetEnv[key] !== presetEnv[key]);
const nextText = buildEnvText(merged, targetRaw);

console.log(`Preset: ${presetPath}`);
console.log(`Target: ${targetPath}`);
console.log(write ? 'Mode: write' : 'Mode: dry-run');
console.log('');
console.log('Changed keys:');
changedKeys.forEach((key) => console.log(`- ${key}=${presetEnv[key]}`));

if (!write) {
  console.log('');
  console.log('Dry run only. Re-run with --write to update the target env file.');
  process.exit(0);
}

fs.writeFileSync(targetPath, nextText, 'utf8');
console.log('');
console.log(`Wrote ${targetPath}`);
