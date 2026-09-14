// api/_shared/briefing-analyst-take.js
// ============================================================================
// P138 / R8 Stage 1 — the PURE planner behind the daily brief's "Analyst's Take".
//
// The briefing email has shipped a renderAnalystTake() section since v2, reading
// briefing_intel_snapshot.analyst_take. That column has been EMPTY since
// 2026-07-07 (11 of 67 rows ever carried a take), so the section renders nothing.
//
// ⚠️ GROUNDING CORRECTION — the originating prompt said the edge function is
// "gated on ANTHROPIC_API_KEY; when unset it pushes the warning 'ANTHROPIC_API_KEY
// not set'". Measured live 2026-08-26 on LCC Opps: the key IS set and every row
// from 2026-07-08 onward carries the warning
//   "Anthropic API 400: ... Your credit balance is too low to access the Anthropic API"
// So the cloud path is not merely un-configured, it is BILLING-DEAD — and it took
// `capital_markets` down with it (cm_len 0 on every one of those rows too). The
// fix here is scoped to analyst_take as the prompt directs; the capital_markets
// outage is REPORTED, not silently inherited.
//
// WHY ON-BOX. The Analyst's Take synthesizes PRIVATE LCC data — work counts,
// scored priorities, deal-propagation deltas, cooling contacts by name. Per the
// standing doctrine (private corpora never egress to a cloud model) that synthesis
// belongs on the GaryBuilt box via invokeOnPremGeneration (fail-CLOSED, no cloud
// fallback), not at api.anthropic.com. The macro block folded into the payload is
// PUBLIC market data that already lives in our own snapshot row — reading it back
// out of our DB is not an egress event.
//
// WHAT LIVES HERE. Pure functions only: no network, no env, no clock beyond what
// the caller passes in. The handler (api/_handlers/briefing-analyst-take-tick.js)
// owns fetching, the model call, and the write.
//
// THE CARDINAL RULE. The take may state ONLY what the signal block states.
// validateAnalystTake() re-reads the generated prose against the block and REJECTS
// (never mangles) a take carrying an ungrounded number or date. A rejected take
// leaves analyst_take null — the email section already degrades to empty — and
// raises a health event, because an empty take that looks like "quiet news day" is
// exactly the silent-failure class this codebase keeps re-learning.
// ============================================================================

/** Hard caps so one noisy day can never blow the prompt (or the model's context). */
export const CAPS = Object.freeze({
  priorities: 7,
  book_changes: 6,
  contacts: 5,
  macro_rows: 6,
  health_rows: 4,
  voice_chars: 6000,
  paragraphs: 4,
  take_chars: 2600,
});

// ---------------------------------------------------------------------------
// Voice profile — extract only the sections that shape a BRIEF
// ---------------------------------------------------------------------------

// BRIGGS-WRITING-VOICE.md is ~23 KB and mostly email-drafting specific (sign-offs,
// per-context variants, corpus provenance). A brief needs the through-line: how he
// sounds, what he never does, how he shapes paragraphs, and the mechanics. Pulling
// the whole file would spend the budget teaching the model to write an email.
export const VOICE_SECTIONS = Object.freeze([
  '## Overall voice',
  '## Paragraph shape & long-form structure',
  '## Mechanics (deterministic)',
]);

/**
 * Slice the named top-level sections out of the voice profile markdown.
 *
 * P125 lesson applied: the RESULT carries the fact of how it was obtained
 * (`basis`) instead of leaving a caller to re-derive it from the length. If the
 * headings ever move, `basis` reads 'head_fallback' and the caller reports it —
 * the profile is never silently absent while everything else looks healthy.
 *
 * @param {string} md  raw BRIGGS-WRITING-VOICE.md
 * @returns {{ text:string, basis:'sections'|'head_fallback'|'none', sections_found:string[] }}
 */
