import { authenticate, handleCors } from './_shared/auth.js';
import { requireOps, withErrorHandler } from './_shared/ops-db.js';
import { invokeChatProvider, logAiMetric } from './_shared/ai.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const { message, context, history, attachments } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  const safeAttachments = Array.isArray(attachments)
    ? attachments
      .filter((item) => item && typeof item === 'object')
      .slice(0, 3)
      .map((item) => ({
        type: typeof item.type === 'string' ? item.type : 'image',
        mime_type: typeof item.mime_type === 'string' ? item.mime_type : '',
        name: typeof item.name === 'string' ? item.name : '',
        data_url: typeof item.data_url === 'string' ? item.data_url : '',
      }))
      .filter((item) => item.data_url)
    : [];

  const startedAt = Date.now();
  const result = await invokeChatProvider({ message, context, history, attachments: safeAttachments, user, workspaceId });
  const durationMs = Date.now() - startedAt;

  const usage = result.data?.usage || result.data?.metrics?.usage || null;
  await logAiMetric(workspaceId, user.id, 'chat', durationMs, {
    feature: 'global_copilot',
    provider: result.provider,
    status: result.status,
    had_context: !!context && Object.keys(context || {}).length > 0,
    history_count: Array.isArray(history) ? history.length : 0,
    attachment_count: safeAttachments.length,
    attachment_types: safeAttachments.map((item) => item.type || 'image'),
    message_chars: message.length,
    usage,
  });

  if (!result.ok) {
    return res.status(result.status || 502).json({
      error: result.data?.error || 'AI provider request failed',
      detail: result.data?.detail,
      provider: result.provider,
    });
  }

  return res.status(200).json({
    ...result.data,
    provider: result.provider,
    telemetry: {
      duration_ms: durationMs,
    },
  });
});
