// A1 — the `establish_ownership_history` lane split (2026-08-27).
//
// The lane reads 545 open / 0 completions in 68 days. It is not short of
// answers — 545 of 545 carry a finished, record-cited draft — it is four
// structurally different jobs presented as one "go research this" queue:
//
//   agrees      380  a CONFIRMATION of what we already believe  (A2 applies)
//   mismatch     73  a DATA-INTEGRITY alert                     (A3 routes)
//   no_records   74  unanswerable from what we hold             (A4 retires)
//   all_guarded  18  transfers EXIST, all guard-rejected        (A4b adjudicates)
//
// A3 (2026-08-27) added a FIFTH action, `sponsor_spe`, and re-measured the lane:
// A2 had already drained `agrees` 380 -> 90, so `mismatch` is 74, not 73.
//
//   sponsor_spe   0  the deed records an SPE of a sponsor a human has CONFIRMED
//                    we hold -- a representation difference, not a data error
//
// It is 0 until a human confirms a sponsor family. Read the A3 section below.
//
// ⚠️ THE CLASSIFIER LIVES IN SQL AND ONLY IN SQL.
// `v_lcc_ownership_history_lane_split.action` is the single owner of this
// decision. This module carries the vocabulary and the query shape, never a
// second copy of the CASE — a JS mirror of a SQL classifier is the normaliser
// drift this repo has been bitten by repeatedly (`lcc_normalize_entity_name`,
// `lcc_mailbox_mirror_error_is_terminal`, the P134 re-derived GROUP BY that
// returned 150 members for a 2-member group). The API asks the view; it does
// not decide.
//
// ⚠️ AND NOTHING HERE READS THE `reason` PROSE. The structured booleans
// (`terminates_at_current_owner`) and the enum-valued `insufficient_reason`
// are the inputs. A `reason ilike '%does not match the current owner%'`
// detector agrees with the boolean on all 73 rows today and is still wrong to
// build on: it is a text detector over prose the drafter generates (P182), and
// it is structurally blind to the 74/18 split, which exists nowhere else.

export const OWNERSHIP_LANE_TYPE = 'establish_ownership_history';
export const OWNERSHIP_LANE_SPLIT_VIEW = 'v_lcc_ownership_history_lane_split';
export const OWNERSHIP_LANE_ACTIONS_VIEW = 'v_lcc_ownership_history_lane_actions';

// The five actions. Order is presentation order: human work first.
//
// ⚠️ A3 — `sponsor_spe` IS NOT `agrees`, DELIBERATELY. Folding a confirmed sponsor chain into
// `agrees` would hand it to A2's apply path (cron 244), which WRITES portfolio facts. "These
// names describe one family" and "write this chain into the ownership record" are different
// decisions, and only the first has been graded. A2 is untouched and `agrees` must not move.
// Extending A2 to consume `sponsor_spe` is A3b -- named, sized, not built.
export const OWNERSHIP_LANE_ACTIONS = Object.freeze([
  'mismatch', 'all_guarded', 'sponsor_spe', 'agrees', 'no_records',
]);

// A3: the three-way sub-classification of a `mismatch` chain. Vocabulary only — the SQL
// function `lcc_ownership_mismatch_class` is the single owner of the decision, exactly as
// `action` is owned by the view. Nothing here re-derives a class.
//
// ⚠️ `name_variant` IS NOT AN ACTION AND STAYS HUMAN-ACTIONABLE. It is detected with
// `lcc_owner_strict_core`, which A2 measured and REJECTED for writes on this very population
// (it equates `BAMMF (8) LLC` with `BAMMF (3) LLC`). Labelling a card with it is safe;
// retiring 11 cards on it would be an automated name judgement nobody asked for.
export const OWNERSHIP_MISMATCH_CLASSES = Object.freeze([
  'sponsor_family_candidate', 'name_variant', 'unexplained',
]);

// Buckets that are NOT an action — the row is unclassified and says why.
// `awaiting_draft` is 0 today and is expected to be non-zero between the
// 06:35 seeder and the 06:45 drafter; `unrecognised_payload` means the drafter
// emitted an `insufficient_reason` this split does not know. Neither may be
// folded into `no_records`: "nobody has drafted it yet" and "we looked and
// there is nothing on file" are different facts (P181).
export const OWNERSHIP_LANE_PENDING_STATES = Object.freeze([
  'awaiting_draft', 'unrecognised_payload',
]);