export function extractVoiceForBrief(md) {
  const src = String(md || '');
  if (!src.trim()) return { text: '', basis: 'none', sections_found: [] };

  const lines = src.split('\n');
  const found = [];
  const out = [];
  let capturing = false;

  for (const line of lines) {
    const isTopHeading = /^##\s+/.test(line);
    if (isTopHeading) {
      const match = VOICE_SECTIONS.find((s) => line.startsWith(s));
      capturing = !!match;
      if (match) { found.push(match); out.push(line); }
      continue;
    }
    if (capturing) out.push(line);
  }

  if (!found.length) {
    return {
      text: src.slice(0, CAPS.voice_chars),
      basis: 'head_fallback',
      sections_found: [],
    };
  }
  return {
    text: out.join('\n').trim().slice(0, CAPS.voice_chars),
    basis: 'sections',
    sections_found: found,
  };
}

// ---------------------------------------------------------------------------
// Priority selection — mirrors buildStrategicPriorities EXACTLY
// ---------------------------------------------------------------------------

/**
 * The strategic-3 / important-3 / urgent-4, capped-7 selection that
 * briefing-data.js::buildStrategicPriorities applies to its scored pool.
 *
 * ⚠️ The tick deliberately does NOT call buildStrategicPriorities itself, even
 * though it is the obvious "reuse, don't re-derive" move. That function has a
 * SIDE EFFECT — under TEAMS_COLD_ALERTS_ENABLED it posts up to three outbound
 * "Warm Contact Going Cold" Teams alerts — and it issues one
 * rpc/get_contact_recommendation_weight round trip per candidate. Calling it from
 * a 10:18 cron would DOUBLE-SEND those alerts, once here and once when the brief
 * renders at 12:30. So the tick reuses the shared SCORER (scoreItem /
 * deriveItemTitle, the actual authority on ranking) and applies the selection rule
 * here, where it is pure and unit-testable.
 *
 * @param {Array<{_score:number,_tier:string}>} scoredItems
 * @returns {Array} the selected items, highest score first within tier order
 */
export function rankTodayPriorities(scoredItems) {
  const all = (Array.isArray(scoredItems) ? scoredItems : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (b._score || 0) - (a._score || 0));
  const pick = (tier) => all.filter((i) => i._tier === tier);
  return [
    ...pick('strategic').slice(0, 3),
    ...pick('important').slice(0, 3),
    ...pick('urgent').slice(0, 4),
  ].slice(0, CAPS.priorities);
}

// ---------------------------------------------------------------------------
// Signal assembly
// ---------------------------------------------------------------------------

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => String(v == null ? '' : v).trim();

function daysSinceTouch(c, nowMs) {
  const last = Math.max(
    c.last_call_date ? new Date(c.last_call_date).getTime() : 0,
    c.last_email_date ? new Date(c.last_email_date).getTime() : 0,
    c.last_meeting_date ? new Date(c.last_meeting_date).getTime() : 0,
  );
  if (!(last > 0)) return null;
  return Math.floor((nowMs - last) / 86400000);
}

/**
 * Assemble the labelled private-signal set. Every figure carries the table or view
 * it came from so the model reads a sourced statement, never anonymous JSON
 * (the v5.3 lesson the edge function already records in its own prompt builder).
 *
 * @param {object} raw
 * @returns {object} signals
 */
