// api/_shared/outlook-draft.js
//
// Org-sanctioned outbound email path: instead of calling Microsoft Graph
// directly (which requires a tenant-admin app registration that is likely
// not available to us), LCC posts the fully-rendered draft to a Power
// Automate HTTP-trigger flow ("LCC Create Outlook Draft"). That flow uses
// the Office 365 Outlook connector — running under the user's already-
// consented M365 connection — to create the draft in Outlook.
//
// Env:
//   PA_OUTLOOK_DRAFT_URL    Required. The flow's HTTP POST trigger URL
//                           (the SAS-signed logic.azure.com invoke URL).
//   PA_OUTLOOK_DRAFT_SECRET Optional. If set, sent as X-LCC-Flow-Secret and
//                           validated inside the flow as a shared-secret gate
//                           on top of the SAS signature.
//
// The flow definition that consumes this payload lives at
// flow-lcc-create-outlook-draft.json (repo root). Keep the two in sync.

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Create an Outlook draft via the Power Automate flow.
 *
 * @param {Object} draft
 * @param {string|string[]} draft.to                 Recipient address(es). Required.
 * @param {string|string[]} [draft.cc]               CC address(es).
 * @param {string}          draft.subject            Subject line. Required.
 * @param {string}          draft.body_html          HTML body. Required.
 * @param {string}          [draft.in_reply_to]      Internet messageId of the message
 *                                                   being replied to (threads the draft).
 * @param {string}          [draft.attachment_url]   Publicly fetchable URL the flow will
 *                                                   download and attach (e.g. a report PDF).
 * @param {string}          [draft.attachment_name]  Filename for the attachment.
 * @param {Object}          [opts]
 * @param {number}          [opts.timeoutMs]
 * @returns {Promise<{ok:boolean, draft_id?:string, web_link?:string, error?:string, fallback?:string}>}
 */
export async function createOutlookDraftViaPA(draft = {}, opts = {}) {
  const flowUrl = process.env.PA_OUTLOOK_DRAFT_URL;
  if (!flowUrl) {
    return {
      ok: false,
      error: 'PA_OUTLOOK_DRAFT_URL not configured — the LCC Create Outlook Draft flow URL is missing.',
      fallback: 'text',
    };
  }

  const to = Array.isArray(draft.to) ? draft.to : (draft.to ? [draft.to] : []);
  const cc = Array.isArray(draft.cc) ? draft.cc : (draft.cc ? [draft.cc] : []);

  if (to.length === 0) return { ok: false, error: 'to (recipient) is required', fallback: 'text' };
  if (!draft.subject) return { ok: false, error: 'subject is required', fallback: 'text' };
  if (!draft.body_html) return { ok: false, error: 'body_html is required', fallback: 'text' };

  // Office 365 Outlook connector takes semicolon-delimited recipient strings.
  const payload = {
    to: to.join(';'),
    cc: cc.join(';'),
    subject: draft.subject,
    body_html: draft.body_html,
    in_reply_to: draft.in_reply_to || '',
    attachment_url: draft.attachment_url || '',
    attachment_name: draft.attachment_name || '',
  };

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.PA_OUTLOOK_DRAFT_SECRET) {
    headers['X-LCC-Flow-Secret'] = process.env.PA_OUTLOOK_DRAFT_SECRET;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(flowUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* non-JSON response */ }

    if (!res.ok) {
      return {
        ok: false,
        error: `Outlook draft flow returned ${res.status}`,
        detail: text.slice(0, 500),
        fallback: 'text',
      };
    }

    return {
      ok: parsed.ok !== false,
      draft_id: parsed.draft_id || parsed.id || null,
      web_link: parsed.web_link || parsed.webLink || null,
    };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? 'Outlook draft flow timed out' : ('Outlook draft flow request failed: ' + err.message),
      fallback: 'text',
    };
  } finally {
    clearTimeout(timer);
  }
}

export default { createOutlookDraftViaPA };
