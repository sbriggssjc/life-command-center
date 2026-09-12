// MB-b — renderer snapshot tests for the daily "Lane Briefs" email block
// (briefing-email-handler.js::renderMarketBriefLanes). Pure / no-DB: every
// input is a fixture fact object, exactly as v_market_brief_live would
// return. Covers the guard list from the prompt's §4:
//   - the diff case ("changed since yesterday")
//   - the gap case (freshness badge / named gap rendered plainly)
//   - the omitted-empty-lane case (a lane with no facts is not rendered)
//   - a tripwire: no number appears in the rendered block unless it is
//     traceable to a fact object handed to the renderer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __internal } from '../api/_handlers/briefing-email-handler.js';

const { renderMarketBriefLanes } = __internal;

function fact({ section = 'capital_markets', claim_text, is_stale = false, source_date = '2026-09-10', unit = 'count' } = {}) {
  return { section, claim_text, is_stale, source_date, unit };
}

test('renderMarketBriefLanes returns "" when no lane has live facts (omitted, not an empty section)', () => {
  const html = renderMarketBriefLanes({ marketBriefLanes: [], readFullBriefBaseUrl: 'https://lcc.example' });
  assert.equal(html, '');
});

test('renderMarketBriefLanes returns "" when marketBriefLanes is absent/null', () => {
  assert.equal(renderMarketBriefLanes({}), '');
  assert.equal(renderMarketBriefLanes({ marketBriefLanes: null }), '');
});

test('renderMarketBriefLanes only renders lanes present in the input array — a lane with no live facts (never included by the caller) never appears', () => {
  const html = renderMarketBriefLanes({
    marketBriefLanes: [
      { lane: 'dialysis', topFacts: [fact({ claim_text: '211 dialysis properties currently on-market.' })], gapFacts: [], changedSinceYesterday: [] },
    ],
    readFullBriefBaseUrl: 'https://lcc.example',
  });
  assert.match(html, /Dialysis/);
  assert.doesNotMatch(html, /Government-Leased/);
  assert.doesNotMatch(html, /Net Lease/i);
});

test('renderMarketBriefLanes renders the top facts verbatim, with an as-of badge', () => {
  const html = renderMarketBriefLanes({
    marketBriefLanes: [{
      lane: 'dialysis',
      topFacts: [fact({ claim_text: 'TTM dialysis cap-rate band: median 7.00%, IQR 5.69%–8.03% (n=169).', source_date: '2026-09-11' })],
      gapFacts: [],
      changedSinceYesterday: [],
    }],
    readFullBriefBaseUrl: 'https://lcc.example',
  });
  assert.match(html, /TTM dialysis cap-rate band: median 7\.00%/);
  assert.match(html, /as of Sep 11/);
});

test('renderMarketBriefLanes flags a stale fact distinctly from a fresh one', () => {
  const html = renderMarketBriefLanes({
    marketBriefLanes: [{
      lane: 'dialysis',
      topFacts: [fact({ claim_text: 'A stale claim.', is_stale: true, source_date: '2026-01-01' })],
      gapFacts: [], changedSinceYesterday: [],
    }],
    readFullBriefBaseUrl: 'https://lcc.example',
  });
  assert.match(html, /stale — as of Jan 1/);
});

test('renderMarketBriefLanes renders a named gap plainly, not fabricated as a count', () => {
  const html = renderMarketBriefLanes({
    marketBriefLanes: [{
      lane: 'dialysis',
      topFacts: [],
      gapFacts: [fact({
        section: 'operators', unit: 'gap_marker',
        claim_text: "DaVita's CMS clinic census is stale (last observed 2026-01-22) — count withheld pending a fresh CMS ingest.",
      })],
      changedSinceYesterday: [],
    }],
    readFullBriefBaseUrl: 'https://lcc.example',
  });
  assert.match(html, /count withheld pending a fresh CMS ingest/);
});

test('renderMarketBriefLanes renders the "changed since yesterday" diff', () => {
  const html = renderMarketBriefLanes({
    marketBriefLanes: [{
      lane: 'dialysis',
      topFacts: [fact({ claim_text: 'Current claim.' })],
      gapFacts: [],
      changedSinceYesterday: [
        { fact_id: '1', claim_text: 'A brand-new claim that landed today.', action: 'added' },
        { fact_id: '2', claim_text: 'A claim that dropped off.', action: 'superseded_or_expired' },
      ],
    }],
    readFullBriefBaseUrl: 'https://lcc.example',
  });
  assert.match(html, /Changed since yesterday/);
  assert.match(html, /New — A brand-new claim that landed today\./);
  assert.match(html, /Updated — A claim that dropped off\./);
});

