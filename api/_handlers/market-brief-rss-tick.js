// ============================================================================
// MB2 — the P-RSS market-brief producer (daily healthcare news -> dialysis
// facts, on-box Ollama only).
//
//   GET  -> dry run. Reads today's briefing_intel_snapshot.sector_news.
//           healthcare, classifies each article's dialysis relevance +
//           candidate facts via Ollama (fails closed), applies the verbatim-
//           number check, and reports what WOULD be written — no writes.
//   POST -> apply (flag-gated MARKET_BRIEF_PRSS). Logs to producer_runs on
//           the P123 lifecycle.
//
// FAILS CLOSED. If OLLAMA_URL is unset or every article's model call errors,
// the run is recorded status='skipped' with a skip_reason naming why, and
// ZERO facts are written — never a silent empty night mistaken for "no news
// today" (spec §3: "Ollama down -> producer_runs.status='skipped', no
// facts").
//
// SECTION ASSIGNMENT. The article's extracted facts land in whichever
// section the CLAIM shape suggests — a simple, deterministic keyword router
// (never the model's own opinion of its section, which would be one more
// place for it to hallucinate structure). Defaults to 'policy' when nothing
// matches, since most healthcare-news items reaching this stream are
// regulatory/payer items rather than operator or trade news.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { opsQuery } from '../_shared/ops-db.js';
import { invokeOnPremGeneration } from '../_shared/ai.js';
import { fetchIntelSnapshot } from '../_shared/briefing-data.js';
import { extractRssFactsWithOllama, buildRssFactRows } from '../_shared/market-brief-rss.js';
import { sectionTtlDays, staleAfterIso } from '../_shared/market-brief-facts.js';

const FLAG = 'MARKET_BRIEF_PRSS';
const PRODUCER = 'p_rss';
const MAX_ARTICLES_PER_RUN = 12;

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

const SECTION_KEYWORDS = [
  ['policy', /\b(cms|medicare|medicaid|pps|reimburs|rule|regulat|policy|payer)\b/i],
  ['operators', /\b(davita|fresenius|u\.?s\.? renal|acquir|merger|earnings|operator)\b/i],
  ['capital_markets', /\b(cap rate|reit|acquisition|portfolio sale|investor)\b/i],
];

function classifySection(claimText) {
  for (const [section, re] of SECTION_KEYWORDS) {
    if (re.test(claimText)) return section;
  }
  return 'policy';
}

async function openRun(lane, triggerSource) {
  const r = await opsQuery('POST', 'producer_runs', {
    producer: PRODUCER, lane, status: 'started', trigger_source: triggerSource,
  }, { headers: { Prefer: 'return=representation' } });
  const row = Array.isArray(r?.data) ? r.data[0] : r?.data;
  return row?.run_id || null;
}

async function closeRun(runId, patch) {
  if (!runId) return;
  await opsQuery('PATCH', `producer_runs?run_id=eq.${runId}`, {
    finished_at: new Date().toISOString(),
    ...patch,
  }).catch(() => null);
}

/** Insert-or-skip on the EB1 uq_mbf_source_identity index (lane, section, source_url, source_date, claim_text). */
async function insertRssFact(row, apply) {
  const existing = await opsQuery('GET',
    `market_brief_facts?lane=eq.${encodeURIComponent(row.lane)}&section=eq.${encodeURIComponent(row.section)}`
    + `&source_url=eq.${encodeURIComponent(row.source_url || '')}&source_date=eq.${encodeURIComponent(row.source_date || '')}`
    + `&claim_text=eq.${encodeURIComponent(row.claim_text)}&limit=1&select=id,status`,
    undefined, { countMode: 'none' });
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    return { action: 'skip_duplicate', id: existing.data[0].id };
  }
  if (apply) {
    const ins = await opsQuery('POST', 'market_brief_facts', { ...row, status: 'live' }).catch(() => null);
    if (!ins || !ins.ok) return { action: 'insert_failed' };
  }
  return { action: 'insert_new' };
}

