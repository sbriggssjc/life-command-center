// ============================================================================
// W9.5 (Prompt 97, 2026-08-12) — Propagation-integrity: the PURE link-coverage
// planner. The standing measure that "full propagation" stays true.
//
// DOCTRINE (non-negotiable):
//   * PURE COUNTS ONLY. No LLM anywhere in W9.5 — every number is a plain
//     aggregation the DB already holds. This module is IO-free (no DB reads, no
//     Date.now) so it is fully fixture-testable; the admin.js tick does the
//     cross-DB reads and injects timestamps.
//   * READ-ONLY. W9.5 writes NOTHING except its own monthly snapshot. It measures
//     the links the campaign works on; it never repairs one.
//   * The ALARM this unit exists for: a link whose coverage pct DROPS
//     month-over-month = propagation regressing. That, and only that, is a
//     high-severity Connectedness finding with a fix-unit stub naming the link.
//
// A "link" is one edge in the chain the Wave-9 campaign drives:
//   recorded_owner → true_owner → contact → reachable → SF, plus the cross-DB
//   mirror-consistency and correspondence-attribution edges. Each link is one
//   (link_name, domain, total, linked, pct) row; the tick UNIFIES the dia/gov
//   chain views + the LCC-Opps mirror view into one table.
// ============================================================================

