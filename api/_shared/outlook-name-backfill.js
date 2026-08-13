// ============================================================================
// Outlook display-name BACKFILL — reconstruct metadata.from_name / to_names on
// historical activity_events rows (Prompt 101, W9.4 accelerator).
// ----------------------------------------------------------------------------
// Prompt 96 made display-name capture FORWARD-ONLY, so the 7,751 historical
// correspondence rows carry bare emails and the comms-harvest header-pair arm
// (harvestBuildCommsIndex) sees 0 name↔email pairs — accrual is weeks-slow.
//
// ⚠️ GROUNDING CORRECTION (live 2026-08-13): the Prompt-96 root-cause doc claimed
// "email_bodies.from_name was already stored" — that is REFUTED. `email_bodies`
// carries the `from_name` COLUMN but it is NULL in all 23,071 rows, and no
// structured historical display name exists anywhere in the corpus. The one
// REAL structured name↔email store is `unified_contacts` (full_name + email).
// This backfill therefore reconstructs the display name for each row from the
// EMAILS ALREADY ON THE ROW (metadata.from_email / from / to_emails) by looking
// them up in unified_contacts — the Prompt-93 reconstruction pattern. It is NOT
// sourced from email_bodies.
//
// One code path: the display name is fed through the SAME `parseAddress` the
// forward loggers use (`outlook-recipients.js`), so a backfilled row is shaped
// exactly like an at-ingest one. Fill-blanks only, provenance-marked, reversible.
// ============================================================================

import { parseAddress } from './outlook-recipients.js';
import { isInternalEmail, isGenericInbox, looksLikeEmail } from './reachability-harvest-planner.js';

function lower(s) { return s == null ? null : String(s).trim().toLowerCase() || null; }
function blank(v) { return v == null || String(v).trim() === ''; }

// Resolve the row's SENDER email from the shapes the loggers write:
//   * metadata.from_email — bare address (the 'outlook' bridge path)
//   * metadata.from       — a bare address OR a 'Name <email>' string (intake path)
// Returned lowercased; null when no real address is present.
export function senderEmailFromMetadata(md) {
  const m = md && typeof md === 'object' ? md : {};
  const direct = lower(m.from_email);
  if (direct && looksLikeEmail(direct)) return direct;
  if (typeof m.from === 'string' && m.from.trim()) {
    const { email } = parseAddress(m.from);
    if (email && looksLikeEmail(email)) return email;
  }
  return null;
}

// The list of RECIPIENT emails already on the row (metadata.to_emails / cc_emails
// string arrays). Lowercased, deduped, real-address-only.
export function recipientEmailsFromMetadata(md) {
  const m = md && typeof md === 'object' ? md : {};
  const out = [];
  const seen = new Set();
  for (const key of ['to_emails', 'cc_emails']) {
    const arr = Array.isArray(m[key]) ? m[key] : [];
    for (const v of arr) {
      const e = lower(typeof v === 'string' ? v : (v && (v.email || v.address)));
      if (!e || !looksLikeEmail(e) || seen.has(e)) continue;
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

// Is this email a harvestable EXTERNAL party (not our mailbox, not a generic
// inbox)? Internal/generic senders carry no BD-useful name↔email binding and the
// harvest drops them anyway, so we never spend a fill on them.
export function isHarvestableParty(email) {
  const e = lower(email);
  return !!e && looksLikeEmail(e) && !isInternalEmail(e) && !isGenericInbox(e);
}

/**
 * Build a fill-blanks metadata patch for ONE activity_events row.
 *
 * @param {object} metadata     the row's existing metadata jsonb (never mutated)
 * @param {Map<string,string>|function} nameByEmail  lowercased-email -> display
 *        name (from unified_contacts). A function form (email)=>name is also
 *        accepted so callers can back it with any store.
 * @param {object} opts { batch, at } provenance stamp.
 * @returns {object|null} { metadata: <new full metadata>, filled_from_name,
 *          filled_to_names } — or null when there is nothing to fill (so the
 *          caller skips the write entirely: idempotent + fill-blanks).
 *
 * Discipline:
 *  - NEVER overwrites an existing from_name / to_names (fill-blanks).
 *  - Only EXTERNAL, non-generic parties (isHarvestableParty) are named.
 *  - The display name is round-tripped through parseAddress (one code path with
 *    the forward loggers) so the stored shape is identical.
 *  - A provenance marker `name_backfill` distinguishes it from at-ingest capture.
 */
export function buildNameBackfillPatch(metadata, nameByEmail, opts = {}) {
  const md = metadata && typeof metadata === 'object' ? metadata : {};
  const lookup = typeof nameByEmail === 'function'
    ? nameByEmail
    : (e) => (nameByEmail && typeof nameByEmail.get === 'function' ? nameByEmail.get(e) : null);
  const nameFor = (email) => {
    const e = lower(email);
    if (!e) return null;
    const raw = lookup(e);
    if (blank(raw)) return null;
    // Round-trip through the shared parser so a value like 'Doe, John <x>' or a
    // stray address collapses to a clean display name (never an email token).
    const { name } = parseAddress(`${String(raw).trim()} <${e}>`);
    return name && !looksLikeEmail(name) ? name : null;
  };

  let filledFrom = false;
  let filledTo = 0;
  const next = { ...md };

  // ---- from_name (fill-blanks) ----
  if (blank(md.from_name)) {
    const fe = senderEmailFromMetadata(md);
    if (fe && isHarvestableParty(fe)) {
      const nm = nameFor(fe);
      if (nm) { next.from_name = nm; filledFrom = true; }
    }
  }

  // ---- to_names[] (only when ABSENT — never partially clobber a real capture) ----
  if (md.to_names == null) {
    const pairs = [];
    const seen = new Set();
    for (const e of recipientEmailsFromMetadata(md)) {
      if (!isHarvestableParty(e) || seen.has(e)) continue;
      const nm = nameFor(e);
      if (nm) { pairs.push({ name: nm, email: e }); seen.add(e); }
    }
    if (pairs.length) { next.to_names = pairs; filledTo = pairs.length; }
  }

  if (!filledFrom && !filledTo) return null;

  next.name_backfill = {
    source: 'unified_contacts',
    batch: opts.batch || null,
    at: opts.at || null,
    from: filledFrom,
    to: filledTo,
  };
  return { metadata: next, filled_from_name: filledFrom, filled_to_names: filledTo };
}

// Strip a backfill from ONE row's metadata (reversal). Removes the marker and any
// fields THIS batch filled (per the marker), leaving at-ingest fields intact.
export function reverseNameBackfillPatch(metadata, batch) {
  const md = metadata && typeof metadata === 'object' ? metadata : {};
  const mark = md.name_backfill;
  if (!mark || (batch && String(mark.batch) !== String(batch))) return null;
  const next = { ...md };
  if (mark.from) delete next.from_name;
  if (mark.to) delete next.to_names;
  delete next.name_backfill;
  return { metadata: next };
}
