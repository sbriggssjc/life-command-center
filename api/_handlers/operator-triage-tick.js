// ============================================================================
// OC2 — the operator-note triage tick.
//
// GET/POST /api/operator-triage-tick  (GET = dry-run/report, POST = apply)
// Flag: OPERATOR_NOTE_TRIAGE (off until the §6 live-verify step per the spec).
// Logs to producer_runs (producer='operator_triage') on the P123 lifecycle —
// opened before the work, closed on the way out, so a run that dies
// mid-flight leaves a STALLED row rather than nothing.
//
// For each disposition='open' AND triaged_at IS NULL note: deterministic
// rules first (classifyDeterministic); on a miss, on-box Ollama
// (invokeOnPremGeneration — fails CLOSED, no cloud fallback, matching the
// briefing-analyst-take-tick pattern) for type/lane/severity/title. Then
// dedupe against prior open notes AND the generated PLANNED-BACKLOG index,
// then route via the canon routing table. An unclassifiable note stays
// `open` with metadata.triage_reason naming why — never guessed at.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { opsQuery } from '../_shared/ops-db.js';
import { invokeOnPremGeneration } from '../_shared/ai.js';
import {
  applyTriageVerdict,
  classifyDeterministic,
  fetchOpenUntriagedNotes,
  fetchPriorNotesForDedupe,
  findBestTextMatch,
  loadBacklogIndex,
  loadRoutingTable,
  routeNote,
} from '../_shared/operator-notes.js';

const FLAG = 'OPERATOR_NOTE_TRIAGE';
const PRODUCER = 'operator_triage';

function truthy(v) {
  return v === true || v === '1' || v === 'true' || v === 1;
}