export async function handleMarketBriefRssTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET/POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const q = { ...(req.query || {}), ...(req.body || {}) };
  const lane = String(q.lane || 'dialysis').toLowerCase();
  const stream = String(q.stream || 'healthcare').toLowerCase();
  const isApply = req.method === 'POST' && !truthy(q.dry_run);
  const force = truthy(q.force);
  const asOfIso = new Date().toISOString();

  const flagRow = await fetchFeatureFlag(FLAG);
  const enabled = flagEnabled(FLAG, flagRow);

  if (isApply && !enabled && !force) {
    const runId = await openRun(lane, 'api');
    await closeRun(runId, { status: 'skipped', skip_reason: `flag ${FLAG} is off` });
    return res.status(200).json({
      ok: true, mode: 'apply', skipped: 'flag_off', lane,
      flag: { name: FLAG, enabled, registry_state: flagRow?.state || null },
      hint: `Set ${FLAG}=true (env or feature_flags_registry) to enable, or call with ?force=1.`,
    });
  }

  const ollamaConfigured = !!String(process.env.OLLAMA_URL || '').trim();
  if (!ollamaConfigured) {
    // Named skip per spec §3 — never a silent zero-fact night.
    const runId = isApply ? await openRun(lane, req.body?.trigger_source || 'api') : null;
    if (isApply) await closeRun(runId, { status: 'skipped', skip_reason: 'OLLAMA_URL unset — on-box generation unavailable' });
    return res.status(200).json({
      ok: true, mode: isApply ? 'apply' : 'dry_run', skipped: 'ollama_unconfigured', lane,
      hint: 'Set OLLAMA_URL to the GaryBuilt endpoint before this producer can extract facts.',
    });
  }

  const runId = isApply ? await openRun(lane, req.body?.trigger_source || 'api') : null;

  try {
    const snapshot = await fetchIntelSnapshot(null).catch((err) => { throw new Error(`intel_snapshot: ${err?.message || err}`); });
    const articles = (snapshot?.sector_news?.[stream] || []).slice(0, MAX_ARTICLES_PER_RUN);

    if (!articles.length) {
      if (isApply) await closeRun(runId, { status: 'completed', facts_written: 0, detail: { reason: 'no_articles_in_snapshot', stream } });
      return res.status(200).json({
        ok: true, mode: isApply ? 'apply' : 'dry_run', lane, stream,
        as_of_date: snapshot?.as_of_date || null, articles: 0, written: 0, skipped_duplicate: 0, results: [],
      });
    }

    let modelCallsAttempted = 0;
    let modelCallsFailed = 0;
    const results = [];

    for (const article of articles) {
      modelCallsAttempted += 1;
      const extraction = await extractRssFactsWithOllama(lane, article, invokeOnPremGeneration);
      if (!extraction) {
        modelCallsFailed += 1;
        results.push({ url: article.url, title: article.title, action: 'model_call_failed' });
        continue;
      }
      if (!extraction.relevant || !extraction.facts.length) {
        results.push({ url: article.url, title: article.title, action: 'not_relevant_or_no_facts' });
        continue;
      }
      for (const fact of extraction.facts) {
        const section = classifySection(fact.claim_text);
        const ttlDays = sectionTtlDays({ origin: 'rss' });
        const [row] = buildRssFactRows({
          lane, section, article, facts: [fact],
          staleAfterIso: staleAfterIso(asOfIso, ttlDays), fetchedAtIso: asOfIso,
        });
        const outcome = await insertRssFact(row, isApply);
        results.push({ url: article.url, title: article.title, section, claim_text: fact.claim_text, ...outcome });
      }
    }

    // If EVERY model call failed, this is a dead Ollama, not a quiet news day
    // — record the run as skipped rather than a hollow "completed, 0 facts".
    if (modelCallsAttempted > 0 && modelCallsFailed === modelCallsAttempted) {
      if (isApply) await closeRun(runId, { status: 'skipped', skip_reason: 'every article-classification call to on-box Ollama failed', error_count: modelCallsFailed });
      return res.status(200).json({
        ok: true, mode: isApply ? 'apply' : 'dry_run', lane, stream, skipped: 'ollama_all_calls_failed',
        articles: articles.length, results,
      });
    }

    const written = results.filter((r) => r.action === 'insert_new').length;
    const skippedDup = results.filter((r) => r.action === 'skip_duplicate').length;

    if (isApply) {
      await closeRun(runId, {
        status: 'completed',
        facts_written: written,
        error_count: modelCallsFailed,
        detail: { articles: articles.length, skipped_duplicate: skippedDup, model_calls_failed: modelCallsFailed, stream },
      });
    }

    return res.status(200).json({
      ok: true, mode: isApply ? 'apply' : 'dry_run', lane, stream,
      as_of_date: snapshot?.as_of_date || null,
      flag: { name: FLAG, enabled, registry_state: flagRow?.state || null },
      articles: articles.length, written, skipped_duplicate: skippedDup,
      model_calls_failed: modelCallsFailed,
      results,
    });
  } catch (err) {
    if (isApply) await closeRun(runId, { status: 'failed', error_count: 1, detail: { error: err?.message || String(err) } });
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}

export const __internal = { classifySection };
