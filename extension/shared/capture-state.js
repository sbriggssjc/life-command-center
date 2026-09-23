// SIDEBAR4-d (2026-09-23) — the matched-state "in LCC" view.
//
// Why this exists (Scott, 2026-09-23): after a successful Save the side panel
// re-rendered 1.5 s later into the matched state, which showed exactly the same
// "Update LCC with CoStar Data" + "Re-run Pipeline" buttons as a record saved
// months ago and never refreshed. Nothing said "saved just now" or "pipeline ✓",
// so the page looked unsaved and he clicked Update AND Re-run — two more
// pipeline runs for a capture that was already current. Update (PATCH) already
// runs the pipeline server-side, so Re-run after it is always redundant.
//
// This module decides, from data alone, what the matched render should say:
//   * a per-field fingerprint of what Save/Update SEND (extractSourceFields +
//     buildMetadata), stored on the entity as metadata._capture_field_hashes,
//     so a later render can tell whether the live page differs from the
//     stored capture;
//   * the Update button's label/state (up to date → disabled; N changed →
//     enabled with the count; no fingerprint on file → enabled, said so);
//   * whether Re-run is prominent (last run failed / never ran) or secondary;
//   * the status lines ("In LCC — saved 2 min ago", "Pipeline ✓ …").
//   * a short-lived in-memory record of the last Save/Update so the post-save
//     result survives the 1.5 s re-render and any pageContext re-render.
//
// Pure functions only (plus the in-memory memo) so it can be tested in a vm
// without a DOM. Classic script — no ESM exports.
(function installLccCaptureState(root) {
  'use strict';

  // Keys that change on every build of the payload without the page changing.
  // Every "_"-prefixed key is internal bookkeeping and is also excluded.
  const VOLATILE_KEYS = new Set(['extracted_at', 'source_url']);

  function isAbsent(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true;
    return false;
  }

  function stableStringify(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return JSON.stringify(v.trim());
    if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    if (typeof v === 'object') {
      return `{${Object.keys(v).sort()
        .filter((k) => v[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(String(v));
  }

  // FNV-1a 32-bit. Synchronous (crypto.subtle is async) and only has to tell
  // "same value" from "different value" for one field of one record.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function hashInto(out, prefix, obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (k.startsWith('_') || VOLATILE_KEYS.has(k)) continue;
      const v = obj[k];
      if (isAbsent(v)) continue;
      out[`${prefix}${k}`] = fnv1a(stableStringify(v));
    }
  }

  // fields = extractSourceFields(ctx); metadata = buildMetadata(ctx, domain)
  // (the FRESH builder output, not the merge with stored metadata).
  function captureFieldHashes(fields, metadata) {
    const out = {};
    hashInto(out, 'f.', fields);
    hashInto(out, 'm.', metadata);
    return out;
  }

  // A field counts as changed when the live page HAS a value and it differs
  // from (or is missing in) the stored capture. A value the page no longer
  // shows is not counted: a partly-loaded page would otherwise read as
  // "changed", and Update never clears a stored value the page dropped.
  function diffFieldHashes(live, stored) {
    const changed = [];
    for (const k of Object.keys(live || {}).sort()) {
      if (!stored || stored[k] !== live[k]) changed.push(k);
    }
    return changed;
  }

  function displayKey(k) {
    return String(k).replace(/^[fm]\./, '');
  }

  function toMs(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  }

  function formatWhen(iso, nowMs) {
    const t = toMs(iso);
    if (t == null) return null;
    const s = Math.max(0, Math.round((nowMs - t) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return `on ${new Date(t).toISOString().slice(0, 10)}`;
  }

  // ── Post-action memo (survives re-renders of the same side panel) ─────────
  const RECENT_TTL_MS = 10 * 60 * 1000;
  const recent = new Map();

  function rememberAction(entityId, info, nowMs) {
    if (!entityId) return;
    recent.set(String(entityId), {
      kind: info.kind || 'saved',
      at: nowMs == null ? Date.now() : nowMs,
      pipeline: info.pipeline || null, // { status: 'success'|'failed'|'processing', text }
    });
  }

  function recentAction(entityId, nowMs) {
    const r = recent.get(String(entityId));
    if (!r) return null;
    const now = nowMs == null ? Date.now() : nowMs;
    if (now - r.at > RECENT_TTL_MS) { recent.delete(String(entityId)); return null; }
    return r;
  }

  function lastRunFinishedAt(meta) {
    const log = Array.isArray(meta && meta._pipeline_run_log) ? meta._pipeline_run_log : [];
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i] || {};
      if (e.finished_at) return e.finished_at;
    }
    return null;
  }

  // Everything the matched render needs, decided from data.
  //   liveHashes  — captureFieldHashes of the page as rendered now
  //   meta        — the stored entity.metadata
  //   updatedAt   — entity.updated_at (fallback "last saved" time)
  //   sourceLabel — "CoStar", "CREXi", …
  //   recent      — recentAction(entityId) or null
  function computeMatchedView({ liveHashes, meta, updatedAt, sourceLabel, recent: rec, nowMs }) {
    const m = meta || {};
    const now = nowMs == null ? Date.now() : nowMs;
    const stored = m._capture_field_hashes && typeof m._capture_field_hashes === 'object'
      ? m._capture_field_hashes : null;
    const fingerprinted = !!stored;
    // One page field can feed both the entity column (f.) and metadata (m.);
    // count it once, by its display name.
    const changedKeys = fingerprinted
      ? Array.from(new Set(diffFieldHashes(liveHashes || {}, stored).map(displayKey)))
      : [];

    const status = m._pipeline_status || null;
    const processedAt = m._pipeline_processed_at || null;
    const runFinishedAt = lastRunFinishedAt(m);
    const hasRunHistory = !!(processedAt || runFinishedAt || status);
    const recentPending = !!(rec && (!rec.pipeline || rec.pipeline.status === 'processing'));

    // ── Update button ──
    let update;
    if (!fingerprinted) {
      update = {
        label: `Update LCC with ${sourceLabel} Data`,
        disabled: false,
        title: 'No capture fingerprint on file for this record yet — the next update records one, then this button only lights up when the page changes.',
      };
    } else if (changedKeys.length === 0) {
      update = {
        label: 'Up to date in LCC ✓',
        disabled: true,
        title: `Nothing on this ${sourceLabel} page differs from the capture stored in LCC.`,
      };
    } else {
      const n = changedKeys.length;
      const names = changedKeys.slice(0, 12);
      update = {
        label: `Update LCC (${n} field${n === 1 ? '' : 's'} changed)`,
        disabled: false,
        title: `Changed on this page: ${names.join(', ')}${n > names.length ? ', …' : ''}`,
      };
    }
    update.changedKeys = changedKeys;

    // ── Re-run button ──
    // Update already runs the pipeline server-side, so Re-run is only a
    // primary action when the last run failed or no run has ever happened
    // (and none is in flight from an action just taken in this panel).
    let rerunLabel;
    if (status === 'failed') rerunLabel = 'Retry Pipeline (Failed)';
    else if (!hasRunHistory) rerunLabel = 'Run Pipeline';
    else rerunLabel = 'Re-run Pipeline';
    const rerunProminent = status === 'failed' || (!hasRunHistory && !recentPending);

    // ── Status lines ──
    const lines = [];
    if (rec) {
      const when = formatWhen(new Date(rec.at).toISOString(), now);
      const text = rec.kind === 'rerun' ? `Pipeline re-run ${when}`
        : `${rec.kind === 'updated' ? 'Updated in' : 'Saved to'} LCC ${when} ✓`;
      lines.push({ tone: 'ok', text });
    } else {
      const savedAt = m._capture_saved_at || updatedAt || null;
      const when = formatWhen(savedAt, now);
      lines.push({ tone: 'info', text: when ? `In LCC — last saved ${when}` : 'In LCC' });
    }

    if (rec && rec.pipeline && rec.pipeline.text) {
      lines.push({ tone: rec.pipeline.status === 'failed' ? 'bad' : (rec.pipeline.status === 'processing' ? 'warn' : 'ok'), text: rec.pipeline.text });
    } else if (status === 'success') {
      const when = formatWhen(processedAt || runFinishedAt, now);
      lines.push({ tone: 'ok', text: `Pipeline ✓${when ? ` ${when}` : ''}` });
    } else if (status === 'failed') {
      const when = formatWhen(runFinishedAt, now);
      const err = m._pipeline_last_error ? `: ${typeof m._pipeline_last_error === 'string' ? m._pipeline_last_error : JSON.stringify(m._pipeline_last_error)}` : '';
      lines.push({ tone: 'bad', text: `Pipeline failed${when ? ` ${when}` : ''}${err}` });
    } else if (recentPending || (hasRunHistory && !status)) {
      lines.push({ tone: 'warn', text: 'Pipeline running for the latest save…' });
    } else {
      lines.push({ tone: 'warn', text: 'Pipeline has not run for this record' });
    }

    if (fingerprinted) {
      lines.push(changedKeys.length === 0
        ? { tone: 'ok', text: 'Nothing new on this page' }
        : { tone: 'info', text: `${changedKeys.length} field${changedKeys.length === 1 ? '' : 's'} on this page differ from LCC` });
    }

    return {
      fingerprinted,
      changedKeys,
      update,
      rerun: { label: rerunLabel, prominent: rerunProminent },
      statusLines: lines,
    };
  }

  root.LccCaptureState = {
    VOLATILE_KEYS,
    stableStringify,
    fnv1a,
    captureFieldHashes,
    diffFieldHashes,
    formatWhen,
    rememberAction,
    recentAction,
    computeMatchedView,
    RECENT_TTL_MS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