async function openRun(triggerSource) {
  const r = await opsQuery('POST', 'producer_runs', {
    producer: PRODUCER,
    status: 'started',
    trigger_source: triggerSource,
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

/** Ollama-driven classification for a note the deterministic rules missed.
 * Fails closed: any error or an unparsable response returns null, and the
 * note is left `open` with a named reason rather than guessed at.
 * `generate` is injectable so tests can stub Ollama without network access. */
export async function classifyWithOllama(note, generate = invokeOnPremGeneration) {
  const prompt = `Classify this operator note about a CRE deal/data platform ("Life Command Center").
Note text: """${String(note.raw_text || '').slice(0, 2000)}"""
Context: ${JSON.stringify(note.context || {}).slice(0, 1000)}

Respond with ONLY a JSON object, no prose, no markdown fences:
{"note_type": one of ["bug","data-gap","not-connecting","idea","ux","question"], "lane": "short free-text domain label or null", "severity": one of ["low","medium","high"], "title": "one-line title, max 100 chars"}`;

  const gen = await generate({ prompt, temperature: 0.2, json: true }).catch(() => null);
  if (!gen || !gen.ok || !gen.text) return null;
  try {
    const parsed = JSON.parse(gen.text);
    if (!parsed || typeof parsed !== 'object') return null;
    const noteType = ['bug', 'data-gap', 'not-connecting', 'idea', 'ux', 'question'].includes(parsed.note_type)
      ? parsed.note_type : null;
    const severity = ['low', 'medium', 'high'].includes(parsed.severity) ? parsed.severity : 'low';
    if (!noteType) return null;
    return {
      note_type: noteType,
      severity,
      lane: parsed.lane ? String(parsed.lane).slice(0, 200) : null,
      title: parsed.title ? String(parsed.title).slice(0, 100) : null,
      source: 'onprem_ollama',
    };
  } catch (_e) {
    return null;
  }
}

export async function handleOperatorTriageTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET/POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const q = { ...(req.query || {}), ...(req.body || {}) };
  const isApply = req.method === 'POST';
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);

  const flagRow = await fetchFeatureFlag(FLAG);
  const enabled = flagEnabled(FLAG, flagRow);
  const force = truthy(q.force);

  if (!enabled && !force) {
    // Flag-off is a NAMED skip, not a silent zero (CLAUDE.md's producer_runs
    // skip_reason discipline). No run row is opened for a pure flag-off GET
    // dry-run probe, but a POST apply attempted while off DOES log the skip
    // so the run history shows the flag state at the time.
    if (isApply) {
      const runId = await openRun('api');
      await closeRun(runId, { status: 'skipped', skip_reason: `flag ${FLAG} is off` });
    }
    return res.status(200).json({
      ok: true, mode: isApply ? 'apply' : 'dry_run', skipped: 'flag_off',
      flag: { name: FLAG, enabled, registry_state: flagRow?.state || null },
      hint: `Set ${FLAG}=true in Railway (feature_flags_registry) to enable, or call with ?force=1.`,
    });
  }

  const runId = isApply ? await openRun('api') : null;

  const routingTable = loadRoutingTable();
  const backlogIndex = loadBacklogIndex();

  const notes = await fetchOpenUntriagedNotes(limit).catch(() => []);
  const results = [];
  let triaged = 0;
  let routed = 0;
  let unclassified = 0;
  let errors = 0;

  for (const note of notes) {
    try {
      let classification = classifyDeterministic(note.raw_text, note.context);
      let source = 'deterministic';
      if (!classification) {
        const modelResult = isApply || truthy(q.generate)
          ? await classifyWithOllama(note)
          : null;
        if (modelResult) {
          classification = modelResult;
          source = modelResult.source;
        }
      }

      // Dedupe: against prior open notes first, then the backlog index.
      const priorNotes = await fetchPriorNotesForDedupe(note.id, 300).catch(() => []);
      const noteMatch = findBestTextMatch(note.raw_text, priorNotes, { textKey: 'raw_text', idKey: 'id' });
      const backlogMatch = !noteMatch
        ? findBestTextMatch(note.raw_text, backlogIndex, { textKey: 'title', idKey: 'row_id' })
        : null;

      const verdict = {
        note_type: classification?.note_type || null,
        lane: classification?.lane || null,
        severity: classification?.severity || null,
        dedupe_of: noteMatch?.id || null,
        metadata: {
          triage_source: classification ? source : null,
          triage_reason: classification ? undefined : 'no_deterministic_rule_matched_and_model_declined',
          dedupe_score: noteMatch?.score || undefined,
          duplicate_of_backlog_row: backlogMatch?.id || undefined,
          backlog_match_score: backlogMatch?.score || undefined,
          title: classification?.title || undefined,
        },
      };
      // Strip undefined keys so the JSON payload is clean.
      verdict.metadata = Object.fromEntries(Object.entries(verdict.metadata).filter(([, v]) => v !== undefined));

      if (classification) {
        const routeResult = routeNote(
          { rawText: note.raw_text, noteType: classification.note_type, lane: classification.lane },
          routingTable,
        );
        verdict.routed_to = routeResult.routed_to;
        verdict.metadata.route_reason = routeResult.reason;
        triaged += 1;
        if (routeResult.routed_to) routed += 1;
      } else {
        unclassified += 1;
      }

      if (isApply) {
        await applyTriageVerdict(note.id, verdict);
      }
      results.push({ id: note.id, verdict });
    } catch (err) {
      errors += 1;
      results.push({ id: note.id, error: String(err?.message || err) });
    }
  }

  if (isApply) {
    await closeRun(runId, {
      status: 'completed',
      facts_written: routed,
      error_count: errors,
      detail: { triaged, routed, unclassified, scanned: notes.length },
    });
  }

  return res.status(200).json({
    ok: true,
    mode: isApply ? 'apply' : 'dry_run',
    flag: { name: FLAG, enabled, registry_state: flagRow?.state || null },
    scanned: notes.length,
    triaged,
    routed,
    unclassified,
    errors,
    results,
  });
}

export default handleOperatorTriageTick;