export function buildAnalystSignals({
  asOfDate = '',
  weekday = '',
  workCounts = {},
  rankedPriorities = [],
  pipelineRollup = {},
  dealDelta = {},
  hotContacts = [],
  snapshot = null,
  lccHealth = null,
  nowMs = 0,
} = {}) {
  const macroRow = (list, kind) => (Array.isArray(list) ? list : [])
    .slice(0, CAPS.macro_rows)
    .map((y) => ({ kind, label: str(y.label), value: str(y.value), delta: str(y.delta) }))
    .filter((y) => y.label && y.value);

  const md = (snapshot && snapshot.market_data) || {};

  return {
    as_of_date: str(asOfDate),
    weekday: str(weekday),

    work: {
      source: 'LCC Opps mv_work_counts / v_work_counts (via fetchWorkCounts)',
      open_actions: num(workCounts.open_actions),
      overdue: num(workCounts.overdue),
      due_today: num(workCounts.due_today),
      my_actions: num(workCounts.my_actions),
      my_overdue: num(workCounts.my_overdue),
      inbox_new: num(workCounts.inbox_new),
      research_active: num(workCounts.research_active),
      open_escalations: num(workCounts.open_escalations),
      sync_errors: num(workCounts.sync_errors),
    },

    priorities: {
      source: 'LCC Opps v_my_work + inbox_items + salesforce_activities, ranked by briefing-data.js scoreItem',
      items: (Array.isArray(rankedPriorities) ? rankedPriorities : [])
        .slice(0, CAPS.priorities)
        .map((i) => ({
          title: str(i.title),
          tier: str(i.tier || i._tier),
          due_date: i.due_date || null,
          origin: str(i.source || i._source),
          type: str(i.type),
        }))
        .filter((i) => i.title),
    },

    pipeline: {
      source: 'dia salesforce_activities (nm_type=Opportunity, status Open/In Progress)',
      open_count: num(pipelineRollup.open_count),
      by_stage: (Array.isArray(pipelineRollup.by_stage) ? pipelineRollup.by_stage : [])
        .slice(0, 6)
        .map((s) => ({ stage: str(s.stage), count: num(s.count) })),
      // ⚠️ P180 (NULL is not zero). fetchPipelineRollup hard-codes total_value and
      // weighted_value to 0 because the SF Amount/Probability fields are not in the
      // projection it reads. Passing those zeros through would render "$0 pipeline"
      // — worthless, not unvalued. The dollar figure is UNKNOWN and says so.
      deal_value: null,
      deal_value_note: 'not on file — Salesforce Amount is not in the projection this rollup reads',
    },

    book_changes: {
      source: 'LCC Opps lcc_deal_comm_propagated ledger + lcc_deal_correspondence_summary + lcc_dossiers',
      window_hours: num(dealDelta.window_hours) || 24,
      deal_count: num(dealDelta.count),
      items: (Array.isArray(dealDelta.items) ? dealDelta.items : [])
        .slice(0, CAPS.book_changes)
        .map((d) => ({
          deal_name: str(d.deal_name),
          new_comms: num(d.new_comms),
          summary_refreshed: !!d.summary_refreshed,
          dossier_regenerated: !!d.dossier_regenerated,
          milestones: (Array.isArray(d.milestones) ? d.milestones : [])
            .filter((m) => num(m.written) > 0)
            .map((m) => str(m.key))
            .filter(Boolean)
            .slice(0, 4),
        }))
        .filter((d) => d.deal_name),
    },

    contacts_cooling: {
      source: 'unified_contacts (business class, engagement_score > 0) — no touch in 14+ days',
      // Deliberately UNRANKED relative to the email's "recommended calls": that list
      // is re-weighted per contact by rpc/get_contact_recommendation_weight, which
      // this tick does not call (see rankTodayPriorities). Ordered by raw engagement
      // score and labelled as such, so the take never claims an ordering it did not read.
      ordering: 'engagement_score desc (NOT the email’s re-weighted call order)',
      items: (Array.isArray(hotContacts) ? hotContacts : [])
        .map((c) => ({ c, days: daysSinceTouch(c, nowMs) }))
        .filter((x) => x.days != null && x.days >= 14)
        .sort((a, b) => num(b.c.engagement_score) - num(a.c.engagement_score))
        .slice(0, CAPS.contacts)
        .map((x) => ({
          name: str(x.c.full_name),
          company: str(x.c.company_name),
          engagement_score: num(x.c.engagement_score),
          days_since_touch: x.days,
        }))
        .filter((c) => c.name),
    },

    macro: {
      source: 'today’s briefing_intel_snapshot.market_data (public market data, already in our DB)',
      snapshot_date: str(snapshot && snapshot.as_of_date),
      is_today: snapshot ? snapshot.as_of_date === str(asOfDate) : false,
      rows: [
        ...macroRow(md.yields, 'yield'),
        ...macroRow(md.reits, 'reit').slice(0, 3),
      ],
    },

    health: {
      source: 'LCC Opps lcc_health_alerts rollup (fetchLccHealthSnapshot)',
      overall_status: str(lccHealth && lccHealth.overall_status) || 'unknown',
      red: num(lccHealth && lccHealth.counts && lccHealth.counts.red),
      amber: num(lccHealth && lccHealth.counts && lccHealth.counts.amber),
      top: (Array.isArray(lccHealth && lccHealth.top) ? lccHealth.top : [])
        .slice(0, CAPS.health_rows)
        .map((h) => str(h.label || h.name || h.check_name || h.summary))
        .filter(Boolean),
    },
  };
}

