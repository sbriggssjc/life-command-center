// ============================================================================
// share-extractor.js — Vision/text extraction for /api/intake-share
// Life Command Center
//
// Calls the OpenAI Responses API directly. We deliberately do NOT route
// through invokeChatProvider here:
//   1. The Supabase ai-copilot/chat edge function ignores attachments, so
//      screenshot-based extraction would silently lose its primary signal.
//   2. That same edge function pins claude-sonnet-4-20250514 (May 2025
//      snapshot), which Anthropic has retired — calls return 400 with
//      "Claude API error" until the function is updated.
//   3. Structured-JSON extraction prefers a model + endpoint we can drive
//      deterministically; the chat path injects a copilot system prompt
//      that biases output away from strict JSON.
//
// Env:
//   OPENAI_API_KEY        — required
//   AI_API_BASE_URL       — optional override (default https://api.openai.com/v1)
//   AI_INTAKE_SHARE_MODEL — optional override (default gpt-4o-mini)
// ============================================================================

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL           = 'gpt-4o-mini';

const SCHEMA = `{
  "domain": "gov_lease" | "dialysis" | "general",
  "deal_status": "for_sale" | "under_contract" | "sold" | "leased" | "marketing" | "research" | null,
  "property": {
    "name": string|null,
    "address": string|null,
    "city": string|null,
    "state": string|null,
    "zip": string|null,
    "sf": number|null,
    "acres": number|null,
    "year_built": number|null,
    "asset_type": string|null
  },
  "tenant": {
    "name": string|null,
    "agency": string|null,
    "credit_rating": string|null,
    "lease_commencement": "YYYY-MM-DD"|null,
    "lease_expiration": "YYYY-MM-DD"|null,
    "lease_term_years": number|null,
    "options": string|null,
    "termination_rights": string|null
  },
  "transaction": {
    "sale_date": "YYYY-MM-DD"|null,
    "sale_price_usd": number|null,
    "cap_rate": number|null,
    "buyer": string|null,
    "seller": string|null
  },
  "brokers": [
    { "name": string, "firm": string|null, "role": string|null }
  ],
  "post": {
    "platform": "linkedin" | "instagram" | "twitter" | "email" | "article" | "other",
    "author_name": string|null,
    "author_firm": string|null,
    "author_title": string|null,
    "post_url": string|null,
    "summary": string
  },
  "confidence": number,
  "warnings": [string]
}`;

const SYSTEM = `You extract structured commercial-real-estate intel from social media posts, emails, and articles for a brokerage focused on government-leased and dialysis/kidney-care assets. Output ONLY valid JSON conforming to the schema. If a field is unknown, use null. Do not invent data. Do not include markdown code fences.`;

function buildPrompt({ url, text, notes, source, domain_hint }) {
  const lines = [
    SYSTEM,
    '',
    'Output schema (JSON only, no fences, no prose):',
    SCHEMA,
    '',
    'Domain rules:',
    '- gov_lease: tenant is a federal/state/county/municipal agency, GSA, "State of *", "Department of *", US courthouse, or military.',
    '- dialysis: tenant is DaVita, Fresenius, USRC, American Renal, Satellite Healthcare, or facility is described as a dialysis/kidney/renal clinic.',
    '- general: any other property/deal worth tracking.',
    '',
    'Cap rate: express as a decimal (7.25% -> 0.0725).',
    'Dates: format as YYYY-MM-DD; if only month/year given, use the first of that month.',
    'Confidence: 0.0 to 1.0 — how confident you are the extraction is accurate.',
    'Warnings: array of short strings flagging missing fields or ambiguity.',
    '',
    `Source platform hint: ${source || 'unknown'}`,
  ];
  if (domain_hint) lines.push(`User domain hint: ${domain_hint}`);
  if (url)         lines.push(`Post URL: ${url}`);
  if (text)        lines.push('', 'Shared text:', text);
  if (notes)       lines.push('', `User notes: ${notes}`);
  lines.push('', 'Attached images (if any) are screenshots of the post — read all visible text.');
  lines.push('Return JSON only.');
  return lines.join('\n');
}

function parseJsonResponse(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractResponseText(data = {}) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const outputs = Array.isArray(data.output) ? data.output : [];
  const parts = [];
  for (const item of outputs) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

async function callOpenAIResponses({ prompt, attachments }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const baseUrl = (process.env.AI_API_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const model   = process.env.AI_INTAKE_SHARE_MODEL || DEFAULT_MODEL;

  const content = [{ type: 'input_text', text: prompt }];
  for (const att of attachments) {
    if (att?.data_url) {
      content.push({ type: 'input_image', image_url: att.data_url, detail: 'auto' });
    }
  }

  const res = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [{ type: 'message', role: 'user', content }],
      store: false,
    }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: { message: 'Invalid JSON response from OpenAI' } };
  }

  if (!res.ok) {
    const detail = data?.error?.message || data?.error || `status ${res.status}`;
    throw new Error(`OpenAI ${res.status}: ${detail}`);
  }

  return { text: extractResponseText(data), model: data?.model || model };
}

export async function extractFromShare({ url, text, notes, source, domain_hint, images = [] }) {
  const prompt = buildPrompt({ url, text, notes, source, domain_hint });
  const attachments = (images || []).filter((img) => img?.data_url);

  const { text: responseText } = await callOpenAIResponses({ prompt, attachments });
  const parsed = parseJsonResponse(responseText);
  if (!parsed) {
    throw new Error('extractor returned non-JSON response');
  }
  return parsed;
}
