// ============================================================================
// To Do auto-completion gate — "Closing the Loop" (Flow 1, Option A)
// Life Command Center · mailbox-mechanics layer
//
// Filing an email and completing the underlying task are TWO different things.
// Auto-complete the Microsoft To Do task ONLY where filing genuinely IS the
// whole job; leave it OPEN where intake is step one and a human deliverable
// follows (a BOV, a reply, a lead follow-up, anything routed to needs_review).
//
// Confirmed by Scott 2026-07-20:
//   AUTO-COMPLETE (filing is terminal): news · reference · fyi · duplicate
//   LEAVE OPEN    (human deliverable):  deals · leads · general · infra
//   NEVER         (hard rule):          needs_review
//
// The category vocabulary is prompt 2's conceptual set — not a live enum yet.
// This is the SINGLE tunable knob: adjust AUTO_COMPLETE_CATEGORIES to change
// the policy. Everything is an ALLOW-LIST, so an unknown/new category defaults
// to LEAVE OPEN — a future prompt-2 category can never silently auto-complete
// work that wasn't done.
// ============================================================================

// The single tunable knob (Scott-confirmed). A category in this list is
// terminal-on-file. `duplicate` is ALSO matched via the outcome branch below
// (a dedup disposition is terminal on its own, category or not).
export const AUTO_COMPLETE_CATEGORIES = ['news', 'reference', 'fyi', 'duplicate'];

// Hard guard — needs_review is NEVER terminal, even if it somehow appears in the
// allow-list. This is belt-and-suspenders on Scott's explicit "never."
export const NEVER_AUTO_COMPLETE_CATEGORIES = ['needs_review'];

/**
 * Normalize the disposition/outcome word. `filed` (Scott's word) and
 * `auto_filed` (the build-sheet disposition) both mean "filed to Processed/*".
 * @returns {string} 'filed' | 'duplicate' | 'flagged' | '' | <as-is lowercased>
 */
export function normalizeOutcome(outcome) {
  const o = String(outcome || '').toLowerCase().trim();
  if (o === 'filed' || o === 'auto_filed') return 'filed';
  return o;
}

/** Normalize a category/domain tag (empty string when absent). */
export function normalizeCategory(category) {
  return String(category || '').toLowerCase().trim();
}

/**
 * Decide whether a filed email's To Do task should be auto-completed.
 *
 * Gate (allow-list; unknown → leave open):
 *   - needs_review           → NEVER (hard guard)
 *   - outcome 'flagged'      → leave open (flagged = human attention)
 *   - outcome 'duplicate'    → auto-complete (a dedup has nothing to work)
 *   - outcome 'filed' AND category ∈ AUTO_COMPLETE_CATEGORIES → auto-complete
 *   - everything else        → leave open
 *
 * @param {string} outcome  disposition/outcome (filed/auto_filed/duplicate/flagged/…)
 * @param {string} category prompt-2 category (news/reference/fyi/deals/leads/…)
 * @returns {boolean} true ⇒ auto-complete the To Do; false ⇒ leave it open
 */
export function shouldAutoCompleteTodo(outcome, category) {
  const o = normalizeOutcome(outcome);
  const cat = normalizeCategory(category);

  // Hard guard first — needs_review is never terminal.
  if (NEVER_AUTO_COMPLETE_CATEGORIES.includes(cat)) return false;

  // A 'flagged' disposition means the email is flagged for human attention —
  // filing it is not the whole job, so leave the To Do open.
  if (o === 'flagged') return false;

  // A duplicate disposition is terminal on its own — nothing to work.
  if (o === 'duplicate') return true;

  // Otherwise: only complete on a REAL file, and only for a terminal category.
  if (o !== 'filed') return false;
  if (!cat) return false; // unknown category ⇒ leave open (allow-list)
  return AUTO_COMPLETE_CATEGORIES.includes(cat);
}