/**
 * How much real material is there today? A quiet day must produce a SHORT factual
 * take, never an invented one — so the density verdict is an input to the prompt,
 * not a post-hoc excuse.
 *
 * @returns {{ level:'thin'|'normal', score:number, present:string[], absent:string[] }}
 */
export function assessSignalDensity(signals) {
  const s = signals || {};
  const checks = [
    ['priorities', (s.priorities?.items || []).length > 0],
    ['book_changes', (s.book_changes?.deal_count || 0) > 0],
    ['open_work', (s.work?.open_actions || 0) > 0 || (s.work?.overdue || 0) > 0],
    ['pipeline', (s.pipeline?.open_count || 0) > 0],
    ['contacts_cooling', (s.contacts_cooling?.items || []).length > 0],
    ['macro', (s.macro?.rows || []).length > 0],
  ];
  const present = checks.filter(([, ok]) => ok).map(([k]) => k);
  const absent = checks.filter(([, ok]) => !ok).map(([k]) => k);
  return {
    level: present.length <= 2 ? 'thin' : 'normal',
    score: present.length,
    present,
    absent,
  };
}

// ---------------------------------------------------------------------------
// Signal block rendering — pre-formatted, labelled, never raw JSON
// ---------------------------------------------------------------------------

function bullet(s) { return '  - ' + s; }

