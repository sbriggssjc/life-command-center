// api/_handlers/briefing-analyst-take-tick.js
// ============================================================================
// P138 / R8 Stage 1 — fill the daily brief's "Analyst's Take" ON-BOX.
//
//   GET  → dry run. Assembles the private signal set, renders the exact block the
//          model would read, and reports today's snapshot state. NO model call,
//          NO writes. `?generate=1` additionally calls the local model and returns
//          the take inline for human grading — still WITHOUT writing.
//   POST → generate + write (flag-gated BRIEFING_ANALYST_TAKE_ONPREM).
//
// THE STATE THIS FIXES (measured live on LCC Opps, 2026-08-26):
//   briefing_intel_snapshot holds 67 rows; 11 ever carried an analyst_take, and
//   the last non-empty one is 2026-07-07. Every row since carries the warning
//   "Anthropic API 400: ... Your credit balance is too low to access the Anthropic
//   API". So the section has rendered nothing for seven weeks and the cause is
//   BILLING, not the missing-key path the originating prompt described. The same
//   outage also emptied `capital_markets` — reported, out of scope here.
//
// WHY THE LOCAL MODEL. The payload is private: work counts, scored priorities,
// named cooling contacts, deal-propagation deltas naming live deals. Doctrine says
// a private corpus never egresses to a cloud model, so generation goes through
// invokeOnPremGeneration — the fail-CLOSED GaryBuilt seam with no cloud fallback.
// The macro lines folded in are PUBLIC market data read back out of our own
// snapshot row; that is not an egress event and is labelled as such in the block.
//
// WHY IT NEVER FIGHTS THE EDGE FUNCTION FOR THE COLUMN. The write is a PATCH of
// exactly two columns on the existing row (analyst_take + analyst_take_meta),
// scoped to (as_of_date, workspace_id is null). It cannot touch market_data,
// sector_news, capital_markets or warnings, and it cannot mint a duplicate row.
// Only when today's row does not exist yet does it fall back to a merge-duplicates
// upsert carrying ONLY those keys — PostgREST derives the UPDATE column list from
// the payload keys, so the columns it omits are preserved, not nulled. The edge
// function was changed in the same commit to OMIT analyst_take from its own upsert
// when it has no take to write, so a manual re-fire can no longer null ours.
//
// FAIL-SOFT, ALWAYS. Flag off, model unreachable, thin data, a rejected take — all
// leave analyst_take exactly as it was and return 200 with a NAMED reason. The
// brief never blocks. But an empty take that reads like "quiet news day" is the
// silent-failure class this codebase keeps re-learning, so every non-write opens a
// deduped lcc_health_alerts row, and a successful write RESOLVES it.
//
// NEVER FABRICATES. The take is validated back against the signal block; an
// ungrounded number or date REJECTS the whole take (one retry if budget allows,
// naming the fabricated tokens), it is never patched up and shipped.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { invokeOnPremGeneration } from '../_shared/ai.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchWorkCounts, fetchMyWork, fetchInboxSummary, fetchRecentSfActivity,
  fetchHotContacts, fetchDiaPipeline, fetchPipelineRollup, fetchDealPropagationDelta,
  fetchIntelSnapshot, fetchLccHealthSnapshot, scoreItem, deriveItemTitle,
} from '../_shared/briefing-data.js';
import * as BAT from '../_shared/briefing-analyst-take.js';

const FLAG = 'BRIEFING_ANALYST_TAKE_ONPREM';
const ALERT_KIND = 'briefing_analyst_take_empty';
const ALERT_SOURCE = 'briefing_analyst_take_tick';
// Leave room for a validation retry inside the pg_net 60 s listen window. P123:
// exceeding it does not kill the work (the handler runs to completion and writes),
// but a run that routinely overruns is reported as no_response and reads as broken.
const BUDGET_MS = 50_000;
const RETRY_MIN_REMAINING_MS = 20_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE_PROFILE_PATH = path.resolve(__dirname, '..', '..', 'BRIGGS-WRITING-VOICE.md');

