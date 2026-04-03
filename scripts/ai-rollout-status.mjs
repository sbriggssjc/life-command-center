import path from 'node:path';
import { loadEnvForScripts } from './_env-file.mjs';

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

const env = loadEnvForScripts();
const policy = String(env.AI_CHAT_POLICY || 'manual').toLowerCase();
const preset = CHAT_POLICY_PRESETS[policy] || { providers: {}, models: {} };
const defaultProvider = String(env.AI_CHAT_PROVIDER || 'edge').toLowerCase();
const defaultModel = env.AI_CHAT_MODEL || env.AI_MODEL || 'gpt-5-mini';
const featureProviders = { ...preset.providers, ...parseJsonEnv(env.AI_CHAT_FEATURE_PROVIDERS, {}) };
const featureModels = { ...preset.models, ...parseJsonEnv(env.AI_CHAT_FEATURE_MODELS, {}) };

const features = [
  'global_copilot',
  'ops_research_assistant',
  'detail_ownership_assistant',
  'detail_intel_assistant',
  'detail_intake_assistant',
];

const rows = features.map((feature) => ({
  feature,
  provider: featureProviders[feature] || defaultProvider,
  model: featureModels[feature] || defaultModel,
}));

console.log('AI Rollout Status');
console.log(`Policy: ${policy}`);
console.log(`Default provider: ${defaultProvider}`);
console.log(`Default model: ${defaultModel}`);
console.log('');
console.table(rows);
console.log('Operational files');
console.log(`- Checklist: ${path.resolve(process.cwd(), 'AI_CHAT_ROLLOUT_CHECKLIST.md')}`);
console.log(`- Results template: ${path.resolve(process.cwd(), 'AI_CHAT_ROLLOUT_RESULTS_TEMPLATE.md')}`);
console.log(`- Worklog: ${path.resolve(process.cwd(), 'LCC_AI_COST_AND_CHATBOT_REVIEW.md')}`);