/** Render the assembled signals as the human-readable block the model reads. */
export function renderSignalBlock(signals) {
  const s = signals || {};
  const L = [];

  L.push(`DATE: ${s.as_of_date || '(unknown)'}${s.weekday ? ' (' + s.weekday + ')' : ''}`);
  L.push('');

  const w = s.work || {};
  L.push(`WORK QUEUE  [source: ${w.source || 'n/a'}]`);
  L.push(bullet(`open actions across the workspace: ${num(w.open_actions)}`));
  L.push(bullet(`overdue: ${num(w.overdue)}`));
  L.push(bullet(`due today: ${num(w.due_today)}`));
  L.push(bullet(`assigned to Scott: ${num(w.my_actions)} (overdue: ${num(w.my_overdue)})`));
  L.push(bullet(`new inbox items: ${num(w.inbox_new)}`));
  L.push(bullet(`active research tasks: ${num(w.research_active)}`));
  L.push(bullet(`open escalations: ${num(w.open_escalations)}`));
  L.push(bullet(`connector sync errors: ${num(w.sync_errors)}`));
  L.push('');

  const p = s.priorities || {};
  L.push(`TODAY’S RANKED PRIORITIES  [source: ${p.source || 'n/a'}]`);
  if ((p.items || []).length) {
    for (const it of p.items) {
      const bits = [it.tier ? `tier ${it.tier}` : '', it.due_date ? `due ${it.due_date}` : 'no due date', it.origin ? `from ${it.origin}` : '']
        .filter(Boolean).join(', ');
      L.push(bullet(`${it.title}  [${bits}]`));
    }
  } else {
    L.push(bullet('none ranked today'));
  }
  L.push('');

  const pl = s.pipeline || {};
  L.push(`PIPELINE  [source: ${pl.source || 'n/a'}]`);
  L.push(bullet(`open opportunities: ${num(pl.open_count)}`));
  for (const st of (pl.by_stage || [])) L.push(bullet(`stage "${st.stage}": ${st.count}`));
  L.push(bullet(`total deal value: ${pl.deal_value_note || 'not on file'} — DO NOT state a pipeline dollar figure`));
  L.push('');

  const bc = s.book_changes || {};
  L.push(`WHAT CHANGED ON THE BOOK IN THE LAST ${num(bc.window_hours) || 24}H  [source: ${bc.source || 'n/a'}]`);
  if ((bc.items || []).length) {
    for (const d of bc.items) {
      const extras = [
        `${d.new_comms} new correspondence item(s)`,
        d.milestones.length ? `milestones written: ${d.milestones.join(', ')}` : '',
        d.summary_refreshed ? 'correspondence summary refreshed' : '',
        d.dossier_regenerated ? 'dossier regenerated' : '',
      ].filter(Boolean).join('; ');
      L.push(bullet(`${d.deal_name}: ${extras}`));
    }
  } else {
    L.push(bullet(`no deals had correspondence propagate in the last ${num(bc.window_hours) || 24} hours`));
  }
  L.push('');

  const cc = s.contacts_cooling || {};
  L.push(`RELATIONSHIPS GOING QUIET  [source: ${cc.source || 'n/a'}; ordering: ${cc.ordering || 'n/a'}]`);
  if ((cc.items || []).length) {
    for (const c of cc.items) {
      L.push(bullet(`${c.name}${c.company ? ' (' + c.company + ')' : ''}: ${c.days_since_touch} days since last touch, engagement score ${c.engagement_score}`));
    }
  } else {
    L.push(bullet('no high-engagement contact is 14+ days cold'));
  }
  L.push('');

  const m = s.macro || {};
  L.push(`MARKET CONTEXT  [source: ${m.source || 'n/a'}${m.snapshot_date ? '; snapshot ' + m.snapshot_date : ''}${m.is_today === false ? ' — NOT today’s data, say so if you use it' : ''}]`);
  if ((m.rows || []).length) {
    for (const r of m.rows) L.push(bullet(`${r.label}: ${r.value}${r.delta ? ' (' + r.delta + ' 1d)' : ''}`));
  } else {
    L.push(bullet('no market data captured in today’s snapshot'));
  }
  L.push('');

  const h = s.health || {};
  L.push(`SYSTEM HEALTH  [source: ${h.source || 'n/a'}]`);
  L.push(bullet(`overall: ${h.overall_status}; red: ${num(h.red)}, amber: ${num(h.amber)}`));
  for (const t of (h.top || [])) L.push(bullet(t));

  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Build the on-prem generation prompt.
 *
 * @param {object} o
 * @param {string} o.voice        the extracted voice sections (tone only)
 * @param {string} o.signalBlock  renderSignalBlock() output
 * @param {{level:string}} o.density
 * @param {string[]} [o.retryFlags] tokens a prior attempt fabricated (retry pass only)
 */
export function buildAnalystTakePrompt({ voice = '', signalBlock = '', density = { level: 'normal' }, retryFlags = [] } = {}) {
  const thin = density && density.level === 'thin';

  const shape = thin
    ? 'It is a QUIET day — the signals below are thin. Write ONE short paragraph (2–4 sentences) that says plainly what is and is not there. Do NOT stretch it. A short honest take is the correct output; padding it with market commentary you were not given is a failure.'
    : 'Write 2–4 short paragraphs. Paragraph one: what matters today and why. Paragraph two: what changed on the book overnight. Paragraph three (only if the signals support it): where the attention is worth spending, and what is quietly slipping.';

  const retryBlock = (retryFlags || []).length
    ? [
        '',
        '### YOUR PREVIOUS ATTEMPT WAS REJECTED',
        'It contained these figures, which appear NOWHERE in the signals above:',
        ...retryFlags.slice(0, 12).map((t) => `  - ${t}`),
        'Rewrite it. Use only figures that appear verbatim in the signals. When you have no number, describe the thing without one.',
      ].join('\n')
    : '';

  return [
    'You are writing the "Analyst’s Take" section of Scott Briggs’s own morning brief. Scott is a Northmarq net lease investment sales broker covering dialysis (DaVita/Fresenius), government-leased real estate (GSA/agency tenants), and single-tenant net lease. You are writing TO Scott, in HIS voice, about HIS book.',
    '',
    '### HARD RULES (a violation makes the take unusable and it will be thrown away)',
    '1. Every number, name, date and deal you state MUST appear in the SIGNALS block below. Never invent, round, extrapolate, or estimate a figure. If a line says "not on file", the answer is that it is not on file — never fill it.',
    '2. Do not introduce market commentary, rate calls, cap-rate levels, comps, or news that is not in the SIGNALS. You have no other sources.',
    '3. No headings, no bullet lists, no subject line, no greeting, no sign-off. Plain prose paragraphs separated by a blank line. Nothing else.',
    '4. This is a read for Scott, not a report about him. Do not narrate the data ("the work queue shows..."); say what it means and what to do.',
    '5. It is a BRIEF, not an email. The voice profile below governs TONE ONLY — ignore its email mechanics (greetings, sign-offs).',
    '',
    '### SCOTT’S VOICE (shapes HOW it reads — never WHAT it claims)',
    String(voice || '(voice profile unavailable — write plainly: short, direct, specifics over adjectives, no filler)'),
    '',
    '### SHAPE',
    shape,
    '',
    '### SIGNALS (the ONLY facts you may state)',
    String(signalBlock || '(no signals assembled)'),
    retryBlock,
    '',
    'Write the Analyst’s Take now. Prose only, beginning with the first sentence.',
  ].filter((x) => x !== '').join('\n');
}

// ---------------------------------------------------------------------------
// Output normalisation + fabrication guard
// ---------------------------------------------------------------------------

/**
 * Strip the scaffolding a small local model habitually adds (a markdown heading,
 * a "Here is..." preamble, bullet markers, a sign-off) and cap the length. The
 * email renderer already strips HTML and takes the first 4 paragraphs; doing it
 * here too means the STORED column is clean, so the plain-text arm of the email
 * (which does not re-paragraph) is clean as well.
 */
export function normalizeAnalystTake(raw) {
  let t = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!t) return '';

  // Drop a leading fenced block wrapper if the model wrapped the prose.
  t = t.replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/i, '');

  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const cleaned = [];
  for (let p of paras) {
    // Markdown heading line ("## Analyst's Take") — drop entirely.
    if (/^#{1,6}\s/.test(p)) continue;
    // "Here is the analyst's take:" / "Analyst's Take:" preamble on its own line.
    if (/^(here\s+(is|are)\b|analyst.{0,3}s take\s*[:—-])/i.test(p) && p.length < 90) continue;
    // Sign-off line.
    if (/^(best regards|regards|thanks|—\s*scott)\b/i.test(p) && p.length < 40) continue;
    // Bullet markers → prose (the profile says he writes prose, <3% lists).
    p = p.replace(/^[\s]*[-*•]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, '');
    // Strip stray bold/italic markers; the column contract is plain text.
    p = p.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\W)\*(\S[^*]*?)\*(\W|$)/g, '$1$2$3');
    p = p.replace(/[ \t]+\n/g, '\n').trim();
    if (p) cleaned.push(p);
    if (cleaned.length >= CAPS.paragraphs) break;
  }
  return cleaned.join('\n\n').slice(0, CAPS.take_chars).trim();
}