let _voiceCache = null;
function loadVoiceForBrief() {
  if (_voiceCache) return _voiceCache;
  let md = '';
  try { md = readFileSync(VOICE_PROFILE_PATH, 'utf8'); } catch { md = ''; }
  _voiceCache = BAT.extractVoiceForBrief(md);
  return _voiceCache;
}

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

/** CT calendar date — the snapshot row keys on America/Chicago, not UTC. */
function ctToday() {
  const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return {
    date: ct.toISOString().slice(0, 10),
    weekday: ct.toLocaleDateString('en-US', { weekday: 'long' }),
  };
}

// ---------------------------------------------------------------------------
// Health event — a non-write must be VISIBLE
// ---------------------------------------------------------------------------

async function openEmptyTakeAlert(reason, details) {
  try {
    const open = await opsQuery('GET',
      `lcc_health_alerts?alert_kind=eq.${ALERT_KIND}&source=eq.${ALERT_SOURCE}`
      + '&resolved_at=is.null&select=alert_id&limit=1', undefined, { countMode: 'none' });
    if (open.ok && open.data?.[0]?.alert_id) return 'already_open';
    const r = await opsQuery('POST', 'lcc_health_alerts', {
      alert_kind: ALERT_KIND,
      source: ALERT_SOURCE,
      severity: 'warning',
      summary: `Daily brief Analyst's Take not written (${reason}) — the section will render empty`,
      details: { reason, ...details },
    });
    return r.ok ? 'opened' : 'open_failed';
  } catch (_e) { return 'open_failed'; }
}

async function resolveEmptyTakeAlert(note) {
  try {
    const r = await opsQuery('PATCH',
      `lcc_health_alerts?alert_kind=eq.${ALERT_KIND}&source=eq.${ALERT_SOURCE}&resolved_at=is.null`,
      { resolved_at: new Date().toISOString(), resolved_note: String(note || '').slice(0, 400) });
    return r.ok ? 'resolved' : 'resolve_failed';
  } catch (_e) { return 'resolve_failed'; }
}

// ---------------------------------------------------------------------------
// Signal assembly
// ---------------------------------------------------------------------------

