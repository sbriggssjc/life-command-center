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

export async function invokeChatProvider({ message, context, history, user, workspaceId }) {
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