// Any digit run, a $ amount, a percentage, or a bps figure. DELIBERATELY stricter
// than draft-assist-core's NUM_TOKEN, which requires 3+ digits for a bare number
// (`\d[\d,]{2,}`) — that is right for prose about prices and wrong here, where the
// dangerous fabrications are small counts: "you have 5 overdue actions" when the
// signal block says 3 reads perfectly and is a lie.
const ANALYST_NUM = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[mMbBkK]|million|billion)?|\b\d[\d,]*(?:\.\d+)?\s*(?:%|bps|bp)\b|\b\d[\d,]*(?:\.\d+)?\b/g;
const ANALYST_DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/gi;
const ANALYST_NAME = /\b([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|[A-Z]&|LLC|LP|Inc\.?|Co\.?|Corp\.?|Group|Partners|Capital|Realty|Properties)){1,4})\b/g;

// Capitalised runs that are ordinary English in a brief, not a party name.
const NAME_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'on', 'in', 'of', 'for', 'with', 'at', 'by',
  'your', 'our', 'my', 'we', 'you', 'us', 'me', 'i', 'it', 'this', 'that',
  'today', 'tomorrow', 'yesterday', 'this', 'week', 'month', 'quarter', 'morning',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'analyst', 'take', 'work', 'queue', 'pipeline', 'book', 'market', 'health',
  'net', 'lease', 'no', 'not', 'file', 'open', 'due', 'overdue', 'nothing', 'one',
]);

