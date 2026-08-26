// P137 — the provenance_conflict clean-assist lane punted on every card because
// the LADDER never reached the model.
//
// P134 built the consumer: `assessProvenanceConflict` computes
// `ladder_says = laddersSay(c.attempted_priority, c.current_priority)` and reads
// `c.priority_ladder`. But `v_field_provenance_conflict_classified` carried
// NEITHER `current_priority` NOR `priority_ladder` — it only ever joined
// field_source_priority on the ATTEMPTED source — so `c.current_priority` was
// always undefined, `laddersSay` always returned the abstain token, and the
// model correctly refused to name a winner.
//
// Two halves have to stay wired for the lane to work, and each has failed
// independently before:
//   1. the VIEW must expose the columns (migration 20260826231000), and
//   2. the HANDLER must ASK for them in its select=.
// P134's own note is the lesson: "diff the view's columns against the handler's
// select" — the cheapest fix is usually there.
//
// GUARD DESIGN (per the CLAUDE.md block-slice footgun): these tests never slice
// a source region and never pin a line number. Test 1 anchors on the VIEW NAME —
// a stable structural token — and parses the select= list that follows it. Test 2
// exercises the pure consumer directly. So moving the handler code around cannot
// make this stale, and deleting a column from the select goes red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessCleanAssistEvidence, laddersSay } from '../api/_shared/clean-assist-context.js';

const VIEW = 'v_field_provenance_conflict_classified';

// Every context key assessProvenanceConflict reads on the field_provenance arm.
// If the gate starts reading a new column, add it here AND to the select.
const REQUIRED = [
  'attempted_value', 'attempted_source', 'attempted_priority', 'attempted_confidence',
  'current_value', 'current_source', 'current_recorded_at',
  'current_priority', 'priority_ladder',
  'decision', 'decision_reason', 'enforce_mode',
  'target_database', 'target_table', 'record_pk_value', 'field_name',
];

// Pull every `<VIEW>?...select=<list>` occurrence out of api/admin.js. The
// select list is built by concatenating quoted string fragments, so the fragment
// delimiters (`' + '`) are stripped before tokenising.
function selectColumnsForView(src, view) {
  const out = [];
  const re = new RegExp(view + "\\?[^']*select=", 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    // Walk forward from the end of `select=` collecting string content until a
    // PostgREST filter (&) outside the column list ends it.
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 4000);
    // Join the concatenated fragments: drop `' + '`-style glue and newlines.
    const joined = tail.replace(/'\s*\n?\s*\+\s*'/g, '');
    const listEnd = joined.search(/[&']/);
    const list = joined.slice(0, listEnd === -1 ? joined.length : listEnd);
    out.push(list.split(',').map((c) => c.trim()).filter(Boolean));
  }
  return out;
}

describe('P137 provenance_conflict ladder wiring', () => {
  test('the handler selects every column the evidence gate reads', () => {
    const src = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
    const selects = selectColumnsForView(src, VIEW);
    // There must BE a select — if the lane stops reading this view the guard
    // would otherwise vacuously pass.
    assert.ok(selects.length >= 1, `no select= found for ${VIEW} in api/admin.js`);
    for (const cols of selects) {
      for (const need of REQUIRED) {
        assert.ok(cols.includes(need),
          `api/admin.js select= for ${VIEW} is missing "${need}" — the clean-assist `
          + `evidence gate reads it, so without it the lane hands the model a hole. `
          + `Selected: ${cols.join(',')}`);
      }
    }
  });

  test('a resolved current_priority makes the ladder DECISIVE, not an abstain', () => {
    const base = {
      kind: 'field_provenance', target_database: 'dia', target_table: 'dia.leases',
      field_name: 'tenant', record_pk_value: '1',
      attempted_value: 'A', attempted_source: 'folder_feed_lease', attempted_priority: 45,
      current_value: 'B', current_source: 'om_extraction',
      priority_ladder: [{ source: 'om_extraction', priority: 30 }, { source: 'folder_feed_lease', priority: 45 }],
    };
    const wired = assessCleanAssistEvidence({
      decision_type: 'provenance_conflict', context: { ...base, current_priority: 30 },
    });
    assert.equal(wired.sufficient, true);
    assert.equal(wired.evidence.ladder_says, 'current_source_outranks_attempted');
    assert.equal(wired.evidence.current.priority, 30);
    assert.equal(wired.evidence.field_priority_ladder.length, 2);

    // The other direction must be reachable too — a lane that can only ever say
    // keep_current is not reading the ladder, it is echoing a default.
    const other = assessCleanAssistEvidence({
      decision_type: 'provenance_conflict',
      context: { ...base, attempted_priority: 30, current_priority: 45 },
    });
    assert.equal(other.evidence.ladder_says, 'attempted_source_outranks_current');
  });

  test('the pre-P137 shape (current_priority absent) still abstains rather than guessing', () => {
    // This is the live bug reproduced: the key is simply MISSING from context,
    // so the value is `undefined` (not null). It must not fall through to a
    // decisive token, and it must not throw.
    const unwired = assessCleanAssistEvidence({
      decision_type: 'provenance_conflict',
      context: {
        kind: 'field_provenance', target_table: 'dia.leases', field_name: 'tenant',
        attempted_value: 'A', attempted_source: 'folder_feed_lease', attempted_priority: 45,
        current_value: 'B', current_source: 'om_extraction',
      },
    });
    assert.equal(unwired.sufficient, true, 'both values present => the gate still passes');
    assert.equal(unwired.evidence.ladder_says, 'unregistered_source_no_ladder_answer');
    assert.equal(laddersSay(45, undefined), 'unregistered_source_no_ladder_answer');
    // An equal-priority TIE is a genuine non-answer, not a wiring failure — the
    // 21 live ties must keep abstaining after the fix.
    assert.equal(laddersSay(45, 45), 'equal_priority_ladder_cannot_decide');
  });
});
