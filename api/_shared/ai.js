import { opsQuery } from './ops-db.js';

const DEFAULT_EDGE_FN_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';

function normalizeBaseUrl(url) {
  return (url || '').replace(/\/+$/, '');
}

export function getAiConfig() {
  return {
    provider: (process.env.AI_CHAT_PROVIDER || 'edge').toLowerCase(),
    edgeBaseUrl: normalizeBaseUrl(process.env.AI_CHAT_URL || process.env.EDGE_FUNCTION_URL || DEFAULT_EDGE_FN_URL),
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
  const inputTokens = Number(usage.input_tokens || usage.prompt_tokens || usage.input || 0);
  const outputTokens = Number(usage.output_tokens || usage.completion_tokens || usage.output || 0);
  const totalTokens = Number(usage.total_tokens || (inputTokens + outputTokens) || 0);
  return {
    raw: usage && Object.keys(usage).length ? usage : null,
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

export async function invokeChatProvider({ message, context, history, attachments, user, workspaceId }) {
  const cfg = getAiConfig();
  if (cfg.provider === 'disabled' || cfg.provider === 'none') {
    return { ok: false, status: 503, data: { error: 'AI chat provider is disabled' }, provider: cfg.provider };
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