function normForMatch(s) {
  return String(s || '').toLowerCase().replace(/[\s,$]/g, '');
}

function isBoilerplateNameRun(run) {
  const words = String(run || '')
    .split(/[\s-]+/)
    .map((w) => w.replace(/[^A-Za-z&]/g, '').toLowerCase())
    .filter(Boolean);
  if (!words.length) return true;
  return words.every((w) => NAME_STOPWORDS.has(w));
}

/**
 * Re-read the generated take against the signal block.
 *
 * Numbers and dates are the cardinal-sin class: an ungrounded one makes the take
 * REJECTABLE (`ok:false`). Deliberately NOT the draft-assist behaviour of replacing
 * the token with "[Not on file]" — a brief riddled with "[Not on file]" is worse
 * than an empty section, and the email already degrades to empty gracefully.
 *
 * Proper names are REPORTED but never fatal: the name regex over-fires on ordinary
 * capitalised prose, and killing a whole take on a false positive would be the
 * P158a mistake (the obvious guard being the destructive one).
 *
 * @param {string} take
 * @param {{ signalBlock?:string, extra?:string }} allowed
 * @returns {{ ok:boolean, flagged:Array<{type:string,token:string}>, ungrounded_numbers:string[], ungrounded_names:string[] }}
 */
export function validateAnalystTake(take, { signalBlock = '', extra = '' } = {}) {
  const allowedNorm = normForMatch([signalBlock, extra].filter(Boolean).join(' \n '));
  const grounded = (tok) => allowedNorm.includes(normForMatch(tok));
  const text = String(take || '');

  const flagged = [];
  const seenNum = new Set();

  for (const re of [ANALYST_NUM, ANALYST_DATE]) {
    re.lastIndex = 0;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(text)) !== null) {
      const tok = m[0].trim();
      if (!tok || seenNum.has(tok) || grounded(tok)) continue;
      seenNum.add(tok);
      flagged.push({ type: re === ANALYST_DATE ? 'date' : 'number', token: tok });
    }
  }

  const seenName = new Set();
  ANALYST_NAME.lastIndex = 0;
  let nm;
  // eslint-disable-next-line no-cond-assign
  while ((nm = ANALYST_NAME.exec(text)) !== null) {
    const tok = nm[1];
    if (seenName.has(tok) || grounded(tok) || isBoilerplateNameRun(tok)) continue;
    seenName.add(tok);
    flagged.push({ type: 'proper_name', token: tok });
  }
  ANALYST_NAME.lastIndex = 0;

  const ungrounded_numbers = flagged.filter((f) => f.type !== 'proper_name').map((f) => f.token);
  const ungrounded_names = flagged.filter((f) => f.type === 'proper_name').map((f) => f.token);

  return {
    ok: ungrounded_numbers.length === 0 && String(take || '').trim().length > 0,
    flagged,
    ungrounded_numbers,
    ungrounded_names,
  };
}
