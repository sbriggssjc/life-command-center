// Prompt 131 — ownership-history chain DRAFTER (research-from-scratch → confirm-a-draft).
//
// Pure, dependency-free brain for the drafter that turns the never-consumed
// `establish_ownership_history` research lane (545 open / 0 lifetime completions,
// re-measured live 2026-08-26) into a confirm-a-draft surface.
//
// ⚠️ PREMISE CORRECTION, MEASURED — THE LOCAL MODEL IS NOT THE LEVER HERE.
// P131 was drafted as "run the local model over the on-box evidence to draft the
// grantor→grantee chain, each link cited to a verbatim deed quote." Three live
// measurements refute that framing, and the correction is the whole design:
//   1. THE DEED TEXT DOES NOT EXIST. gov.deed_records holds 5,804 rows with
//      ZERO `legal_description` characters; only 876 carry a grantor and 810 a
//      recording_date. Of the 92 properties this lane cannot answer structurally,
//      exactly ONE has a named+dated deed. There is no prose to quote verbatim,
//      so a "verbatim deed quote" is unobtainable, not merely hard.
//   2. AN LLM PROPOSER FOR THIS EXACT GAP IS ALREADY BUILT AND ALREADY ON.
//      W8 U3 (Prompt 69, link-propagation-planner.js, flag W8_U3_LINK_PROPAGATION
//      = on) proposes prior-owner links over the same `no_prior_owners_recorded`
//      gap. Live: 32 cards shipped, 27 decided by a human — and **35 proposals
//      dropped `quote_not_verbatim`**, i.e. the model hallucinated its citation
//      more often than it produced a usable one (~52%). It went quiet 2026-08-14.
//      Building a second LLM drafter would duplicate a live producer and inherit
//      that precision floor.
//   3. THE ANSWER IS ALREADY ON-BOX, STRUCTURED, AND UNREAD. 544 of the 545
//      queued properties have rows in gov.ownership_history, and **453 yield a
//      clean, dated, guard-passing prior→new chain (707 links)** via the P138
//      view `v_ownership_transitions_portfolio`. LCC never reads it: the LCC-side
//      gap is literally `owner_links <= 1` in lcc_entity_portfolio_facts, and the
//      P138–P141 feeder only ever fed `is_latest_for_property` (the CURRENT owner),
//      so the HISTORY was never populated.
// So Layer 1 is deterministic and carries the volume; the LLM is confined to
// Layer 2, where it may only LABEL a link it cannot alter (below).
//
// DOCTRINE (Consumption-Layer + never-fabricate + P106 two-layer assist):
//   * The draft ANNOTATES. It never writes a portfolio fact, never merges, never
//     closes the research task. A HUMAN confirms via the capture path P179 already
//     shipped (the card's "Open ownership →" button → property panel Ownership tab).
//   * A link the evidence does not state stays ABSENT — rendered "Not on file".
//     A discontinuous chain is reported as discontinuous, never bridged by a guess.
//   * Honest counts: `drafted` and `insufficient_evidence` are separate numbers
//     with a per-reason breakdown. A row we cannot draft is never emitted as an
//     empty draft (that is the P181 "unanswerable buries the answerable" failure).
//
// The live query/write side is api/_handlers/ownership-chain-draft-tick.js; every
// function here is unit-testable in isolation.

export const OCD_SOURCE = 'ownership_chain_draft';
// Fits the store's proposal_kind CHECK; a chain draft reconciles a gap from
// records held outside LCC, which is exactly this kind's meaning.
export const OCD_KIND = 'unstructured_reconciliation';
export const OCD_DECISION_TYPE = 'establish_ownership_history';

// Verdicts allowed by the lcc_clean_assist_proposals verdict CHECK. `link` = we
// have a chain to propose; `research` = we do not (honest, and it still carries a
// reason so the operator knows WHY rather than seeing a blank card).
export const OCD_VERDICT_LINK = 'link';
export const OCD_VERDICT_RESEARCH = 'research';

export function normDomain(domain) {
  const d = String(domain || '').toLowerCase();
  return d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
}

// One draft per (domain, property). Mirrors the lane's one-card-per-property shape.
export function ocdSubjectRef(domain, propertyId) {
  return `chaindraft:${normDomain(domain)}:${propertyId}`;
}