// Only `mismatch` and `all_guarded` are questions a HUMAN must answer. A badge
// that counts `agrees` (a confirmation A2 applies) or `no_records` (unanswerable,
// A4 retires) is the badge-that-is-noise failure. Mirrors the view's
// `human_actionable` column — the view remains the authority; this is used only
// to label a chip.
// `sponsor_spe` is NOT here: a confirmed sponsor family has been answered, so the chain is no
// longer a question for a human. The view's `human_actionable` column remains the authority.
export const OWNERSHIP_LANE_HUMAN_ACTIONS = Object.freeze(['mismatch', 'all_guarded']);

export function isOwnershipLaneAction(v) {
  return OWNERSHIP_LANE_ACTIONS.includes(String(v || ''));
}

export function isOwnershipLaneBucket(v) {
  const s = String(v || '');
  return OWNERSHIP_LANE_ACTIONS.includes(s) || OWNERSHIP_LANE_PENDING_STATES.includes(s);
}

/**
 * PostgREST filter for one bucket of the split view.
 *
 * An unclassified bucket is `action IS NULL` PLUS the split_state — filtering
 * on split_state alone would also match every classified row, since
 * `split_state='classified'` is a different value but a future third pending
 * state would not be. Being explicit costs nothing and cannot drift.
 */
export function ownershipLaneBucketFilter(bucket) {
  const s = String(bucket || '');
  if (OWNERSHIP_LANE_ACTIONS.includes(s)) return `&action=eq.${encodeURIComponent(s)}`;
  if (OWNERSHIP_LANE_PENDING_STATES.includes(s)) {
    return `&action=is.null&split_state=eq.${encodeURIComponent(s)}`;
  }
  return null;
}

/**
 * Page one bucket of the lane and return the task ids in view order.
 *
 * SERVER-SIDE ON PURPOSE. A client-side chip filter over the current page is
 * the P139 badge-that-lies shape: a chip reading 73 that filters the 25 rows
 * on screen down to 4 reports a reach it does not have. Paging the VIEW means
 * the number on the chip is the number the operator can actually get to.
 *
 * Returns { ok, ids, count, status, error }. `count` is the whole bucket
 * (count=exact), never the page.
 */
export async function fetchOwnershipLaneTaskIds(opsQuery, {
  bucket, status = '', limit = 50, offset = 0,
} = {}) {
  const filter = ownershipLaneBucketFilter(bucket);
  if (!filter) return { ok: false, status: 400, error: `Unknown lane_action: ${bucket}`, ids: [], count: 0 };

  let path = `${OWNERSHIP_LANE_SPLIT_VIEW}?select=research_task_id${filter}`;
  // The view already restricts to open tasks; an explicit `completed` filter
  // therefore yields nothing rather than silently returning open rows.
  if (status && status !== 'active' && status !== 'all') {
    path += `&status=eq.${encodeURIComponent(status)}`;
  }
  // Value-ranked, then oldest-first — the same intent as the lane's own
  // `priority.asc,created_at.asc`, so a bucket reads in the order the
  // unfiltered lane would have shown it.
  path += `&order=priority.asc,created_at.asc&limit=${limit}&offset=${offset}`;

  const r = await opsQuery('GET', path, undefined, { countMode: 'exact' });
  if (!r.ok) {
    // Surface the DB's own message. A handler that discards it turns a
    // one-line fix into an outage of unknown duration (the P132 lesson, on
    // this exact endpoint).
    return { ok: false, status: r.status || 500, error: r.data?.message || 'Failed to fetch ownership lane split', ids: [], count: 0 };
  }
  const ids = (Array.isArray(r.data) ? r.data : []).map((x) => x && x.research_task_id).filter(Boolean);
  return { ok: true, ids, count: r.count == null ? ids.length : r.count, status: 200, error: null };
}

/** Restore the view's ordering after hydrating rows by an unordered `id=in.(...)`. */
export function reorderByIds(items, ids) {
  const pos = new Map(ids.map((id, i) => [String(id), i]));
  return (items || []).slice().sort(
    (a, b) => (pos.get(String(a?.id)) ?? 1e9) - (pos.get(String(b?.id)) ?? 1e9)
  );
}