async function assembleSignals(workspaceId, userId) {
  const { date, weekday } = ctToday();
  const errors = [];
  const safe = (fn, fallback, label) => fn().catch((err) => {
    errors.push(`${label}:${err?.message || String(err)}`.slice(0, 160));
    return fallback;
  });

  const [
    workCounts, myWork, inboxSummary, sfActivity, hotContacts,
    diaPipeline, pipelineRollup, dealDelta, snapshot, lccHealth,
  ] = await Promise.all([
    safe(() => fetchWorkCounts(workspaceId, userId), {}, 'work_counts'),
    safe(() => fetchMyWork(workspaceId, userId, 15), [], 'my_work'),
    safe(() => fetchInboxSummary(workspaceId, 10), { items: [] }, 'inbox'),
    safe(() => fetchRecentSfActivity(workspaceId, 30), [], 'sf_activity'),
    safe(() => fetchHotContacts(15), [], 'hot_contacts'),
    safe(fetchDiaPipeline, { deals: [], leads: [] }, 'dia_pipeline'),
    safe(fetchPipelineRollup, { open_count: 0, by_stage: [] }, 'pipeline_rollup'),
    safe(() => fetchDealPropagationDelta(24), { window_hours: 24, count: 0, items: [] }, 'deal_delta'),
    safe(() => fetchIntelSnapshot(workspaceId), null, 'intel_snapshot'),
    safe(fetchLccHealthSnapshot, null, 'lcc_health'),
  ]);

  // Rank with the SHARED scorer (scoreItem is the authority the email uses); the
  // selection rule lives in the pure planner. See rankTodayPriorities' header for
  // why buildStrategicPriorities itself is deliberately not called from a cron.
  const hotContactMap = new Map();
  for (const c of (hotContacts || [])) if (c.email) hotContactMap.set(String(c.email).toLowerCase(), c);

  const pool = [];
  for (const item of (inboxSummary.items || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    pool.push({ ...item, _score: score, _tier: tier, _source: 'inbox' });
  }
  for (const item of (myWork || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    pool.push({ ...item, _score: score, _tier: tier, _source: 'work' });
  }
  for (const item of (sfActivity || [])) {
    const { score, tier } = scoreItem(item, hotContactMap);
    if (score >= 30) pool.push({ ...item, _score: score, _tier: tier, _source: 'salesforce', type: 'sf_activity' });
  }
  for (const deal of (diaPipeline?.deals || [])) {
    const pseudo = {
      title: deal.subject || deal.what_name || '(deal)',
      body: deal.description || '',
      due_date: deal.due_date || deal.activity_date,
      priority: deal.priority === 'High' ? 'high' : 'normal',
      metadata: { sf_who: deal.who_name, sf_what: deal.what_name },
    };
    const { score, tier } = scoreItem(pseudo, hotContactMap);
    if (score >= 20) {
      pool.push({
        ...pseudo, id: deal.id, status: deal.status || 'open', domain: 'dialysis',
        type: 'sf_deal', _score: score + 20,
        _tier: tier === 'urgent' ? 'important' : tier, _source: 'pipeline',
      });
    }
  }

  const ranked = BAT.rankTodayPriorities(pool)
    .map((i) => ({ ...i, title: deriveItemTitle(i) }))
    .filter((i) => i.title);

  const signals = BAT.buildAnalystSignals({
    asOfDate: date, weekday, workCounts, rankedPriorities: ranked,
    pipelineRollup, dealDelta, hotContacts, snapshot, lccHealth, nowMs: Date.now(),
  });

  return { signals, snapshot, date, weekday, errors };
}

// ---------------------------------------------------------------------------
// Generation — on-box only, with ONE validation retry when budget allows
// ---------------------------------------------------------------------------

async function generateTake({ voice, signalBlock, density, startedMs }) {
  const attempts = [];
  let retryFlags = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = BAT.buildAnalystTakePrompt({ voice, signalBlock, density, retryFlags });
    const gen = await invokeOnPremGeneration({ prompt, temperature: 0.35, json: false });
    if (!gen.ok) {
      attempts.push({ attempt, ok: false, error: gen.error || `ollama status ${gen.status}` });
      return { ok: false, reason: 'model_unavailable', attempts, model: gen.model || null, prompt_chars: prompt.length };
    }
    const take = BAT.normalizeAnalystTake(gen.text);
    const validation = BAT.validateAnalystTake(take, { signalBlock });
    attempts.push({
      attempt, ok: validation.ok, chars: take.length,
      ungrounded_numbers: validation.ungrounded_numbers,
      ungrounded_names: validation.ungrounded_names,
    });
    if (validation.ok) {
      return { ok: true, take, validation, attempts, model: gen.model || null, prompt_chars: prompt.length };
    }
    if (!take) {
      return { ok: false, reason: 'empty_generation', attempts, model: gen.model || null, prompt_chars: prompt.length };
    }
    retryFlags = validation.ungrounded_numbers;
    const remaining = BUDGET_MS - (Date.now() - startedMs);
    if (attempt === 2 || remaining < RETRY_MIN_REMAINING_MS) {
      return {
        ok: false, reason: 'fabrication_rejected', attempts,
        rejected_take: take, validation, model: gen.model || null, prompt_chars: prompt.length,
        budget_stopped: remaining < RETRY_MIN_REMAINING_MS,
      };
    }
  }
  return { ok: false, reason: 'fabrication_rejected', attempts };
}

// ---------------------------------------------------------------------------
// Write — PATCH the two columns we own; upsert ONLY if the row is missing
// ---------------------------------------------------------------------------

async function writeTake(asOfDate, take, meta) {
  const enc = encodeURIComponent(asOfDate);
  const body = { analyst_take: take, analyst_take_meta: meta };

  const patch = await opsQuery('PATCH',
    `briefing_intel_snapshot?as_of_date=eq.${enc}&workspace_id=is.null`,
    body, { headers: { Prefer: 'return=representation' } });
  if (!patch.ok) {
    return { ok: false, mode: 'patch', error: patch.data?.message || patch.data?.error || `status ${patch.status}` };
  }
  if (Array.isArray(patch.data) && patch.data.length > 0) {
    return { ok: true, mode: 'patch', rows: patch.data.length };
  }

  // No row for today yet (a manual run ahead of the 10:00 edge cron). Insert one
  // carrying ONLY our two columns plus the key; every column we omit keeps its
  // default now and is filled by the edge function's own merge-duplicates upsert
  // when it lands. We never write market_data / news / capital_markets.
  const ins = await opsQuery('POST',
    'briefing_intel_snapshot?on_conflict=as_of_date,workspace_id',
    { as_of_date: asOfDate, workspace_id: null, ...body },
    { headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
  if (!ins.ok) {
    return { ok: false, mode: 'upsert', error: ins.data?.message || ins.data?.error || `status ${ins.status}` };
  }
  return { ok: true, mode: 'upsert', rows: Array.isArray(ins.data) ? ins.data.length : 1 };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleBriefingAnalystTakeTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET/POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const startedMs = Date.now();
  const q = { ...(req.query || {}), ...(req.body || {}) };
  const isApply = req.method === 'POST' && !truthy(q.dry_run);
  const wantGenerate = isApply || truthy(q.generate);
  const force = truthy(q.force);

  const workspaceId = req.headers['x-lcc-workspace'] || process.env.LCC_DEFAULT_WORKSPACE_ID || '';
  const userId = req.headers['x-lcc-user-id'] || process.env.LCC_SYSTEM_USER_ID || '';
  if (!workspaceId) {
    return res.status(400).json({
      ok: false, error: 'Could not resolve workspace. Set X-LCC-Workspace or LCC_DEFAULT_WORKSPACE_ID.',
    });
  }

  const flagRow = await fetchFeatureFlag(FLAG);
  const enabled = flagEnabled(FLAG, flagRow);

  const { signals, snapshot, date, weekday, errors } = await assembleSignals(workspaceId, userId);
  const signalBlock = BAT.renderSignalBlock(signals);
  const density = BAT.assessSignalDensity(signals);
  const voice = loadVoiceForBrief();

  const snapshotToday = snapshot && snapshot.as_of_date === date ? snapshot : null;
  const existingTakeChars = String(snapshotToday?.analyst_take || '').trim().length;

  const base = {
    ok: true,
    mode: isApply ? 'apply' : 'dry_run',
    as_of_date: date,
    weekday,
    flag: { name: FLAG, enabled, registry_state: flagRow?.state || null },
    snapshot: {
      exists_for_today: !!snapshotToday,
      row_as_of_date: snapshot?.as_of_date || null,
      variant: snapshot?.variant || null,
      existing_analyst_take_chars: existingTakeChars,
      // Surfaced because the same Anthropic billing failure that emptied
      // analyst_take also emptied this, and fixing one does not fix the other.
      existing_capital_markets_chars: String(snapshotToday?.capital_markets || '').trim().length,
      edge_warnings: Array.isArray(snapshot?.warnings) ? snapshot.warnings.slice(0, 3) : [],
    },
    signals,
    signal_block: signalBlock,
    signal_block_chars: signalBlock.length,
    density,
    voice_profile: { basis: voice.basis, chars: voice.text.length, sections: voice.sections_found },
    fetch_errors: errors,
    elapsed_ms: Date.now() - startedMs,
  };

  // ---- dry run without generation -----------------------------------------
  if (!wantGenerate) {
    return res.status(200).json({
      ...base,
      would_generate: enabled || !isApply,
      note: 'Dry run — no model call, no write. Add ?generate=1 to render a take inline for grading.',
      elapsed_ms: Date.now() - startedMs,
    });
  }

  // ---- flag gate (apply only; ?generate=1 on GET stays available for grading)
  //
  // Deliberately opens NO health alert. A flag that is off is a state someone
  // CHOSE, and feature_flags_registry + the brief's own "Dormant Capabilities"
  // section already surface it — an alert here would be a permanently-open row
  // describing a decision, which is the badge-that-is-mostly-noise failure the
  // Consumption-Layer doctrine warns about. Alerts are for the states nobody
  // chose: an unreachable model, a fabricated take, a failed write.
  if (isApply && !enabled) {
    return res.status(200).json({
      ...base, written: false, skipped: 'flag_off', health_alert: 'not_opened_flag_off_is_a_chosen_state',
      hint: `Set ${FLAG} in Railway, or flip feature_flags_registry.${FLAG} to 'on'.`,
      elapsed_ms: Date.now() - startedMs,
    });
  }

  // ---- idempotency ---------------------------------------------------------
  if (isApply && existingTakeChars > 0 && !force) {
    await resolveEmptyTakeAlert(`take already present (${existingTakeChars} chars) for ${date}`);
    return res.status(200).json({
      ...base, written: false, skipped: 'already_written',
      hint: 'Pass force=1 to regenerate today’s take.',
      elapsed_ms: Date.now() - startedMs,
    });
  }

  // ---- generate ------------------------------------------------------------
  const gen = await generateTake({ voice: voice.text, signalBlock, density, startedMs });

  if (!gen.ok) {
    const alert = isApply
      ? await openEmptyTakeAlert(gen.reason, {
        as_of_date: date,
        attempts: gen.attempts,
        ungrounded_numbers: gen.validation?.ungrounded_numbers || [],
        density: density.level,
      })
      : 'dry_run';
    return res.status(200).json({
      ...base,
      written: false,
      generation: {
        ok: false, reason: gen.reason, attempts: gen.attempts,
        model: gen.model || null, prompt_chars: gen.prompt_chars || null,
        budget_stopped: !!gen.budget_stopped,
        // The rejected prose is returned so a human can see WHAT was fabricated
        // rather than only being told that something was. It is never stored.
        rejected_take: gen.rejected_take || null,
        ungrounded_numbers: gen.validation?.ungrounded_numbers || [],
      },
      health_alert: alert,
      elapsed_ms: Date.now() - startedMs,
    });
  }

  // ---- dry-run generation: return, never write -----------------------------
  if (!isApply) {
    return res.status(200).json({
      ...base,
      written: false,
      generation: {
        ok: true, model: gen.model, attempts: gen.attempts, prompt_chars: gen.prompt_chars,
        ungrounded_names_reported: gen.validation.ungrounded_names,
      },
      analyst_take: gen.take,
      analyst_take_chars: gen.take.length,
      note: 'Dry run — generated for grading, NOT written. POST to write.',
      elapsed_ms: Date.now() - startedMs,
    });
  }

  // ---- write ---------------------------------------------------------------
  const meta = {
    source: 'onprem_ollama',
    surface: 'briefing_analyst_take_tick',
    model: gen.model || null,
    generated_at: new Date().toISOString(),
    density: density.level,
    density_present: density.present,
    prompt_chars: gen.prompt_chars,
    signal_block_chars: signalBlock.length,
    voice_basis: voice.basis,
    attempts: gen.attempts.length,
    // Reported, never fatal — the name regex over-fires on ordinary capitalised
    // prose, so a flagged name is a thing for a human to eyeball, not a rejection.
    ungrounded_names_reported: gen.validation.ungrounded_names,
    signal_counts: {
      priorities: signals.priorities.items.length,
      book_changes: signals.book_changes.deal_count,
      contacts_cooling: signals.contacts_cooling.items.length,
      macro_rows: signals.macro.rows.length,
      open_actions: signals.work.open_actions,
    },
    fetch_errors: errors,
    elapsed_ms: Date.now() - startedMs,
  };

  const write = await writeTake(date, gen.take, meta);
  if (!write.ok) {
    const alert = await openEmptyTakeAlert('write_failed', { as_of_date: date, error: write.error, mode: write.mode });
    return res.status(200).json({
      ...base, written: false, generation: { ok: true, model: gen.model },
      write, health_alert: alert, elapsed_ms: Date.now() - startedMs,
    });
  }

  const resolved = await resolveEmptyTakeAlert(`take written for ${date} (${gen.take.length} chars, on-prem ${gen.model || 'ollama'})`);

  return res.status(200).json({
    ...base,
    written: true,
    write,
    generation: {
      ok: true, model: gen.model, attempts: gen.attempts, prompt_chars: gen.prompt_chars,
      ungrounded_names_reported: gen.validation.ungrounded_names,
    },
    // Assert on THIS, not on "the tick ran" — an empty take is the failure mode.
    analyst_take_chars: gen.take.length,
    analyst_take: gen.take,
    health_alert: resolved,
    elapsed_ms: Date.now() - startedMs,
  });
}
