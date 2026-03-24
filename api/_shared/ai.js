import { opsQuery } from './ops-db.js';

const DEFAULT_EDGE_FN_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function normalizeBaseUrl(url) {
  return (url || '').replace(/\/+$/, '');
}

export function getAiConfig() {
  return {
    provider: (process.env.AI_CHAT_PROVIDER || 'edge').toLowerCase(),
    edgeBaseUrl: normalizeBaseUrl(process.env.AI_CHAT_URL || process.env.EDGE_FUNCTION_URL || DEFAULT_EDGE_FN_URL),
    openaiBaseUrl: normalizeBaseUrl(process.env.AI_API_BASE_URL || DEFAULT_OPENAI_BASE_URL),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    chatModel: process.env.AI_CHAT_MODEL || process.env.AI_MODEL || 'gpt-5-mini',
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

async function invokeOpenAIResponses({ message, context, history, attachments, cfg }) {
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
      model: cfg.chatModel,
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
      model: data?.model || cfg.chatModel,
      response: responseText || data?.response || data?.message || data?.reply || '',
    },
  };
}

function stripDataUrlPrefix(dataUrl = '') {
  const match = String(dataUrl).match(/^data:.*?;base64,(.*)$/);
  return match?.[1] || dataUrl;
}

async function invokeOllamaChat({ message, context, history, attachments, cfg }) {
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
      model: cfg.chatModel,
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
      model: data?.model || cfg.chatModel,
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
  if (cfg.provider === 'disabled' || cfg.provider === 'none') {
    return { ok: false, status: 503, data: { error: 'AI chat provider is disabled' }, provider: cfg.provider };
  }

  if (cfg.provider === 'openai') {
    return invokeOpenAIResponses({ message, context, history, attachments, cfg });
  }

  if (cfg.provider === 'ollama') {
    return invokeOllamaChat({ message, context, history, attachments, cfg });
  }

  if (cfg.provider !== 'edge') {
    return { ok: false, status: 400, data: { error: `Unsupported AI chat provider: ${cfg.provider}` }, provider: cfg.provider };
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

  return { ok: res.ok, status: res.status, data, provider: cfg.provider, baseUrl: cfg.edgeBaseUrl };
}
