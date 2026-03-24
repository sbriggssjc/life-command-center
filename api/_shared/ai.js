import { opsQuery } from './ops-db.js';

const DEFAULT_EDGE_FN_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_CHAT_POLICY = 'manual';
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

function normalizeBaseUrl(url) {
  return (url || '').replace(/\/+$/, '');
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getAiConfig() {
  const policyName = (process.env.AI_CHAT_POLICY || DEFAULT_CHAT_POLICY).toLowerCase();
  const preset = CHAT_POLICY_PRESETS[policyName] || { providers: {}, models: {} };
  const envFeatureProviders = parseJsonEnv(process.env.AI_CHAT_FEATURE_PROVIDERS, {});
  const envFeatureModels = parseJsonEnv(process.env.AI_CHAT_FEATURE_MODELS, {});
  return {
    provider: (process.env.AI_CHAT_PROVIDER || 'edge').toLowerCase(),
    edgeBaseUrl: normalizeBaseUrl(process.env.AI_CHAT_URL || process.env.EDGE_FUNCTION_URL || DEFAULT_EDGE_FN_URL),
    openaiBaseUrl: normalizeBaseUrl(process.env.AI_API_BASE_URL || DEFAULT_OPENAI_BASE_URL),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    chatModel: process.env.AI_CHAT_MODEL || process.env.AI_MODEL || 'gpt-5-mini',
    chatPolicy: policyName,
    featureProviders: { ...preset.providers, ...envFeatureProviders },
    featureModels: { ...preset.models, ...envFeatureModels },
  };
}

export async function logAiMetric(workspaceId, userId, endpoint, durationMs, metadata = {}) {
  if (!workspaceId) return;
  try {
    await opsQuery('POST', 'perf_metrics', {
      workspace_id: workspaceId,
      user_id: userId || null,
      metric_type: 'ai_call',
      endpoint,
      duration_ms: Math.max(1, Math.round(durationMs || 0)),
      metadata,
    });
  } catch {
    // Fire-and-forget
  }
}

export function normalizeAiUsage(payload = {}) {
  const usage = payload?.usage || payload?.metrics?.usage || {};
  const inputTokens = Number(
    usage.input_tokens ||
    usage.prompt_tokens ||
    usage.input ||
    payload?.prompt_eval_count ||
    0
  );
  const outputTokens = Number(
    usage.output_tokens ||
    usage.completion_tokens ||
    usage.output ||
    payload?.eval_count ||
    0
  );
  const totalTokens = Number(usage.total_tokens || (inputTokens + outputTokens) || 0);
  return {
    raw: (usage && Object.keys(usage).length ? usage : null) || (
      payload?.prompt_eval_count != null || payload?.eval_count != null
        ? {
            prompt_tokens: payload?.prompt_eval_count || 0,
            completion_tokens: payload?.eval_count || 0,
            total_tokens: totalTokens,
          }
        : null
    ),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

export function normalizeAiTelemetry(payload = {}) {
  const usage = normalizeAiUsage(payload);
  const telemetry = payload?.telemetry || payload?.metrics || {};
  const cacheRead = Number(
    telemetry?.cache_read_tokens ||
    telemetry?.cached_input_tokens ||
    payload?.cache_read_tokens ||
    usage.raw?.cached_tokens ||
    0
  );
  return {
    usage,
    model: payload?.model || payload?.response_model || payload?.metrics?.model || telemetry?.model || null,
    cache_hit: Boolean(
      payload?.cache_hit ||
      telemetry?.cache_hit ||
      cacheRead > 0
    ),
    cache_read_tokens: cacheRead,
  };
}

export function resolveAiRoute(cfg, context = {}) {
  const feature = context?.assistant_feature || context?.feature || 'global_copilot';
  const configuredProvider = cfg.featureProviders?.[feature];
  const configuredModel = cfg.featureModels?.[feature];
  return {
    feature,
    provider: (configuredProvider || cfg.provider || 'edge').toLowerCase(),
    model: configuredModel || cfg.chatModel || 'gpt-5-mini',
  };
}

function buildContextText(context = {}) {
  if (!context || typeof context !== 'object' || !Object.keys(context).length) return '';
  return `Context JSON:\n${JSON.stringify(context, null, 2)}`;
}

function toResponseMessage(role, text, attachments = [], contextText = '') {
  const content = [];
  const textParts = [];
  if (contextText && role === 'user') textParts.push(contextText);
  if (text) textParts.push(text);
  if (textParts.length) {
    content.push({
      type: 'input_text',
      text: textParts.join('\n\n'),
    });
  }
  if (role === 'user' && Array.isArray(attachments)) {
    attachments.forEach((item) => {
      if (!item?.data_url) return;
      content.push({
        type: 'input_image',
        image_url: item.data_url,
        detail: 'auto',
      });
    });
  }
  return {
    type: 'message',
    role,
    content,
  };
}

function extractResponseText(data = {}) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const outputs = Array.isArray(data.output) ? data.output : [];
  const parts = [];
  outputs.forEach((item) => {
    if (item?.type !== 'message' || !Array.isArray(item.content)) return;
    item.content.forEach((contentItem) => {
      if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
        parts.push(contentItem.text);
      }
    });
  });
  return parts.join('\n').trim();
}

async function invokeOpenAIResponses({ message, context, history, attachments, cfg, route }) {
  if (!cfg.openaiApiKey) {
    return { ok: false, status: 503, data: { error: 'OPENAI_API_KEY is not configured' }, provider: 'openai' };
  }

  const contextText = buildContextText(context);
  const input = [];
  if (Array.isArray(history)) {
    history.slice(-8).forEach((item) => {
      if (!item?.content || !item?.role) return;
      const role = item.role === 'assistant' ? 'assistant' : 'user';
      input.push(toResponseMessage(role, String(item.content), [], ''));
    });
  }
  input.push(toResponseMessage('user', message, attachments, contextText));

  const res = await fetch(`${cfg.openaiBaseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: route.model,
      input,
      store: false,
    }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: 'Invalid OpenAI response' };
  }

  const responseText = extractResponseText(data);
  return {
    ok: res.ok,
    status: res.status,
    provider: 'openai',
    baseUrl: cfg.openaiBaseUrl,
    data: {
      ...data,
      model: data?.model || route.model,
      response: responseText || data?.response || data?.message || data?.reply || '',
    },
  };
}

function stripDataUrlPrefix(dataUrl = '') {
  const match = String(dataUrl).match(/^data:.*?;base64,(.*)$/);
  return match?.[1] || dataUrl;
}

async function invokeOllamaChat({ message, context, history, attachments, cfg, route }) {
  const baseUrl = cfg.openaiBaseUrl || 'http://localhost:11434/api';
  const messages = [];
  const contextText = buildContextText(context);

  if (Array.isArray(history)) {
    history.slice(-8).forEach((item) => {
      if (!item?.content || !item?.role) return;
      messages.push({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.content),
      });
    });
  }

  const userMessage = {
    role: 'user',
    content: [contextText, message].filter(Boolean).join('\n\n'),
  };
  if (Array.isArray(attachments) && attachments.length) {
    userMessage.images = attachments
      .filter((item) => item?.data_url)
      .map((item) => stripDataUrlPrefix(item.data_url));
  }
  messages.push(userMessage);

  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages,
      stream: false,
    }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: 'Invalid Ollama response' };
  }

  return {
    ok: res.ok,
    status: res.status,
    provider: 'ollama',
    baseUrl,
    data: {
      ...data,
      model: data?.model || route.model,
      response: data?.message?.content || data?.response || '',
      usage: {
        prompt_tokens: Number(data?.prompt_eval_count || 0),
        completion_tokens: Number(data?.eval_count || 0),
        total_tokens: Number((data?.prompt_eval_count || 0) + (data?.eval_count || 0)),
      },
    },
  };
}

export async function invokeChatProvider({ message, context, history, attachments, user, workspaceId }) {
  const cfg = getAiConfig();
  const route = resolveAiRoute(cfg, context);
  if (route.provider === 'disabled' || route.provider === 'none') {
    return { ok: false, status: 503, data: { error: 'AI chat provider is disabled' }, provider: route.provider };
  }

  if (route.provider === 'openai') {
    return invokeOpenAIResponses({ message, context, history, attachments, cfg, route });
  }

  if (route.provider === 'ollama') {
    return invokeOllamaChat({ message, context, history, attachments, cfg, route });
  }

  if (route.provider !== 'edge') {
    return { ok: false, status: 400, data: { error: `Unsupported AI chat provider: ${route.provider}` }, provider: route.provider };
  }

  const res = await fetch(`${cfg.edgeBaseUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LCC-Workspace': workspaceId || '',
      'X-LCC-User-Id': user?.id || '',
      'X-LCC-User-Email': user?.email || '',
    },
    body: JSON.stringify({
      message,
      context: context || {},
      history: Array.isArray(history) ? history : [],
      attachments: Array.isArray(attachments) ? attachments : [],
    }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: 'Invalid AI provider response' };
  }

  return { ok: res.ok, status: res.status, data, provider: route.provider, baseUrl: cfg.edgeBaseUrl, route };
}
