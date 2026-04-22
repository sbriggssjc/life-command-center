// ============================================================================
// Teams Alert Helper — Push notifications via Adaptive Card webhooks
// Life Command Center — Intelligence Layer
//
// Shared utility for sending event-triggered Teams notifications.
// All calls are fire-and-forget — Teams alerts must NEVER break calling workflows.
// ============================================================================

/**
 * Send an Adaptive Card notification to a Teams channel via incoming webhook.
 *
 * @param {object} params
 * @param {string} params.title - Card title (shown with severity emoji)
 * @param {string} [params.summary] - Body text below the title
 * @param {Array<[string, string]>} [params.facts] - Key-value pairs displayed as FactSet
 * @param {Array<{label: string, url: string}>} [params.actions] - Action buttons
 * @param {'critical'|'high'|'info'|'success'} [params.severity='info'] - Controls emoji and color
 * @param {string} [params.webhookUrl] - Override webhook URL (defaults to TEAMS_INTAKE_WEBHOOK_URL)
 */
export async function sendTeamsAlert({ title, summary, facts = [], actions = [], severity = 'info', webhookUrl }) {
  const url = webhookUrl || process.env.TEAMS_INTAKE_WEBHOOK_URL;
  if (!url) return { ok: false, reason: 'no_webhook_url' };

  const card = {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          {
            type: "TextBlock",
            text: `${severityEmoji(severity)} ${title}`,
            weight: "Bolder",
            size: "Medium",
            color: severityColor(severity)
          },
          summary ? { type: "TextBlock", text: summary, wrap: true } : null,
          facts.length > 0 ? {
            type: "FactSet",
            facts: facts.map(([title, value]) => ({ title, value: String(value) }))
          } : null
        ].filter(Boolean),
        actions: actions.map(a => ({
          type: "Action.OpenUrl",
          title: a.label,
          url: a.url
        }))
      }
    }]
  };

  // Return a small status object so callers can surface whether the POST
  // actually succeeded — crucial for debugging inconsistent Teams webhook
  // behavior without access to runtime console logs.
  try {
    const t0 = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card)
    });
    const ms = Date.now() - t0;
    let bodyText = '';
    try { bodyText = (await res.text()).slice(0, 300); } catch { /* ignore */ }
    return {
      ok: res.ok,
      status: res.status,
      ms,
      body_snippet: bodyText,
      url_length: url.length,
      url_has_sig: /[?&]sig=/.test(url),
    };
  } catch (err) {
    console.error('[Teams alert failed]', err?.message);
    return {
      ok: false,
      reason: 'fetch_threw',
      error: err?.message || String(err),
      url_length: url.length,
      url_has_sig: /[?&]sig=/.test(url),
    };
  }
}

function severityEmoji(s) {
  return { critical: '\u{1F6A8}', high: '\u26A0\uFE0F', info: '\u2139\uFE0F', success: '\u2705' }[s] || '\u2139\uFE0F';
}

function severityColor(s) {
  return { critical: 'Attention', high: 'Warning', info: 'Default', success: 'Good' }[s] || 'Default';
}