export function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Coverage percent, one decimal. total<=0 ⇒ null (honest "not measured / n/a" —
// a link with no denominator is not 0% coverage, it is uncounted).
export function coveragePct(linked, total) {
  const t = num(total);
  if (t <= 0) return null;
  return Math.round((num(linked) / t) * 1000) / 10;
}

// A stable human-readable metric key for a link (used in the U4 section + delta
// lookups). e.g. "coverage · dia · true_to_contact".
export function linkMetric(domain, linkName) {
  return 'coverage · ' + domain + ' · ' + linkName;
}

// The report GROUPS. Ordered for stable rendering. `group` on each raw row must
// be one of these; an unknown group is tolerated (sorted last) but flagged.
export const COVERAGE_GROUPS = ['chain', 'mirror', 'correspondence', 'campaign'];

// Human-readable one-liners describing WHAT each named producer feeds a link —
// used to name the failing producer in a regression fix-unit. Unknown links get
// a generic honest stub (never a guessed root cause).
export const LINK_PRODUCER = {
  recorded_to_true: 'the ORE recorded→true resolver',
  true_to_contact: 'the contact-acquisition chain (W9.1 external + W9.2 internal harvest)',
  contact_to_reachable: 'the reachability harvest (W9.2 email/phone fill-blanks)',
  true_to_sf: 'the SF owner-linkage drain (W9.3 re-score)',
  contact_to_sf_contact_id: 'the SF donor-handoff (W9.3 account→contact expansion — W9.2\'s key)',
  owner_to_ops_mirror: 'the domain→ops entity mirror sync (external_identities true_owner writer)',
  domain_owner_identity_entity_bound: 'the external_identities entity-binding writer (ensureEntityLink)',
  external_identity_canonical_conformance: 'the canonical identity-scheme normalizer (canonicalDomainSourceType)',
  cross_domain_contacts_resolved: 'the cross-domain contact bridge',
  correspondence_to_entity: 'the W7 correspondence attribution',
  correspondence_entity_owner_llc: 'the correspondence→owner-LLC linkage (the prompt-96 follow-on gap)',
};

export function producerForLink(linkName) {
  return LINK_PRODUCER[linkName] || 'the writer that fills this link';
}

// ---------------------------------------------------------------------------
// Normalize one raw link input → a coverage row. `prevRow` is the same link from
// the prior snapshot (matched by link_name+domain), or null.
// raw: { link_name, domain, group?, total, linked, note?, measured? }
// ---------------------------------------------------------------------------
export function coverageRow(raw, prevRow = null) {
  const measured = raw.measured != null ? !!raw.measured : (num(raw.total) > 0);
  const pct = measured ? coveragePct(raw.linked, raw.total) : null;
  const prevPct = prevRow && prevRow.pct != null ? num(prevRow.pct) : null;
  let deltaPct = null;
  let direction = 'new';
  if (pct != null && prevPct != null) {
    deltaPct = Math.round((pct - prevPct) * 10) / 10;
    direction = deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
  } else if (pct != null && prevRow == null) {
    direction = 'new';
  }
  return {
    link_name: raw.link_name,
    domain: raw.domain,
    group: raw.group || 'chain',
    total: num(raw.total),
    linked: num(raw.linked),
    pct,
    prev_pct: prevPct,
    delta_pct: deltaPct,
    direction,
    measured,
    // A REGRESSION is the alarm: a measured link that fell vs the prior month.
    regressed: deltaPct != null && deltaPct < 0,
    note: raw.note || null,
  };
}

// ---------------------------------------------------------------------------
// Assemble the full unified coverage table. Pure; `now` injected.
// rawRows: flat array of raw link inputs (chain rows from the domain views +
// mirror/correspondence rows from the LCC view + tick-computed mirror rows).
// prevLinks: the prior snapshot's `links` array (or null) — matched by key.
// ---------------------------------------------------------------------------
export function assembleCoverage(rawRows, { period = null, now = null, prevLinks = null } = {}) {
  const prevBy = {};
  if (Array.isArray(prevLinks)) {
    for (const p of prevLinks) prevBy[p.domain + '::' + p.link_name] = p;
  }
  const links = (Array.isArray(rawRows) ? rawRows : []).map((r) =>
    coverageRow(r, prevBy[r.domain + '::' + r.link_name] || null));

  const measured = links.filter((l) => l.measured);
  const regressed = links.filter((l) => l.regressed);
  const byGroup = {};
  for (const l of links) byGroup[l.group] = (byGroup[l.group] || 0) + 1;

  // Weakest measured link (lowest pct) — the headline gap.
  let weakest = null;
  for (const l of measured) {
    if (weakest == null || l.pct < weakest.pct) weakest = l;
  }
  // Worst regression (most-negative delta).
  let worstRegression = null;
  for (const l of regressed) {
    if (worstRegression == null || l.delta_pct < worstRegression.delta_pct) worstRegression = l;
  }

  return {
    period: period || null,
    generated_at: now || null,
    links,
    totals: {
      links: links.length,
      measured: measured.length,
      unmeasured: links.length - measured.length,
      regressed: regressed.length,
      by_group: byGroup,
      weakest_link: weakest ? { link: weakest.link_name, domain: weakest.domain, pct: weakest.pct } : null,
      worst_regression: worstRegression
        ? { link: worstRegression.link_name, domain: worstRegression.domain, delta_pct: worstRegression.delta_pct }
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// U4 "Connectedness" section builder. Consumed by the systemic-findings
// aggregator. (coverage, prevSection) → section, matching the sibling builders'
// shape. Delta is derived from the PRIOR U4 SECTION's findings (metric match),
// exactly like the other U4 builders — so month-over-month is self-consistent
// with the U4 snapshot even though the coverage object also carries its own
// snapshot delta for the standalone tick.
//
// Severity heuristic (the alarm): a link whose pct DROPPED since last month →
// 'high' + a fix-unit stub naming the failing producer. A measured-but-low link
// is informational (that is the campaign's known work, not a regression). A
// never-measured link is 'info' with an honest note.
// ---------------------------------------------------------------------------
function prevSectionPct(prevSection, metric) {
  if (!prevSection || !Array.isArray(prevSection.findings)) return null;
  const m = prevSection.findings.find((f) => f.metric === metric);
  return m && m.value != null && m.value !== 'n/a' ? num(m.value) : null;
}

export function buildConnectednessSection(coverage, prevSection = null) {
  const cov = coverage && typeof coverage === 'object' ? coverage : { links: [], totals: {} };
  const links = Array.isArray(cov.links) ? cov.links : [];
  const findings = [];
  let anyRegression = false;

  for (const l of links) {
    const metric = linkMetric(l.domain, l.link_name);
    // Delta vs the prior U4 snapshot's connectedness section (siblings' pattern).
    const prev = prevSectionPct(prevSection, metric);
    let delta = null;
    let direction = l.measured ? 'new' : 'new';
    if (l.pct != null && prev != null) {
      delta = Math.round((l.pct - prev) * 10) / 10;
      direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    }
    const regressed = delta != null && delta < 0;
    if (regressed) anyRegression = true;
    findings.push({
      metric,
      value: l.pct != null ? l.pct : 'n/a',
      delta,
      prev,
      direction,
      // The DROP is the only high-severity signal; everything else is info.
      severity: regressed ? 'high' : 'info',
      fix_unit: regressed
        ? 'Propagation regression: ' + l.domain + ' `' + l.link_name + '` coverage fell '
          + prev + '% → ' + l.pct + '% (' + l.linked + '/' + l.total + '). Fix-unit: '
          + producerForLink(l.link_name) + ' stopped keeping pace — trace that writer and confirm it still runs '
          + 'and still fills this link. A dropping link means the chain is regressing, not just slow.'
        : null,
    });
  }

  const t = cov.totals || {};
  const weakest = t.weakest_link;
  const worst = t.worst_regression;
  const note = links.length === 0
    ? 'No link-coverage inputs available this period (all cross-DB sources unreachable) — coverage uncounted.'
    : (t.measured || 0) + ' of ' + links.length + ' links measured; '
      + (t.regressed || 0) + ' regressed month-over-month'
      + (worst ? ' (worst: ' + worst.domain + ' ' + worst.link + ' ' + worst.delta_pct + 'pp)' : '')
      + '. Weakest link: ' + (weakest ? weakest.domain + ' ' + weakest.link + ' ' + weakest.pct + '%' : 'n/a')
      + '. A DROP is the alarm; a low-but-stable link is the campaign\'s known work, not a regression.';

  return {
    key: 'connectedness',
    title: 'Cross-DB propagation integrity (W9.5 link coverage)',
    code_error: anyRegression, // a regression yields a ready-to-send fix-unit stub
    findings,
    note,
  };
}

// ---------------------------------------------------------------------------
// Standalone doc/markdown render for the link-coverage-tick (deterministic).
// ---------------------------------------------------------------------------
function fmtPct(l) {
  return l.pct != null ? l.pct + '%' : 'n/a';
}
function fmtDelta(l) {
  if (l.delta_pct == null) return '—';
  if (l.delta_pct === 0) return '±0';
  return (l.delta_pct > 0 ? '+' : '') + l.delta_pct + 'pp';
}

export function renderCoverageDoc(coverage, opts = {}) {
  const L = [];
  const cov = coverage || { links: [], totals: {} };
  L.push('# Link-coverage — ' + (cov.period || 'unknown'));
  L.push('');
  L.push('> W9.5 propagation-integrity: the standing cross-DB measure of "full propagation". '
    + 'Counts only (no LLM). A link whose coverage DROPS month-over-month is the alarm.');
  if (opts.generatedAt) { L.push(''); L.push('_Generated ' + opts.generatedAt + '._'); }
  L.push('');
  const t = cov.totals || {};
  L.push((t.measured || 0) + '/' + (t.links || 0) + ' links measured · ' + (t.regressed || 0) + ' regressed · '
    + 'weakest ' + (t.weakest_link ? t.weakest_link.domain + ' ' + t.weakest_link.link + ' ' + t.weakest_link.pct + '%' : 'n/a'));
  L.push('');
  for (const g of [...COVERAGE_GROUPS, '_other']) {
    const rows = (cov.links || []).filter((l) => (COVERAGE_GROUPS.includes(l.group) ? l.group : '_other') === g);
    if (!rows.length) continue;
    L.push('## ' + (g === '_other' ? 'other' : g));
    L.push('');
    L.push('| Link | Domain | Linked / Total | Coverage | Δ MoM |');
    L.push('| --- | --- | ---: | ---: | ---: |');
    for (const l of rows) {
      L.push('| ' + l.link_name + ' | ' + l.domain + ' | ' + l.linked + ' / ' + l.total + ' | '
        + fmtPct(l) + ' | ' + fmtDelta(l) + (l.regressed ? ' 🔴' : '') + ' |');
    }
    L.push('');
  }
  L.push('---');
  L.push('_Read-only measure. Reports into the U4 systemic-findings monthly report (Connectedness section)._');
  return L.join('\n');
}
