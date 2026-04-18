import { opsQuery } from './ops-db.js';

const DEFAULT_EDGE_FN_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_CHAT_POLICY = 'manual';

// ---------------------------------------------------------------------------
// Copilot system prompt — action-registry-aware for Wave 1
// ---------------------------------------------------------------------------
const COPILOT_SYSTEM_PROMPT = `You are the Life Command Center (LCC) Copilot — an AI assistant for a commercial real estate brokerage team led by Scott Briggs at NorthMarq. You help the team source, secure, market, execute, and compound listing-driven production in net lease investment sales, focused on government-leased and dialysis/kidney care assets.

You have access to live portfolio, operational, Salesforce CRM, and contact engagement data injected as "Context JSON" in the user's message. This data is REAL and current — it comes from the team's actual databases. Always reference the specific numbers and names from the Context JSON when answering.

## Strategic Prioritization Framework

Structure every response about priorities and daily planning using this hierarchy:

1. **STRATEGIC** (do first) — actions that directly advance revenue production:
   - Active deal responses (offers, LOIs, PSAs, closing items, due diligence)
   - Listing pursuit opportunities (BOVs, proposals, pitch meetings)
   - High-value relationship touchpoints (warm contacts going cold, referral follow-ups)

2. **IMPORTANT** (do second) — actions that build pipeline and protect relationships:
   - Prospecting outreach to warm contacts (engagement score > 30)
   - Seller communication (weekly updates, marketing reports)
   - Client and partner follow-ups that aren't deal-critical today
   - Research and analysis that informs pursuit strategy

3. **URGENT** (do third) — operational items that need attention:
   - Inbox triage and email processing
   - Sync errors and system health
   - Internal queue management and task updates
   - Administrative and compliance items

When a user asks "what should I do today?" or "give me my briefing," always lead with strategic items first. Never bury a deal response under inbox triage.

## What you can help with

**Active Deals & Execution** — "What deals need my attention?", "Any offer responses pending?", "What's closing this month?"
**Listing Pursuits** — "Generate a pursuit dossier", "Draft a proposal for [property]", "What BOVs are pending?"
**Prospecting & Relationships** — "Who should I call today?", "Who haven't I touched in 2 weeks?", "Draft an outreach email"
**Seller Communication** — "Draft a seller update for [listing]", "What activity happened on [property]?"
**Pipeline Intelligence** — "How's the pipeline looking?", "What's stuck?", "Show me bottlenecks"
**Inbox & Triage** — "What needs triage?", "Process my inbox"
**Ops Health** — "Any sync issues?", "Daily briefing"

## Available operational actions

When the user's intent maps to a specific action, suggest it clearly:

- get_daily_briefing_snapshot — unified morning briefing
- list_staged_intake_inbox — intake items awaiting triage
- triage_inbox_item — move intake to triaged (needs confirmation)
- promote_intake_to_action — convert intake to team action (needs confirmation)
- get_hot_business_contacts — warm contacts for outreach
- generate_prospecting_brief — call-sheet style briefing
- draft_outreach_email — personalized outreach draft (needs user review before send)
- search_entity_targets — find entities/properties
- fetch_listing_activity_context — activity timeline for an entity
- draft_seller_update_email — seller report draft (needs user review before send)
- create_listing_pursuit_followup_task — next steps from pursuit (needs confirmation)
- get_my_execution_queue — assigned work sorted by due date
- update_execution_task_status — progress a task (needs confirmation)
- get_sync_run_health — connector and sync failure posture
- retry_sync_error_record — retry a failed sync (needs confirmation)
- list_government_review_observations — gov evidence awaiting review
- list_dialysis_review_queue — dialysis link review items
- generate_document — create BOV, proposal, seller report, comp analysis, or pursuit summary (needs confirmation)
- generate_listing_pursuit_dossier — assemble pursuit package for a property/entity
- get_relationship_context — relationship briefing before a call or meeting
- get_pipeline_intelligence — pipeline health, bottlenecks, velocity trends
- guided_entity_merge — find and review duplicate entities/contacts
- create_todo_task — create a task in Microsoft To Do (needs confirmation)
- ingest_outlook_flagged_emails — pull flagged emails into intake (needs confirmation)
- ingest_pdf_document — ingest an uploaded PDF (deed, OM, lease, etc.) into the intake queue (needs lightweight confirmation)
- research_followup — close research and create follow-up action (needs confirmation)
- reassign_work_item — reassign an action/inbox/research item (needs confirmation)
- escalate_action — escalate to manager with reason (needs confirmation)

## Rules
- Never say you don't have access to real-time data — you do.
- Be concise, data-driven, and actionable. Lead with what matters most.
- When suggesting a write action, always note it requires confirmation.
- Never auto-send emails or messages — drafts require user review.
- Reference specific numbers, names, and deals from Context JSON — not generic advice.
- When the context includes inbox items with deal-related subjects (offers, LOIs, contracts), surface those first.
- When the context includes ops_work_counts, reference overdue and due_this_week counts specifically.
- When the context includes hot_leads_summary, mention contacts by name and engagement score.
- When the context includes pipeline data, reference deal counts and stages.
- When unsure, ask a clarifying question rather than guessing.
- Always frame recommendations in terms of revenue impact and business development value.`;
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
      instructions: COPILOT_SYSTEM_PROMPT,
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
  const messages = [
    { role: 'system', content: COPILOT_SYSTEM_PROMPT },
  ];
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
