import fs from 'node:fs';
import path from 'node:path';

export function parseEnvText(raw) {
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

export function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return parseEnvText(fs.readFileSync(filePath, 'utf8'));
}

export function loadEnvForScripts(cwd = process.cwd()) {
  const localPath = path.resolve(cwd, '.env.local');
  const examplePath = path.resolve(cwd, '.env.example');
  return {
    ...readEnvFile(examplePath),
    ...readEnvFile(localPath),
    ...process.env,
  };
}
