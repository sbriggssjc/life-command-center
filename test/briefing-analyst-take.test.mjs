// test/briefing-analyst-take.test.mjs
// ============================================================================
// P138 / R8 Stage 1 — guards for the on-box "Analyst's Take" planner.
//
// The properties that actually matter here are (a) the take can never state a
// figure the signal block did not, (b) a quiet day produces a short honest take
// rather than an invented one, (c) the tick can never egress the private payload
// to a cloud model, and (d) the write can never clobber the edge function's
// columns. Each is asserted structurally, and the wiring assertions are anchored
// on NAMES (the module, the function, the column) rather than line numbers or a
// source slice — the block-slice footgun in CLAUDE.md recurred three times in one
// arc and every instance was a stale grep, not a real breach.
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CAPS, VOICE_SECTIONS, extractVoiceForBrief, rankTodayPriorities,
  buildAnalystSignals, assessSignalDensity, renderSignalBlock,
  buildAnalystTakePrompt, normalizeAnalystTake, validateAnalystTake,
} from '../api/_shared/briefing-analyst-take.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

const NOW = Date.parse('2026-08-26T12:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();

function richSignals() {
  return buildAnalystSignals({
    asOfDate: '2026-08-26',
    weekday: 'Wednesday',
    workCounts: {
      open_actions: 41, overdue: 7, due_today: 3, my_actions: 12, my_overdue: 2,
      inbox_new: 5, research_active: 316, open_escalations: 1, sync_errors: 0,
    },
    rankedPriorities: [
      { title: 'Woodland Hills closing docs', _tier: 'strategic', due_date: '2026-08-26', _source: 'work', type: 'action' },
      { title: 'Easterly LOI response', _tier: 'important', due_date: null, _source: 'inbox', type: 'inbox' },
    ],
    pipelineRollup: { open_count: 18, by_stage: [{ stage: 'Open', count: 11 }, { stage: 'In Progress', count: 7 }], total_value: 0, weighted_value: 0 },
    dealDelta: {
      window_hours: 24, count: 2,
      items: [
        { deal_name: 'Fresenius Banning', new_comms: 4, summary_refreshed: true, dossier_regenerated: false, milestones: [{ key: 'loi_received', written: 1, rolled_up: 0 }] },
        { deal_name: 'GSA Tulsa', new_comms: 1, summary_refreshed: false, dossier_regenerated: false, milestones: [] },
      ],
    },
    hotContacts: [
      { full_name: 'Andrew Pulliam', company_name: 'Easterly Government Properties', engagement_score: 88, last_email_date: day(31) },
      { full_name: 'Fresh Contact', company_name: 'Acme', engagement_score: 95, last_email_date: day(2) },
    ],
    snapshot: {
      as_of_date: '2026-08-26',
      market_data: { yields: [{ label: '10Y Treasury', value: '4.21%', delta: '+3 bps' }], reits: [{ label: 'O', value: '58.40', delta: '-0.4%' }] },
    },
    lccHealth: { overall_status: 'amber', counts: { red: 0, amber: 2, green: 40 }, top: [] },
    nowMs: NOW,
  });
}

function emptySignals() {
  return buildAnalystSignals({
    asOfDate: '2026-08-26', weekday: 'Wednesday',
    workCounts: {}, rankedPriorities: [], pipelineRollup: {},
    dealDelta: { window_hours: 24, count: 0, items: [] },
    hotContacts: [], snapshot: null, lccHealth: null, nowMs: NOW,
  });
}

// ---------------------------------------------------------------------------

describe('P138 voice extraction', () => {
  it('pulls the brief-shaping sections out of the real profile, and says how', () => {
    const got = extractVoiceForBrief(read('BRIGGS-WRITING-VOICE.md'));
    assert.equal(got.basis, 'sections',
      'the named headings moved in BRIGGS-WRITING-VOICE.md — update VOICE_SECTIONS rather than letting it silently fall back');
    assert.deepEqual(got.sections_found, [...VOICE_SECTIONS]);
    assert.ok(got.text.length > 500 && got.text.length <= CAPS.voice_chars);
    // Email mechanics must NOT ride along — this is a brief, not an email.
    assert.ok(!/## Sign-offs/.test(got.text));
    assert.ok(!/## Per-context variants/.test(got.text));
  });

  it('falls back visibly when the headings are absent, never silently empty', () => {
    const got = extractVoiceForBrief('# Something else\n\nbody text');
    assert.equal(got.basis, 'head_fallback');
    assert.ok(got.text.length > 0);
    assert.equal(extractVoiceForBrief('').basis, 'none');
  });
});

describe('P138 priority selection mirrors buildStrategicPriorities', () => {
  it('takes strategic 3 + important 3 + urgent 4, capped at 7, score-ordered', () => {
    const mk = (tier, score, n) => Array.from({ length: n }, (_, i) => ({ title: `${tier}${i}`, _tier: tier, _score: score - i }));
    const out = rankTodayPriorities([...mk('urgent', 100, 6), ...mk('strategic', 50, 5), ...mk('important', 70, 5)]);
    assert.equal(out.length, 7);
    assert.deepEqual(out.slice(0, 3).map((i) => i._tier), ['strategic', 'strategic', 'strategic']);
    assert.deepEqual(out.slice(3, 6).map((i) => i._tier), ['important', 'important', 'important']);
    assert.equal(out[6]._tier, 'urgent');
    // Within a tier, higher score first.
    assert.equal(out[0].title, 'strategic0');
  });

  it('is total on empty / junk input', () => {
    assert.deepEqual(rankTodayPriorities(null), []);
    assert.deepEqual(rankTodayPriorities([null, undefined]), []);
  });
});

describe('P138 signal assembly', () => {
  it('never emits a pipeline dollar figure — fetchPipelineRollup hard-codes 0 (P180: NULL is not zero)', () => {
    const s = richSignals();
    assert.equal(s.pipeline.deal_value, null);
    assert.match(s.pipeline.deal_value_note, /not on file/i);
    const block = renderSignalBlock(s);
    assert.match(block, /DO NOT state a pipeline dollar figure/);
    assert.ok(!/\$0/.test(block), 'a $0 pipeline reads as worthless, not as unvalued');
  });

  it('only lists contacts genuinely 14+ days cold', () => {
    const s = richSignals();
    assert.deepEqual(s.contacts_cooling.items.map((c) => c.name), ['Andrew Pulliam']);
    assert.equal(s.contacts_cooling.items[0].days_since_touch, 31);
  });

  it('labels every block with the table or view it came from', () => {
    const block = renderSignalBlock(richSignals());
    for (const marker of ['mv_work_counts', 'salesforce_activities', 'lcc_deal_comm_propagated', 'unified_contacts', 'briefing_intel_snapshot']) {
      assert.ok(block.includes(marker), `signal block lost its source label for ${marker}`);
    }
  });

  it('flags a carried-over (non-today) macro snapshot instead of passing it off as today', () => {
    const s = buildAnalystSignals({
      asOfDate: '2026-08-26',
      snapshot: { as_of_date: '2026-08-24', market_data: { yields: [{ label: '10Y', value: '4.2%', delta: '+1 bps' }] } },
      nowMs: NOW,
    });
    assert.equal(s.macro.is_today, false);
    assert.match(renderSignalBlock(s), /NOT today.s data/);
  });

  it('caps every list so one noisy day cannot blow the prompt', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ deal_name: `Deal ${i}`, new_comms: 1, milestones: [] }));
    const s = buildAnalystSignals({ dealDelta: { window_hours: 24, count: 40, items: many }, nowMs: NOW });
    assert.equal(s.book_changes.items.length, CAPS.book_changes);
    assert.equal(s.book_changes.deal_count, 40, 'the CAP truncates what is SHOWN, never what is COUNTED');
  });
});

