// ============================================================================
// share-extractor.js — Vision/text extraction for /api/intake-share
// Life Command Center
//
// Routes through the existing AI provider stack (invokeChatProvider) so the
// extraction prompt benefits from the same Claude/OpenAI/edge fallback chain
// that powers /api/intake-extract. Returns a strict-JSON property/deal record.
// ============================================================================

import { invokeChatProvider } from './ai.js';

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

export async function extractFromShare({ url, text, notes, source, domain_hint, images = [] }) {
  const prompt = buildPrompt({ url, text, notes, source, domain_hint });
  const attachments = (images || []).map((img) => ({
    data_url: img.data_url,
    mimeType: img.mime_type,
  }));

  const result = await invokeChatProvider({
    message: prompt,
    context: { assistant_feature: 'detail_intake_assistant' },
    history: [],
    attachments,
    user: { id: 'system' },
    workspaceId: null,
  });

  if (!result.ok) {
    const err = result.data?.error || `provider returned ${result.status}`;
    throw new Error(`extraction failed: ${err}`);
  }

  const responseText =
    result.data?.response ||
    result.data?.message?.content ||
    result.data?.output_text ||
    '';
  const parsed = parseJsonResponse(responseText);
  if (!parsed) {
    throw new Error('extractor returned non-JSON response');
  }
  return parsed;
}
