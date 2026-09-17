// HOME2 (2026-09-17) — three-lane Home page (Research / BD / Inbox), pure
// re-composition behind the `home_three_lanes` flag (default OFF). Spec:
// docs/audits/HOME1_HOME_PAGE_AUDIT_2026-09-16.md §B.
//
// app.js is a huge classic-script file that runs in a browser global scope
// (window/document/opsApi/etc all assumed present) — it cannot be `import`ed
// or safely `eval`'d whole in Node. This suite follows the repo's own
// established pattern (see test/pri1-priority-queue-band-labels.test.mjs):
// static source assertions for wiring/gating, and isolated eval of small
// PURE functions (no DOM, no fetch) for behavioural checks.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appPath = join(process.cwd(), 'app.js');
const adminPath = join(process.cwd(), 'api/admin.js');
const indexPath = join(process.cwd(), 'index.html');
const appSrc = readFileSync(appPath, 'utf8');
const adminSrc = readFileSync(adminPath, 'utf8');

function stripComments(s) {
  return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
const cleanApp = stripComments(appSrc);

function extractFnBody(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0;
  let i = src.indexOf('{', start);
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(bodyStart, i + 1);
}

describe('HOME2 — feature flag default OFF, registered on both sides', () => {
  it('app.js LCC_FLAGS declares home_three_lanes: false', () => {
    const m = appSrc.match(/const LCC_FLAGS = \{[\s\S]*?\n\};/);
    assert.ok(m, 'LCC_FLAGS block not found');
    assert.match(m[0], /home_three_lanes:\s*false/);
  });

  it('api/admin.js DEFAULT_FLAGS declares home_three_lanes: false', () => {
    const m = adminSrc.match(/const DEFAULT_FLAGS = \{[\s\S]*?\n\};/);
    assert.ok(m, 'DEFAULT_FLAGS block not found');
    assert.match(m[0], /home_three_lanes:\s*false/);
  });

  it('loadFeatureFlags only applies keys already present in LCC_FLAGS, so the server default resolves it', () => {
    // Guards that a rename on one side (client default vs server default)
    // cannot go unnoticed: /api/flags only overrides keys `in LCC_FLAGS`.
    assert.match(cleanApp, /if \(key in LCC_FLAGS\) LCC_FLAGS\[key\] = val;/);
  });
});

describe('HOME2 — renderHomeThreeLanes no-ops entirely with the flag off', () => {
  const body = extractFnBody(cleanApp, 'renderHomeThreeLanes');

  it('the first statement is the flag gate, before any DOM write or fetch', () => {
    // Strip whitespace/braces to find the first real statement.
    const firstStmt = body.replace(/^\{\s*/, '').split(';')[0].trim();
    assert.equal(firstStmt, "if (!checkFlag('home_three_lanes')) return");
  });

  it('nothing before the gate touches document or opsApi/fetch', () => {
    const gateIdx = body.indexOf("checkFlag('home_three_lanes')");
    const before = body.slice(0, gateIdx);
    assert.doesNotMatch(before, /document\./);
    assert.doesNotMatch(before, /opsApi\(/);
    assert.doesNotMatch(before, /fetch\(/);
  });
});

describe('HOME2 — Research lane reads the SAME nbaSnapshot as the gaps widget, never a second query', () => {
  const body = extractFnBody(cleanApp, '_home3ResearchItems');

  it('reads nbaSnapshot.items only', () => {
    assert.match(body, /nbaSnapshot\.items/);
  });

  it('issues no fetch/opsApi call of its own', () => {
    assert.doesNotMatch(body, /fetch\(/);
    assert.doesNotMatch(body, /opsApi\(/);
  });

  it('is capped at 5 via _home3TopN', () => {
    assert.match(body, /_home3TopN\(items,\s*5\)/);
  });
});

describe('HOME2 — BD lane reads /api/seller-prospect-queue, the SAME route the Priority tab reads, capped at 5', () => {
  const body = extractFnBody(cleanApp, '_home3LoadBdLane');

  it('calls the exact seller-prospect-queue route', () => {
    assert.match(body, /opsApi\('\/api\/seller-prospect-queue\?chip=all&limit=5&offset=0'\)/);
  });

  it('never reads v_priority_queue_enriched or /api/priority-queue (PRI2 superseded that view)', () => {
    assert.doesNotMatch(body, /v_priority_queue_enriched/);
    assert.doesNotMatch(body, /\/api\/priority-queue/);
  });

  it('the render lane additionally caps to 5 client-side (belt-and-suspenders on the route limit)', () => {
    const renderBody = extractFnBody(cleanApp, '_home3RenderBdLane');
    assert.match(renderBody, /_home3TopN\(_home3BdData,\s*5\)/);
  });
});

describe('HOME2 — the BD lane\'s rendered rows are exactly the first five items /api/seller-prospect-queue returns', () => {
  it('_home3TopN(arr, 5) is identity-preserving over the first 5 elements of any array', () => {
    // Isolated eval of the pure helper — no DOM/fetch involved.
    const src = extractFnBody(cleanApp, '_home3TopN');
    // eslint-disable-next-line no-new-func
    const _home3TopN = new Function('arr', 'n', `${src.slice(1, -1)}`);
    const items = [
      { owner_name: 'A' }, { owner_name: 'B' }, { owner_name: 'C' },
      { owner_name: 'D' }, { owner_name: 'E' }, { owner_name: 'F' }, { owner_name: 'G' },
    ];
    const top5 = _home3TopN(items, 5);
    assert.equal(top5.length, 5);
    assert.deepEqual(top5, items.slice(0, 5));
  });

  it('_home3TopN handles a non-array input without throwing (matches the API\'s own array guard)', () => {
    const src = extractFnBody(cleanApp, '_home3TopN');
    const _home3TopN = new Function('arr', 'n', `${src.slice(1, -1)}`);
    assert.deepEqual(_home3TopN(null, 5), []);
    assert.deepEqual(_home3TopN(undefined, 5), []);
  });
});

describe('HOME2 — Inbox lane reads dailyBriefingSnapshot.inbox_summary.items (no new query) and orders new-before-triaged', () => {
  const body = extractFnBody(cleanApp, '_home3RenderInboxLane');

  it('reads the existing daily-briefing snapshot, never a new fetch', () => {
    assert.match(body, /dailyBriefingSnapshot\.inbox_summary\.items/);
    assert.doesNotMatch(body, /fetch\(/);
    assert.doesNotMatch(body, /opsApi\(/);
  });

  it('is capped at 5', () => {
    assert.match(body, /_home3TopN\(_home3RankInboxItems\(raw\),\s*5\)/);
  });

  it('_home3RankInboxItems sorts new items before triaged, tie-broken by created_at DESC', () => {
    const src = extractFnBody(cleanApp, '_home3RankInboxItems');
    const _home3RankInboxItems = new Function('items', `${src.slice(1, -1)}`);
    const items = [
      { title: 'old-triaged', status: 'triaged', created_at: '2026-09-10T00:00:00Z' },
      { title: 'new-old', status: 'new', created_at: '2026-09-01T00:00:00Z' },
      { title: 'new-newest', status: 'new', created_at: '2026-09-15T00:00:00Z' },
      { title: 'newer-triaged', status: 'triaged', created_at: '2026-09-16T00:00:00Z' },
    ];
    const ranked = _home3RankInboxItems(items);
    // Both "new" items sort ahead of both "triaged" items.
    assert.deepEqual(ranked.slice(0, 2).map((r) => r.title).sort(),
      ['new-newest', 'new-old'].sort());
    // Within the "new" group, newest created_at first.
    assert.equal(ranked[0].title, 'new-newest');
    assert.equal(ranked[1].title, 'new-old');
    // Within the "triaged" group, newest created_at first.
    assert.equal(ranked[2].title, 'newer-triaged');
    assert.equal(ranked[3].title, 'old-triaged');
  });
});

describe('HOME2 — the old silent Priority-tab-duplicating fallback does not fire when the flag is on', () => {
  it('_dbFillMyPrioritiesFromQueue is gated on !checkFlag(\'home_three_lanes\')', () => {
    assert.match(cleanApp,
      /if \(_dbFillPriorities && !checkFlag\('home_three_lanes'\)\) _dbFillMyPrioritiesFromQueue\(\);/);
  });
});

describe('HOME2 — call-site wiring', () => {
  it('renderHomeThreeLanes is called from the boot flow alongside renderTodaySections', () => {
    assert.match(cleanApp,
      /renderTodaySections\(\); if \(typeof renderHomeThreeLanes === 'function'\) renderHomeThreeLanes\(\);/);
  });

  it('renderHomeThreeLanes is exported on window (matches every other Home renderer in this file)', () => {
    assert.match(cleanApp, /window\.renderHomeThreeLanes = renderHomeThreeLanes;/);
  });
});

describe('HOME2 — Highlights render path is untouched (HOME1 §C)', () => {
  it('renderDailyBriefingPanel still reads domain_specific_alerts_highlights the same way', () => {
    assert.match(cleanApp, /domain_specific_alerts_highlights/);
    assert.match(cleanApp, /gov\.highlights \|\| \[\]/);
    assert.match(cleanApp, /dia\.highlights \|\| \[\]/);
  });
});

describe('HOME2 — cache busters move as a set (app.js changed, so the shared ?v= param must have moved everywhere)', () => {
  const html = readFileSync(indexPath, 'utf8');
  // The core shared set per CLAUDE.md: app.js / detail.js / ops.js / styles.css.
  // detail-lease-comps-fix.js is a documented pre-existing exception on its own
  // independent version (docs/architecture/calendar-tz-fix-runbook.md) and is
  // deliberately excluded here.
  it('app.js, detail.js, ops.js and styles.css share one ?v= value', () => {
    const files = ['app\\.js', 'detail\\.js', 'ops\\.js', 'styles\\.css'];
    const versions = new Set();
    for (const f of files) {
      const m = html.match(new RegExp(f + '\\?v=(\\d+)'));
      assert.ok(m, `${f} reference with a ?v= not found in index.html`);
      versions.add(m[1]);
    }
    assert.equal(versions.size, 1, `cache-buster versions diverged: ${[...versions].join(', ')}`);
  });
});