test('renderMarketBriefLanes omits the "changed since yesterday" line when there is no diff (first-ever render)', () => {
  const html = renderMarketBriefLanes({
    marketBriefLanes: [{
      lane: 'dialysis',
      topFacts: [fact({ claim_text: 'Current claim.' })],
      gapFacts: [], changedSinceYesterday: [],
    }],
    readFullBriefBaseUrl: 'https://lcc.example',
  });
  assert.doesNotMatch(html, /Changed since yesterday/);
});

test('renderMarketBriefLanes links "Read the full brief" to the homepage tab for the lane', () => {
  const html = renderMarketBriefLanes({
    marketBriefLanes: [{ lane: 'dialysis', topFacts: [fact({ claim_text: 'x' })], gapFacts: [], changedSinceYesterday: [] }],
    readFullBriefBaseUrl: 'https://lcc.example',
  });
  assert.match(html, /Read the full brief/);
  assert.match(html, /https:\/\/lcc\.example#\/briefs\/dialysis/);
});

test('renderMarketBriefLanes renders multiple lanes in the order given', () => {
  const html = renderMarketBriefLanes({
    marketBriefLanes: [
      { lane: 'dialysis', topFacts: [fact({ claim_text: 'dia claim' })], gapFacts: [], changedSinceYesterday: [] },
      { lane: 'government', topFacts: [fact({ claim_text: 'gov claim' })], gapFacts: [], changedSinceYesterday: [] },
    ],
    readFullBriefBaseUrl: 'https://lcc.example',
  });
  assert.ok(html.indexOf('dia claim') < html.indexOf('gov claim'));
});

// ---------------------------------------------------------------------------
// Tripwire (spec §4): no number appears in the rendered block unless it is
// traceable to a fact object the renderer was handed. Renders a fixed fact
// set, extracts every numeric token from the HTML output, and asserts each
// one is present verbatim in either a claim_text or the injected date
// literals — the renderer itself must never compute/interpolate a number
// that did not already live on a fact.
// ---------------------------------------------------------------------------

function numericTokens(text) {
  const matches = String(text || '').match(/\d[\d,]*\.?\d*/g) || [];
  return matches.map((m) => m.replace(/,/g, '')).filter(Boolean);
}

test('tripwire: every number in the rendered Lane Briefs block traces back to a fact claim_text', () => {
  const lanes = [{
    lane: 'dialysis',
    topFacts: [
      fact({ claim_text: 'TTM dialysis cap-rate band: median 7.00%, IQR 5.69%–8.03% (n=169).', source_date: '2026-09-11' }),
      fact({ claim_text: '211 dialysis properties currently on-market.', source_date: '2026-09-12' }),
    ],
    gapFacts: [fact({ unit: 'gap_marker', claim_text: "Fresenius's CMS clinic census is stale (last observed 2026-01-22) — count withheld pending a fresh CMS ingest." })],
    changedSinceYesterday: [{ fact_id: 'x', claim_text: '3 dialysis sales recorded in the trailing 7 days as of 2026-09-12.', action: 'added' }],
  }];
  const html = renderMarketBriefLanes({ marketBriefLanes: lanes, readFullBriefBaseUrl: 'https://lcc.example' });

  // Every claim/date string the renderer was given, concatenated — the
  // allowed source of every number in the output.
  const allowedSourceText = lanes.flatMap((l) => [
    ...l.topFacts.map((f) => `${f.claim_text} ${f.source_date}`),
    ...l.gapFacts.map((f) => f.claim_text),
    ...l.changedSinceYesterday.map((c) => c.claim_text),
  ]).join(' ');
  // The renderer also injects month/day tokens derived from source_date via
  // fmtMonthDay ("Sep 11" etc, no digits beyond the day-of-month, already a
  // verbatim substring of source_date's own day component) and the lane
  // label — neither introduces a NEW number, so the allowed set is exactly
  // the numbers already present in the facts it was handed.
  const allowedNumbers = new Set(numericTokens(allowedSourceText));

  // Strip EVERY tag entirely (not just attributes) before scanning for
  // numeric tokens — a tag NAME can itself carry a digit (e.g. `<h2>`), and
  // layout numbers (padding, font-size, cellpadding) plus link URLs are
  // structural, never "a number rendered as a fact". Only the visible TEXT
  // content is a claim a reader could act on.
  const textOnly = html.replace(/<[^>]*>/g, ' ').replace(/&#\d+;/g, ''); // strip escapeHtml's numeric entities (e.g. &#39; for '), an encoding artifact, not a claimed number
  const renderedNumbers = numericTokens(textOnly);

  for (const n of renderedNumbers) {
    assert.ok(allowedNumbers.has(n), `number "${n}" appeared in the rendered block but is not traceable to any fact given to the renderer`);
  }
});
