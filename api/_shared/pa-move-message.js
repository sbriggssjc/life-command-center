// ============================================================================
// PA move-message relay — outbound POST to the "LCC Processing Complete → Move
// Message" Power Automate flow.
// Life Command Center · "Closing the Loop" mailbox-mechanics layer (Flow 1)
//
// WHY: after LCC classifies + files an intake, it needs Outlook to actually MOVE
// the source email into its Processed/* destination. Scott built an HTTP-trigger
// PA flow ("Move email (V2)") that finds exactly ONE message by
// internet_message_id and moves it to a target folder. This helper is the LCC
// side of that call — it POSTs a SINGLE processing-complete event immediately
// (never batched/queued): one POST == one message moved. The delivery model is
// deliberately single-event because the PA trigger resolves one
// internet_message_id per invocation; a batch payload would break it.
//
// The trigger URL carries a live `sig` credential, so it is read from the
// PA_MOVE_MESSAGE_WEBHOOK_URL env var — never hardcoded. It lives in the RAILWAY
// env (production runs on the Railway Express server; Vercel is legacy).
//
// Mirrors api/_shared/storage-adapter.js::uploadDocToFolder: env-gated (503 when
// unset), tolerant JSON parse, NEVER throws, returns {ok, status, detail}, and
// `fetchImpl` is injectable for tests. Adds bounded retry with exponential
// backoff for transient network / 5xx failures (the git-ops convention).
// ============================================================================

// Transient failures (network error or 5xx) get retried; a 4xx (bad request /
// auth) is a permanent failure and is returned immediately — retrying a 4xx just
// burns the same error four times.
const DEFAULT_MAX_RETRIES = 4;      // 4 attempts total after the first (5 tries)
const BACKOFF_BASE_MS = 2000;       // 2s → 4s → 8s → 16s

function backoffMs(attempt) {
  // attempt is 1-based for the FIRST retry
  return BACKOFF_BASE_MS * 2 ** (attempt - 1);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST a single processing-complete move instruction to the PA move-message flow.
 *
 * @param {object}   o
 * @param {string}   o.internetMessageId  Outlook internet_message_id — the move key
 * @param {string}   o.targetFolder       destination folder (e.g. "Processed/News")
 * @param {string}  [o.outcome]           disposition label (auto_filed / duplicate / …)
 * @param {object}  [o.passthrough]       extra flow fields to forward verbatim when
 *                                        present (correlation_id / schema_version /
 *                                        subject). Undefined keys are dropped, so the
 *                                        relay works against BOTH the minimal
 *                                        {id,folder,outcome} flow shape AND the fuller
 *                                        build-sheet schema (correlation_id/schema_version
 *                                        marked required). `outcome` is also mirrored to
 *                                        `disposition` so a flow expecting either name works.
 * @param {Function} [o.fetchImpl]        fetch impl (defaults to global fetch)
 * @param {Function} [o.sleepImpl]        sleep impl (injectable so tests don't wait)
 * @param {number}   [o.maxRetries]       transient-failure retries (default 4)
 * @returns {Promise<{ok:boolean, status:number, detail?:string, attempts:number,
 *                     server_relative_url?:string}>}
 *   503 when PA_MOVE_MESSAGE_WEBHOOK_URL is unset (safe no-op until configured);
 *   400 on a missing internet_message_id / target_folder;
 *   the flow's status on a real send. Never throws.
 */
export async function postMoveMessage({
  internetMessageId,
  targetFolder,
  outcome,
  passthrough,
  fetchImpl,
  sleepImpl,
  maxRetries = DEFAULT_MAX_RETRIES,
} = {}) {
  const moveUrl = process.env.PA_MOVE_MESSAGE_WEBHOOK_URL;
  if (!moveUrl) return { ok: false, status: 503, detail: 'PA_MOVE_MESSAGE_WEBHOOK_URL unset', attempts: 0 };
  if (!internetMessageId || typeof internetMessageId !== 'string') {
    return { ok: false, status: 400, detail: 'missing internet_message_id', attempts: 0 };
  }
  if (!targetFolder || typeof targetFolder !== 'string') {
    return { ok: false, status: 400, detail: 'missing target_folder', attempts: 0 };
  }

  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  const sleep = sleepImpl || defaultSleep;
  // Core 3-field contract (the flow's minimal shape). `disposition` mirrors
  // `outcome` so a flow keyed on either name resolves it. Forward any present
  // passthrough fields (correlation_id / schema_version / subject) verbatim so a
  // flow whose trigger schema marks them `required` doesn't fail fast.
  const body = {
    internet_message_id: internetMessageId,
    target_folder: targetFolder,
    outcome: outcome || null,
    disposition: outcome || null,
  };
  if (passthrough && typeof passthrough === 'object') {
    for (const [k, v] of Object.entries(passthrough)) {
      if (v !== undefined && v !== null) body[k] = v;
    }
  }
  const payload = JSON.stringify(body);

  let attempts = 0;
  let last = { ok: false, status: 0, detail: 'not_attempted' };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    try {
      const res = await doFetch(moveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      const text = await res.text().catch(() => '');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }

      // Logical-failure detection: an HTTP 200 with ok:false is NOT a success.
      const logicalOk = json ? json.ok !== false : true;
      if (res.ok && logicalOk) {
        return {
          ok: true,
          status: res.status,
          attempts,
          server_relative_url: json?.server_relative_url || undefined,
        };
      }

      last = {
        ok: false,
        status: res.status,
        detail: String(json?.error || text || 'pa_move_failed').slice(0, 200),
        attempts,
      };
      // 4xx (client/auth) is permanent AND a logical ok:false on a 2xx is not
      // retryable (the flow rejected the payload, not a transient blip) — return.
      if (res.status < 500) return last;
      // else fall through to retry on 5xx
    } catch (err) {
      // Network / timeout error — transient, retry.
      last = { ok: false, status: 0, detail: err?.message?.slice(0, 200) || 'pa_move_error', attempts };
    }

    if (attempt < maxRetries) await sleep(backoffMs(attempt + 1));
  }

  return last;
}
