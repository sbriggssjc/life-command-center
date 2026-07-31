// api/_shared/outlook-search.js
// ============================================================================
// Outlook thread search — Power Automate flow proxy (deal-correspondence ingestion).
// Mirrors the Salesforce lookup pattern (salesforce.js): LCC posts a search seed, a Power
// Automate + Outlook flow searches the mailbox and returns matching messages, LCC logs them
// deal-stamped. Gated on OUTLOOK_SEARCH_WEBHOOK_URL — inert until Scott stands up the flow.
//
// FLOW CONTRACT (op 'deal_thread_search'):
//   POST <OUTLOOK_SEARCH_WEBHOOK_URL>
//   Body: { "operation":"deal_thread_search", "subjects":["<property/deal name>"],
//           "emails":["buyer@x.com", ...], "since":"2025-01-01", "top":50 }
//   Success (PA 200): { "ok":true, "messages":[ {
//       "internet_message_id","subject","from","to","received_at","body_preview","web_link" } ] }
//
// Returns { ok:true, messages:[...] } or { ok:false, reason }. Never throws.
// ============================================================================
import { fetchWithTimeout } from './ops-db.js';

export function isOutlookSearchConfigured() {
  return !!process.env.OUTLOOK_SEARCH_WEBHOOK_URL;
}

export async function getDealThreads({ subjects = [], emails = [], since = null, top = 50 } = {}) {
  const url = process.env.OUTLOOK_SEARCH_WEBHOOK_URL;
  if (!url) return { ok: false, reason: 'outlook_search_not_configured' };
  const cleanSubjects = (Array.isArray(subjects) ? subjects : []).map((s) => String(s || '').trim()).filter(Boolean);
  const cleanEmails = Array.from(new Set((Array.isArray(emails) ? emails : [])
    .map((e) => String(e || '').trim().toLowerCase()).filter((e) => e.includes('@'))));
  if (!cleanSubjects.length && !cleanEmails.length) return { ok: true, messages: [] };

  // Never send null-typed fields: Power Automate's Request trigger validates the body
  // against its JSON schema and 400s (TriggerInputSchemaMismatch) on a null where it typed
  // a string. Build the payload with only non-null values; `since` is omitted when absent
  // (the flow doesn't require it, and omitted != required since the schema marks nothing required).
  const payload = {
    operation: 'deal_thread_search',
    subjects: cleanSubjects,
    emails: cleanEmails,
    top: Number.isFinite(Number(top)) ? Number(top) : 50,
  };
  if (typeof since === 'string' && since.trim()) payload.since = since.trim();

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 20000);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    if (!res.ok) return { ok: false, reason: 'flow_http_error', status: res.status, detail: String(text || '').slice(0, 300) };
    if (!json || json.ok !== true) return { ok: false, reason: json?.reason || 'flow_reported_failure' };
    const rows = Array.isArray(json.messages) ? json.messages : Array.isArray(json.value) ? json.value : [];
    const messages = rows.map((m) => ({
      internet_message_id: m.internet_message_id || m.internetMessageId || m.id || null,
      subject:      m.subject || null,
      from:         m.from || m.From || (m.sender && (m.sender.address || m.sender.emailAddress?.address)) || null,
      to:           m.to || m.To || null,
      received_at:  m.received_at || m.receivedDateTime || m.receivedAt || null,
      body_snippet: m.body_preview || m.bodyPreview || m.snippet || null,
      web_link:     m.web_link || m.webLink || null,
    })).filter((m) => m.internet_message_id);
    return { ok: true, messages };
  } catch (e) {
    return { ok: false, reason: 'flow_unreachable', detail: String(e?.message || e).slice(0, 200) };
  }
}