describe('P138 density gate — a quiet day gets a short honest take', () => {
  it('reads thin when nothing is happening and normal when it is', () => {
    assert.equal(assessSignalDensity(emptySignals()).level, 'thin');
    assert.equal(assessSignalDensity(richSignals()).level, 'normal');
  });

  it('the thin prompt forbids padding; the normal prompt asks for the full read', () => {
    const thin = buildAnalystTakePrompt({ signalBlock: 'x', density: { level: 'thin' } });
    assert.match(thin, /QUIET day/);
    assert.match(thin, /Do NOT stretch it/);
    const normal = buildAnalystTakePrompt({ signalBlock: 'x', density: { level: 'normal' } });
    assert.match(normal, /2.4 short paragraphs/);
    assert.ok(!/QUIET day/.test(normal));
  });

  it('a retry names the fabricated tokens back to the model', () => {
    const p = buildAnalystTakePrompt({ signalBlock: 'x', density: { level: 'normal' }, retryFlags: ['$4.2M', '19%'] });
    assert.match(p, /PREVIOUS ATTEMPT WAS REJECTED/);
    assert.match(p, /\$4\.2M/);
  });
});

describe('P138 output normalisation', () => {
  it('strips the scaffolding a small local model adds', () => {
    const out = normalizeAnalystTake(
      "## Analyst's Take\n\nHere is the take:\n\n- **Woodland Hills** closes today.\n\nSecond point.\n\nBest regards,",
    );
    assert.ok(!/^#/.test(out));
    assert.ok(!out.includes('Here is the take'));
    assert.ok(!out.includes('**'));
    assert.ok(!/^-\s/m.test(out));
    assert.ok(!/Best regards/.test(out));
    assert.match(out, /Woodland Hills closes today/);
  });

  it('caps paragraphs at what the email renderer will show', () => {
    const out = normalizeAnalystTake(Array.from({ length: 9 }, (_, i) => `Para ${i} body text.`).join('\n\n'));
    assert.equal(out.split(/\n\s*\n/).length, CAPS.paragraphs);
  });

  it('is total on empty input', () => {
    assert.equal(normalizeAnalystTake(''), '');
    assert.equal(normalizeAnalystTake(null), '');
  });
});

describe('P138 fabrication guard — the cardinal rule', () => {
  const block = renderSignalBlock(richSignals());

  it('passes a take that states only grounded figures', () => {
    const take = 'Seven items are overdue and three are due today. Fresenius Banning took four new correspondence items overnight.';
    const v = validateAnalystTake(take, { signalBlock: block });
    assert.equal(v.ok, true, `unexpected flags: ${JSON.stringify(v.flagged)}`);
  });

  it('REJECTS an invented dollar figure', () => {
    const v = validateAnalystTake('Your pipeline is worth $42.5M across the book.', { signalBlock: block });
    assert.equal(v.ok, false);
    assert.ok(v.ungrounded_numbers.some((t) => t.includes('42.5')));
  });

  it('REJECTS a small invented COUNT — the case draft-assist NUM_TOKEN cannot see', () => {
    // draft-assist-core's NUM_TOKEN needs 3+ digits for a bare number, so "9" would
    // sail through there. Here a wrong small count is the dangerous fabrication:
    // "9 overdue" when the truth is 7 reads perfectly and is a lie.
    const v = validateAnalystTake('You are carrying 9 overdue actions this morning.', { signalBlock: block });
    assert.equal(v.ok, false);
    assert.deepEqual(v.ungrounded_numbers, ['9']);
  });

  it('REJECTS an invented cap rate / bps move', () => {
    assert.equal(validateAnalystTake('Cap rates ticked to 7.85% overnight.', { signalBlock: block }).ok, false);
  });

  it('REJECTS an invented date', () => {
    assert.equal(validateAnalystTake('The deadline is 2026-12-31.', { signalBlock: block }).ok, false);
  });

  it('REPORTS but does not reject an unrecognised proper name (P158a: the obvious guard is the destructive one)', () => {
    const v = validateAnalystTake('Boyd Watterson has gone quiet.', { signalBlock: block });
    assert.equal(v.ok, true, 'a name false-positive must never kill a whole take');
    assert.ok(v.ungrounded_names.includes('Boyd Watterson'));
  });

  it('does not flag ordinary capitalised prose as a fabricated party', () => {
    const v = validateAnalystTake('This Morning The Work queue is heavy.', { signalBlock: block });
    assert.deepEqual(v.ungrounded_names, []);
  });

  it('treats an empty take as not ok', () => {
    assert.equal(validateAnalystTake('', { signalBlock: block }).ok, false);
  });
});

// Both wiring assertions below read the handler with COMMENTS STRIPPED. Grepping
// the raw source is the literal-grep footgun CLAUDE.md documents: this file's own
// first run went red on its own prose — the writeTake comment names market_data
// while explaining that it never writes it, and the assembler's comment names
// buildStrategicPriorities while explaining why it is deliberately not called.
// Both were stale greps, not breaches.
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

describe('P138 wiring + doctrine', () => {
  const handlerRaw = read('api/_handlers/briefing-analyst-take-tick.js');
  const handler = stripComments(handlerRaw);

  it('generates ON-BOX only — never touches the Anthropic API', () => {
    assert.match(handler, /invokeOnPremGeneration/,
      'generation must go through the fail-closed on-prem seam');
    assert.ok(!/api\.anthropic\.com/.test(handler),
      'the private LCC signal payload must never egress to a cloud model');
    assert.ok(!/invokeExtractionAI|invokeChatProvider/.test(handler),
      'invokeExtractionAI falls back to CLOUD on a local failure — that is exactly the egress this surface forbids');
  });

  it('is flag-gated and registers the flag under one name everywhere', () => {
    assert.match(handler, /const FLAG = 'BRIEFING_ANALYST_TAKE_ONPREM'/);
    assert.match(handler, /flagEnabled\(FLAG, flagRow\)/);
    const mig = read('supabase/migrations/20261001121000_lcc_p138_briefing_analyst_take_onprem.sql');
    assert.match(mig, /feature_flags_registry/);
    assert.match(mig, /BRIEFING_ANALYST_TAKE_ONPREM/);
  });

  it('writes ONLY the two columns it owns — never the edge function’s', () => {
    // Anchored on the writer function by name, not a line range.
    const fn = handler.slice(handler.indexOf('async function writeTake'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.ok(body.length > 100, 'writeTake slice anchor drifted — fix the anchor, do not weaken the assertion');
    assert.match(body, /analyst_take:/);
    assert.match(body, /analyst_take_meta:/);
    for (const owned of ['market_data', 'sector_news', 'capital_markets', 'reading_list', 'key_numbers', 'warnings']) {
      assert.ok(!body.includes(owned), `the tick must never write ${owned} — that column belongs to the edge function`);
    }
    assert.match(body, /workspace_id=is\.null/, 'the write must be scoped to the global snapshot row');
  });

  it('opens a health event on every UNCHOSEN non-write so an empty take is never silent', () => {
    assert.match(handler, /openEmptyTakeAlert\(gen\.reason/, 'a rejected or ungenerated take must be visible');
    assert.match(handler, /openEmptyTakeAlert\('write_failed'/);
    // ...and auto-retires it when a take lands (the auto-resolve half of the doctrine).
    assert.match(handler, /resolveEmptyTakeAlert\(/);
    // But NOT for flag_off: that state was chosen, and feature_flags_registry plus
    // the brief's Dormant Capabilities section already surface it. An alert row
    // describing a decision would sit open forever — badge-that-is-noise.
    assert.ok(!/openEmptyTakeAlert\('flag_off'/.test(handler));
  });

  it('never calls buildStrategicPriorities — it would double-send the Teams cold alerts', () => {
    assert.ok(!/buildStrategicPriorities/.test(handler));
    assert.match(handler, /scoreItem/, 'ranking must still use the SHARED scorer, not a private copy');
  });

  it('is mounted in server.js and dispatched in admin.js', () => {
    assert.match(read('server.js'), /'\/api\/briefing-analyst-take-tick'/);
    const admin = read('api/admin.js');
    assert.match(admin, /case 'briefing-analyst-take-tick': return handleBriefingAnalystTakeTick/);
    assert.match(admin, /from '\.\/_handlers\/briefing-analyst-take-tick\.js'/);
  });

  it('the edge function no longer upserts a null analyst_take over ours', () => {
    const edge = read('supabase/functions/briefing-intel-snapshot/index.ts');
    assert.match(edge, /if \(row\.analyst_take == null\) delete row\.analyst_take;/,
      'without this a re-fire of the edge function nulls the on-box take and the brief goes silently empty');
  });
});