// ---------------------------------------------------------------------------
// Name comparison for CHAIN CONTINUITY only.
//
// ⚠️ This is deliberately the STRICT form. CLAUDE.md is explicit that
// `lcc_normalize_entity_name` / `dup-pair-planner.ownerCore` strip semantic
// tokens (holdings|properties|partners|capital|group|company|trust) and are
// BANNED for identity: "Century Park Partners" == "Century Park Properties LLC"
// under the loose normalizer. Here we are asking "did the party that RECEIVED the
// building in 1998 also CONVEY it in 2004?" — an identity question — so we strip
// case and punctuation ONLY, never a meaning-bearing word.
//
// lower() BEFORE the character-class strip (the SQL footgun that produced a
// 32.6%-vs-0.8% error): in JS, toLowerCase() first, then /[^a-z0-9]/g.
// ---------------------------------------------------------------------------
export function chainNameKey(name) {
  return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanText(s, max = 240) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function toIsoDate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Guard gate — mirrors the P138 FEED rule exactly, re-applied on OUR side.
//
// The gov view already computes these flags, but we re-check rather than trust a
// remote boolean: a view definition can drift (this repo has the receipts), and a
// guard that silently stops being applied is indistinguishable from one that
// passes. Each guard here exists because it caught something live in P138:
//   * is_self_transition   — A→A, an artifact, not a transfer.
//   * is_oscillating_pair  — gsa_lease_diff flickers between an SPE and its
//                            parent; the DATE is real, the DIRECTION is not.
//   * is_name_variant      — a strict prefix extension of the same name.
//   * *_is_clean           — junk/brokerage-polluted party names.
//   * transfer_date        — an undated link cannot be ordered, and an ordered
//                            chain is the entire deliverable.
// Returns null when the link passes, else the reason string it failed on.
// ---------------------------------------------------------------------------
export function guardTransition(t) {
  const row = t && typeof t === 'object' ? t : {};
  if (!toIsoDate(row.transfer_date)) return 'undated';
  const prior = cleanText(row.prior_owner_cleaned || row.prior_owner);
  const next = cleanText(row.new_owner_cleaned || row.new_owner);
  if (!prior || !next) return 'party_missing';
  if (row.prior_owner_is_clean === false) return 'prior_owner_unclean';
  if (row.new_owner_is_clean === false) return 'new_owner_unclean';
  if (row.is_self_transition === true) return 'self_transition';
  if (row.is_oscillating_pair === true) return 'oscillating_pair';
  if (row.is_name_variant === true) return 'name_variant';
  if (chainNameKey(prior) === chainNameKey(next)) return 'self_transition';
  return null;
}

// ---------------------------------------------------------------------------
// LAYER 1 (NO LLM) — assemble the chain.
//
// Input: the gov transitions for ONE property. Output: an ordered, deduped,
// continuity-annotated chain plus an honest verdict. This carries 453 of the 545
// queued rows; the model is never called for them.
// ---------------------------------------------------------------------------
export function buildChainDraft(transitions, ctx = {}) {
  const raw = Array.isArray(transitions) ? transitions : [];
  const kept = [];
  const rejected = [];

  for (const t of raw) {
    const why = guardTransition(t);
    if (why) {
      rejected.push({
        prior: cleanText(t && (t.prior_owner_cleaned || t.prior_owner)) || null,
        next: cleanText(t && (t.new_owner_cleaned || t.new_owner)) || null,
        date: toIsoDate(t && t.transfer_date),
        reason: why,
      });
      continue;
    }
    kept.push({
      from: cleanText(t.prior_owner_cleaned || t.prior_owner),
      to: cleanText(t.new_owner_cleaned || t.new_owner),
      date: toIsoDate(t.transfer_date),
      price: toNumberOrNull(t.transfer_price != null ? t.transfer_price : t.sale_price),
      // Provenance of the LINK ITSELF — this is the citation. It is a RECORD
      // reference (gov.ownership_history row + its data_source), not a model
      // quote, so it cannot be hallucinated and needs no verbatim gate.
      citation: {
        record: 'gov.ownership_history',
        ownership_id: t.ownership_id != null ? String(t.ownership_id) : null,
        data_source: cleanText(t.data_source) || null,
        change_type: cleanText(t.change_type) || null,
        brokerage_suffix_stripped: t.new_owner_had_brokerage_suffix === true,
      },
    });
  }

  // Dedup identical links (same parties, same date). gsa_lease_diff emits repeats
  // — P138 measured six identical rows on one date for property 180.
  const seen = new Set();
  const links = [];
  for (const l of kept) {
    const k = `${chainNameKey(l.from)}|${chainNameKey(l.to)}|${l.date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    links.push(l);
  }
  links.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (!links.length) {
    const reason = !raw.length
      ? 'no_transitions_on_file'
      : rejected.every((r) => r.reason === 'undated')
        ? 'no_dated_transition'
        : 'all_transitions_guarded';
    return {
      draftable: false,
      verdict: OCD_VERDICT_RESEARCH,
      confidence: 0,
      reason: insufficientReasonText(reason, rejected),
      insufficient_reason: reason,
      links: [],
      rejected,
      continuity: null,
      terminates_at_current_owner: null,
    };
  }

  // Continuity: does each link hand off to the next? A break is REPORTED, never
  // bridged — an unrecorded intermediate owner is exactly the thing we must not
  // invent. `gap_before` marks a link whose `from` is not the previous `to`.
  let breaks = 0;
  for (let i = 1; i < links.length; i += 1) {
    const contiguous = chainNameKey(links[i].from) === chainNameKey(links[i - 1].to);
    links[i].gap_before = !contiguous;
    if (!contiguous) breaks += 1;
  }
  if (links.length) links[0].gap_before = false;

  const currentOwner = cleanText(ctx.current_owner_name);
  const last = links[links.length - 1];
  const terminates = currentOwner
    ? chainNameKey(last.to) === chainNameKey(currentOwner)
    : null;

  return {
    draftable: true,
    verdict: OCD_VERDICT_LINK,
    confidence: chainConfidence(links, breaks, terminates),
    reason: chainReasonText(links, breaks, terminates, currentOwner),
    insufficient_reason: null,
    links,
    rejected,
    continuity: { breaks, contiguous: breaks === 0 },
    terminates_at_current_owner: terminates,
  };
}

// Confidence is about how much of the CHAIN we can vouch for, not how sure we are
// that a name is real (the guards already settled that). A contiguous chain that
// lands on the owner LCC currently believes holds the asset is the strong case;
// each break and a non-terminating tail costs.
export function chainConfidence(links, breaks, terminates) {
  // Base is 0.55 so a flawless chain tops out at 0.95, never 1.0 — the records
  // themselves can be wrong (P138 measured the owner id disagreeing with the
  // owner name on 8.1% of transitions), so certainty is not ours to claim.
  let c = 0.55;
  if (links.length >= 2) c += 0.1;
  if (breaks === 0) c += 0.15;
  if (terminates === true) c += 0.15;
  else if (terminates === false) c -= 0.1;
  return Math.max(0, Math.min(1, Number(c.toFixed(2))));
}

function chainReasonText(links, breaks, terminates, currentOwner) {
  const parts = [];
  const span = links.length === 1
    ? links[0].date
    : `${links[0].date} → ${links[links.length - 1].date}`;
  parts.push(`${links.length} recorded transfer${links.length === 1 ? '' : 's'} on file (${span}).`);
  // A single link is trivially "contiguous"; saying so implies we checked a chain
  // we do not have. Only claim contiguity where there was a hand-off to verify.
  if (breaks === 0 && links.length > 1) parts.push('Chain is contiguous.');
  else parts.push(`${breaks} unrecorded gap${breaks === 1 ? '' : 's'} in the chain — intermediate owner not on file.`);
  if (terminates === true) parts.push(`Ends at the current owner (${currentOwner}).`);
  else if (terminates === false) parts.push(`Last recorded grantee does not match the current owner on file (${currentOwner}) — confirm which is right.`);
  return cleanText(parts.join(' '), 400);
}

function insufficientReasonText(reason, rejected) {
  const counts = {};
  for (const r of rejected) counts[r.reason] = (counts[r.reason] || 0) + 1;
  const detail = Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(', ');
  const base = {
    no_transitions_on_file: 'No recorded ownership transfers on file for this property in the government records.',
    no_dated_transition: 'Transfers exist but none carries a transfer date, so no chain can be ordered.',
    all_transitions_guarded: 'Every recorded transfer failed a data-quality guard.',
  }[reason] || 'Insufficient evidence to draft a chain.';
  return cleanText(detail ? `${base} (${detail})` : base, 400);
}

// ---------------------------------------------------------------------------
// The human-readable draft the card renders. Deliberately plain text: the
// operator is confirming a chain, not reading JSON.
// ---------------------------------------------------------------------------
export function renderChainDraftText(draft, ctx = {}) {
  if (!draft || !draft.draftable) {
    return `No chain could be drafted. ${draft ? draft.reason : ''}`.trim();
  }
  const lines = [];
  const addr = cleanText(ctx.address);
  if (addr) lines.push(`Ownership chain — ${addr}`);
  for (const l of draft.links) {
    if (l.gap_before) lines.push('   ⋮  (gap — intermediate owner Not on file)');
    const price = l.price ? ` — $${Math.round(l.price).toLocaleString('en-US')}` : '';
    lines.push(`  ${l.date}  ${l.from}  →  ${l.to}${price}`);
  }
  if (draft.terminates_at_current_owner === false && ctx.current_owner_name) {
    lines.push(`  (LCC currently shows ${cleanText(ctx.current_owner_name)} as owner — reconcile.)`);
  }
  lines.push(`Source: gov.ownership_history (${draft.links.length} record${draft.links.length === 1 ? '' : 's'}).`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LAYER 2 (LLM) — role LABELLING only, and only where it is earned.
//
// The model may NOT add, remove, reorder, re-date or re-name a link: Layer 1 owns
// the chain and the chain is already sourced. The single question left that a
// record cannot answer is what KIND of transfer a link was — a developer selling
// its build-to-suit, an SPE reshuffle inside one sponsor, a REIT acquisition, a
// portfolio/entity-level trade. That label changes how a broker reads the chain.
//
// Bounded three ways, because W8 U3 measured a ~52% hallucination rate on this
// surface: a CLOSED vocabulary, one label per EXISTING link index, and a validator
// that drops any label naming a party not already in the deterministic chain.
// Everything here is optional — the drafter ships and is useful with Layer 2 off.
// ---------------------------------------------------------------------------
export const OCD_ROLE_LABELS = new Set([
  'developer_sale', 'sponsor_internal_transfer', 'reit_acquisition',
  'portfolio_trade', 'arms_length_sale', 'foreclosure_or_distress', 'unknown',
]);

export function buildRoleLabelPrompt(draft, ctx = {}) {
  const rows = draft.links
    .map((l, i) => `${i}. ${l.date} | grantor: ${l.from} | grantee: ${l.to}${l.price ? ` | $${Math.round(l.price)}` : ''}`)
    .join('\n');
  return [
    'You are labelling the TYPE of each recorded commercial-real-estate ownership transfer.',
    'The transfers below are FACTS from a county/government record. Do NOT add, remove, merge,',
    're-date or rename any transfer. Do NOT invent parties. Label ONLY what is listed.',
    '',
    ctx.address ? `Property: ${cleanText(ctx.address)}` : '',
    'Transfers:',
    rows,
    '',
    `Allowed labels: ${[...OCD_ROLE_LABELS].join(', ')}.`,
    'Use "unknown" whenever the names and dates alone do not justify a more specific label.',
    'Prefer "unknown" over a guess.',
    '',
    'Return ONLY JSON: {"labels":[{"index":<number>,"label":"<one allowed label>",',
    '"why":"<max 120 chars, referring only to the names/dates shown>"}]}',
  ].filter(Boolean).join('\n');
}

export function parseRoleLabels(text) {
  if (!text) return null;
  const s = String(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(o && o.labels) ? o.labels : null;
  } catch (_e) { return null; }
}

// Drop-on-doubt validator. A label survives only if it points at a real link index
// and uses an allowed label; `why` is additionally required to name no party that
// is not already in that link (the U3 lesson, applied to the field that can drift).
export function applyRoleLabels(draft, labels) {
  const out = { applied: 0, dropped: 0, drop_reasons: {} };
  if (!draft || !draft.draftable || !Array.isArray(labels)) return out;
  const drop = (r) => { out.dropped += 1; out.drop_reasons[r] = (out.drop_reasons[r] || 0) + 1; };
  for (const item of labels) {
    const i = Number(item && item.index);
    if (!Number.isInteger(i) || i < 0 || i >= draft.links.length) { drop('bad_index'); continue; }
    const label = String((item && item.label) || '').toLowerCase().trim();
    if (!OCD_ROLE_LABELS.has(label)) { drop('label_not_allowed'); continue; }
    if (label === 'unknown') { drop('unknown_label'); continue; }
    const why = cleanText(item && item.why, 120);
    if (why && introducesUnknownParty(why, draft.links[i])) { drop('why_names_unknown_party'); continue; }
    draft.links[i].role_label = label;
    draft.links[i].role_why = why || null;
    draft.links[i].role_source = 'local_model';
    out.applied += 1;
  }
  return out;
}

// A conservative check that the model's rationale is talking about THIS link's
// parties. Any capitalised multi-word run in `why` that is not a substring of the
// link's own party names is treated as an introduced party ⇒ the label is dropped.
export function introducesUnknownParty(why, link) {
  const hay = `${chainNameKey(link.from)}${chainNameKey(link.to)}`;
  const runs = String(why).match(/\b[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*)+/g) || [];
  for (const run of runs) {
    const k = chainNameKey(run);
    if (k.length < 6) continue;
    if (!hay.includes(k)) return true;
  }
  return false;
}
