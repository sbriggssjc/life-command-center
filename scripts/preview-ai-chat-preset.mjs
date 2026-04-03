import fs from 'node:fs';
import path from 'node:path';
import { parseEnvText } from './_env-file.mjs';

function parseJsonEnv(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const CHAT_POLICY_PRESETS = {
  balanced: {
    providers: {
      detail_intake_assistant: 'ollama',
      detail_intel_assistant: 'ollama',
      ops_research_assistant: 'ollama',
      detail_ownership_assistant: 'openai',
      global_copilot: 'edge',
    },
    models: {
      detail_intake_assistant: 'llama3.2-vision',
      detail_intel_assistant: 'llama3.1',
      ops_research_assistant: 'llama3.1',
      detail_ownership_assistant: 'gpt-5-mini',
    },
  },
};

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/preview-ai-chat-preset.mjs <preset-env-file>');
  process.exit(1);
}

const presetPath = path.resolve(process.cwd(), arg);
if (!fs.existsSync(presetPath)) {
  console.error(`Preset file not found: ${presetPath}`);
  process.exit(1);
}

const env = parseEnvText(fs.readFileSync(presetPath, 'utf8'));
const policy = String(env.AI_CHAT_POLICY || 'manual').toLowerCase();
const preset = CHAT_POLICY_PRESETS[policy] || { providers: {}, models: {} };
const defaultProvider = String(env.AI_CHAT_PROVIDER || 'edge').toLowerCase();
const defaultModel = env.AI_CHAT_MODEL || env.AI_MODEL || 'gpt-5-mini';
const featureProviders = { ...preset.providers, ...parseJsonEnv(env.AI_CHAT_FEATURE_PROVIDERS, {}) };
const featureModels = { ...preset.models, ...parseJsonEnv(env.AI_CHAT_FEATURE_MODELS, {}) };

const knownFeatures = [
  'global_copilot',
  'ops_research_assistant',
  'detail_ownership_assistant',
  'detail_intel_assistant',
  'detail_intake_assistant',
];

const rows = knownFeatures.map((feature) => ({
  feature,
  provider: featureProviders[feature] || defaultProvider,
  model: featureModels[feature] || defaultModel,
}));

console.log('AI Chat Preset Preview');
console.log(`Preset file: ${presetPath}`);
console.log(`Policy: ${policy}`);
console.log(`Default provider: ${defaultProvider}`);
console.log(`Default model: ${defaultModel}`);
console.log('');
console.table(rows);

if (Object.keys(featureProviders).length || Object.keys(featureModels).length) {
  console.log('Resolved overrides');
  console.log(JSON.stringify({ featureProviders, featureModels }, null, 2));
}
