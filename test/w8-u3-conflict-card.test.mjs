// Prompt 77 (W8 U3 polish) — pin the ambiguous_entity_match conflict-resolution
// card. Before this, the canonical-resolve guard routed a ≥2-entity ambiguity to
// status='conflict', but v_w8_u3_link_review_open excluded conflict rows → the
// conflict was invisible with no way to resolve (a dead-end producer). Now:
//   * the feed surfaces conflict rows with the candidate entities + Mint new,
//   * a pick/mint verdict resumes the deterministic writer end-to-end,
//   * the badge counts conflict rows,
//   * clicking twice is idempotent.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminSrc = readFileSync(join(root, 'api/admin.js'), 'utf8');
// W6.5 Stage 1 (P87): federated lane code moved to dc-lanes.js (classic script
// loaded before ops.js, same global scope) - read both halves as one surface.
const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8')
  + String.fromCharCode(10) + readFileSync(join(root, 'dc-lanes.js'), 'utf8');

// Isolate the w8_u3_link_review federated-source (feed) block.
function u3FeedBlock() {
  const start = adminSrc.indexOf("if (type === 'w8_u3_link_review') {");
  assert.ok(start > -1, 'could not find the w8_u3 feed block');
  const end = adminSrc.indexOf("if (type === 'listing_event_action') {", start);
  assert.ok(end > start, 'could not bound the w8_u3 feed block');
  return adminSrc.slice(start, end);
}

// Isolate the w8_u3_link_review verdict handler.
function u3VerdictBlock() {
  const start = adminSrc.indexOf("if (decision.decision_type === 'w8_u3_link_review') {");
  assert.ok(start > -1, 'could not find the w8_u3 verdict handler');
  const end = adminSrc.indexOf('// ---- owner_reconcile', start);
  assert.ok(end > start, 'could not bound the w8_u3 verdict handler');
  return adminSrc.slice(start, end);
}

describe('W8 U3 conflict card — feed surfaces conflict rows with candidates', () => {
  const feed = u3FeedBlock();

  it('fetches status=conflict chain-pool rows (not just the open view)', () => {
    assert.match(feed, /w8_u3_link_review\?status=eq\.conflict&pool=eq\.chain/,
      'feed must pull the conflict rows the open view excludes');
  });

  it('resolves the candidate entities by canonical_name with link + portfolio counts', () => {
    assert.match(feed, /normalizeCanonicalName\(row\.linked_entity_name/,
      'candidates are resolved from the proposed name via the house normalizer');
    assert.match(feed, /entities\?select=id,name,domain,entity_type,canonical_name&canonical_name=eq\./);
    assert.match(feed, /relationship_count:/, 'each candidate carries a relationship count');
    assert.match(feed, /portfolio_count:/, 'each candidate carries a portfolio count');
  });

  it('only surfaces still-reproducing ≥2-candidate conflicts with a current owner', () => {
    assert.match(feed, /if \(!row\.current_owner_entity_id\) continue/,
      'no_current_owner_entity conflicts are not pick-resolvable');
    assert.match(feed, /if \(ents\.length < 2\) continue/,
      'a conflict that no longer reproduces (entities merged) is skipped');
  });

  it('tags surfaced rows conflict:true with an ambiguous_entity_match reason + candidates', () => {
    assert.match(feed, /conflict:\s*true/);
    assert.match(feed, /conflict_reason:\s*'ambiguous_entity_match'/);
    assert.match(feed, /candidates\b/);
  });

  it('total counts open proposals PLUS conflict rows (honest badge)', () => {
    assert.match(feed, /status=eq\.conflict'\)/, 'total must add the conflict count');
    assert.match(feed, /out\.total = \(u3OpenCnt \|\| 0\) \+ \(u3ConfCnt \|\| 0\)/);
  });
});

describe('W8 U3 conflict card — verdict resumes the writer on pick / mint', () => {
  const v = u3VerdictBlock();

  it('reads a resolve_conflict payload flag', () => {
    assert.match(v, /isConflictResolve\s*=\s*!!\(payload && payload\.resolve_conflict === true\)/);
  });

  it('bypasses the ambiguity guard and validates a picked entity id', () => {
    assert.match(v, /if \(isConflictResolve\)/, 'the resolve branch skips the canonical resolve/ambiguity guard');
    assert.match(v, /payload\.chosen_entity_id/);
    assert.match(v, /chosen entity not found or merged/,
      'a picked id must exist and be unmerged');
    assert.match(v, /chosen entity does not match the proposed name/,
      'a picked id must actually share the proposed canonical_name (never trust an arbitrary id)');
  });

  it('Mint new leaves linkedEntityId null so the shared mint block fires', () => {
    assert.match(v, /payload\.mint_new !== true/,
      'only a non-mint pick sets linkedEntityId; mint_new falls through to the mint INSERT');
    // The shared mint block still writes canonical_name (per Prompt 76).
    assert.match(v, /canonical_name:\s*mintCanonical/);
  });

  it('is idempotent — a second click on an applied/rejected review is a no-op', () => {
    assert.match(v, /review\.status !== 'conflict' && review\.status !== 'proposed'/);
    assert.match(v, /action:\s*'already_resolved'/);
  });

  it('records the resolution as a decided decision with a conflict-resolved effect', () => {
    assert.match(v, /resolved_conflict\s*=\s*'ambiguous_entity_match'/);
  });
});

describe('W8 U3 conflict card — idempotency guard bypass at mint time', () => {
  it('the decision-verdict idempotency guard exempts a w8_u3 conflict resolution', () => {
    assert.match(adminSrc, /isU3ConflictResolve\s*=\s*\(dtype === 'w8_u3_link_review'/);
    assert.match(adminSrc, /if \(!isU3ConflictResolve && prior\.ok/,
      'the already_decided 409 must not fire for a conflict resolution');
  });
});

describe('W8 U3 conflict card — frontend render + verdict wiring', () => {
  it('renders a dedicated conflict card branch (pick survivor / mint new / reject)', () => {
    assert.match(opsSrc, /_dcFedType === 'w8_u3_link_review' && c\.conflict/,
      'a c.conflict card branch must exist');
    assert.match(opsSrc, /conflict — ambiguous match/);
    assert.match(opsSrc, /dcFedU3Pick\(/, 'candidate + mint buttons call dcFedU3Pick');
    assert.match(opsSrc, /Mint new entity/);
  });

  it('dcFedU3Pick rides dcFed with resolve_conflict set', () => {
    assert.match(opsSrc, /async function dcFedU3Pick\(i, entityId, mintNew\)/);
    assert.match(opsSrc, /resolve_conflict:\s*true/);
    assert.match(opsSrc, /payload\.mint_new\s*=\s*true/);
    assert.match(opsSrc, /payload\.chosen_entity_id\s*=\s*entityId/);
    assert.match(opsSrc, /window\.dcFedU3Pick\s*=\s*dcFedU3Pick/);
  });
});

describe('W8 U3 conflict card — review-counts badge folds in conflicts', () => {
  it('the w8_u3_link_review lane sums open proposals + conflict rows', () => {
    assert.match(adminSrc, /withLaneTimeout\(opsCount\('w8_u3_link_review\?status=eq\.conflict'\)\)/);
    assert.match(adminSrc, /count:\s*sum\(u3Open, u3Conflict\)/,
      'the lane count must include the conflict count');
  });
});
