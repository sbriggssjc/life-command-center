// api/_shared/deed-signatory.js
// ============================================================================
// CONTACT-SELECTION Slice 4 — Phase A: deed / PSA signatory parse
// ----------------------------------------------------------------------------
// The signature ("execution") block of a recorded deed or a purchase-and-sale
// agreement names the HUMAN who signed for the grantee/seller LLC — the
// authority-1 SIGNATORY, the top of CONTACT_SELECTION_STANDARD and the highest-
// authority contact we can resolve for an otherwise-contactless owner.
//
// Unlike Phase B (SOS) and Phase C (reverse-address), this needs NO external
// site — it parses a document the firm ALREADY OWNS (a dia property_documents
// deed/dd/master row). The PARSE (`parseDeedSignatory`) is pure text→signer and
// fully deterministic / unit-tested. The only deferred (network-gated) piece is
// FETCHING the doc text: the dia deed docs carry no stored `raw_text` and live
// behind a CoStar CDN (deed) / SharePoint PA flow (PSA/master), so the byte
// fetch is a deps-injected, feature-flagged hook (`OWNER_ENRICH_DEED_URL`) that
// no-ops cleanly in environments without egress (the find_contacts_by_account /
// Slice-3 rollout pattern). Production wires the fetch + runs the live drain.
//
// Reuses the shared person-plausibility guards (looksLikePersonName /
// isImplausiblePersonName) so a parsed "signer" can never be an LLC, a deal
// string, or junk — and a non-confident block yields NO signer (never a guess).
// ============================================================================

import { looksLikePersonName, isImplausiblePersonName } from './entity-link.js';

// Controlling / authorized signing roles, in descending authority. A signer
// carrying one of these is a real decision-maker for the entity; the first
// match (by this order) wins when a block names several. Normalized form ->
// the canonical `contact_role` we attach with.
const SIGNER_ROLE_RANK = [
  { re: /\b(?:managing\s+member|sole\s+member|manager(?:ing)?\s+member)\b/i, role: 'managing_member' },
  { re: /\b(?:general\s+partner|managing\s+partner|gp)\b/i, role: 'general_partner' },
  { re: /\bmanager\b/i, role: 'manager' },
  { re: /\b(?:president|ceo|chief\s+executive|principal|owner)\b/i, role: 'principal' },
  { re: /\b(?:vice\s+president|vp|chief\s+\w+\s+officer|cfo|coo|secretary|treasurer)\b/i, role: 'officer' },
  { re: /\b(?:trustee|co-?trustee)\b/i, role: 'trustee' },
  { re: /\b(?:authorized\s+(?:signatory|representative|agent|person|officer)|its\s+authorized)\b/i, role: 'authorized_signatory' },
  { re: /\bmember\b/i, role: 'member' },
];

function roleFromTitle(title) {
  if (!title) return null;
  for (const { re, role } of SIGNER_ROLE_RANK) if (re.test(title)) return role;
  return null;
}

// A "/s/ John A. Smith" or "By: John A. Smith" signature line → the name after
// the marker. Strips a leading "/s/" e-signature token and any trailing comma +
// title fragment ("By: John Smith, Manager").
function nameFromSignatureLine(line) {
  let m = line.match(/^\s*(?:by\s*:?\s*)?(?:\/s\/\s*)?(.+)$/i);
  if (!m) return null;
  let n = m[1].trim();
  // Drop a trailing ", Its Manager" / ", Manager" title clause on the same line.
  n = n.replace(/,\s*(?:its\s+)?[A-Za-z][\w .&/-]*$/i, '').trim();
  return n || null;
}

const NAME_LABEL_RE = /^\s*(?:print(?:ed)?\s+name|name)\s*:?\s*(.+)$/i;
const TITLE_LABEL_RE = /^\s*(?:title|its|as)\s*:?\s*(.+)$/i;
const SIG_MARKER_RE = /^\s*(?:by\s*:|\/s\/)/i;

/**
 * Parse the execution / signature block of a deed or PSA → the human signer.
 *
 * Conservative by construction: a signer is returned ONLY when the text shows a
 * real execution signal (a `By:` / `/s/` signature line, or a `Name:`+`Title:`
 * pair) AND the candidate clears `looksLikePersonName` (so it is never an LLC,
 * a deal/attribution string, or junk). A grantor/grantee ENTITY line is never
 * returned as a person. No confident signer ⇒ `{ ok:false }` (never a guess).
 *
 * Highest-authority signer wins (managing_member > general_partner > manager >
 * principal > officer > trustee > authorized_signatory > member); a bare signer
 * with no title is accepted at lower confidence only when a signature marker is
 * present.
 *
 * @param {string} text  decoded deed/PSA text (full doc or just the block)
 * @returns {{ok:true, person_name:string, role:string, authority:1, confidence:'high'|'medium'}
 *          | {ok:false, reason:string}}
 */
export function parseDeedSignatory(text) {
  if (typeof text !== 'string' || text.trim().length < 20) return { ok: false, reason: 'no_text' };
  const lines = text.replace(/\r/g, '').split('\n');
  const candidates = []; // { name, role, confidence }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // (1) Explicit "Name:" label — the strongest, usually paired with a nearby
    // "Title:" within a few lines.
    const nm = line.match(NAME_LABEL_RE);
    if (nm) {
      const name = nm[1].trim().replace(/,\s*$/, '');
      let role = null;
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 3); j++) {
        const tm = lines[j].match(TITLE_LABEL_RE);
        if (tm) { role = roleFromTitle(tm[1]); if (role) break; }
      }
      pushCandidate(candidates, name, role, role ? 'high' : 'medium');
      continue;
    }

    // (2) Signature line ("By: <name>" / "/s/ <name>"). The title may be on the
    // same line, the next line, or a "Title:/Its:" label within 3 lines.
    if (SIG_MARKER_RE.test(line)) {
      const name = nameFromSignatureLine(line);
      if (!name) continue;
      let role = null;
      // same-line trailing title ("By: John Smith, its Manager")
      const trail = line.match(/,\s*(?:its\s+)?([A-Za-z][\w .&/-]*)$/i);
      if (trail) role = roleFromTitle(trail[1]);
      if (!role) {
        for (let j = i; j <= Math.min(lines.length - 1, i + 3); j++) {
          const tm = lines[j].match(TITLE_LABEL_RE);
          if (tm) { role = roleFromTitle(tm[1]); if (role) break; }
          // a bare title word on its own line ("Manager")
          if (j > i && !role) { const r = roleFromTitle(lines[j]); if (r) { role = r; break; } }
        }
      }
      pushCandidate(candidates, name, role, role ? 'high' : 'medium');
    }
  }

  if (!candidates.length) return { ok: false, reason: 'no_signature_block' };

  // Rank: confidence (high>medium) → role authority → first seen.
  candidates.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return roleAuthority(a.role) - roleAuthority(b.role);
  });
  const best = candidates[0];
  return { ok: true, person_name: best.name, role: best.role || 'signatory', authority: 1, confidence: best.confidence };
}

function roleAuthority(role) {
  const idx = SIGNER_ROLE_RANK.findIndex((r) => r.role === role);
  return idx === -1 ? 99 : idx;
}

// Add a candidate iff it is a plausible human name (never an LLC / deal string /
// junk). Dedupes by normalized name, keeping the higher-confidence/role entry.
function pushCandidate(arr, rawName, role, confidence) {
  const name = String(rawName || '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').trim();
  if (!name) return;
  if (!looksLikePersonName(name) || isImplausiblePersonName(name)) return;
  const key = name.toLowerCase();
  const existing = arr.find((c) => c.name.toLowerCase() === key);
  if (existing) {
    if (!existing.role && role) { existing.role = role; existing.confidence = confidence; }
    return;
  }
  arr.push({ name, role, confidence });
}

// ---------------------------------------------------------------------------
// Worker adapter (feature-flagged; byte fetch deferred / post-deploy)
// ---------------------------------------------------------------------------
// Returns the `deedParse(row)` the owner-contact-enrich worker calls. The byte
// fetch (deed CDN / SharePoint PSA) is injected via deps.fetchDocText so this
// no-ops cleanly without egress; the pure parser above is the tested core.
//
//   deps.fetchDocText(row) -> { ok, text } | null    (production; deferred)
//
// Without OWNER_ENRICH_DEED_URL configured AND a fetchDocText dep, the adapter
// returns `{ ok:false, reason:'unconfigured' }` — identical to the Slice-3
// no-op, so sandbox / unconfigured behavior is unchanged.

export function isDeedAdapterConfigured() {
  return !!process.env.OWNER_ENRICH_DEED_URL;
}

export function buildDeedParseAdapter(deps = {}) {
  const fetchDocText = deps.fetchDocText;
  return async function deedParse(row) {
    if (!isDeedAdapterConfigured() || typeof fetchDocText !== 'function') {
      return { ok: false, reason: 'unconfigured' };
    }
    let fetched;
    try { fetched = await fetchDocText(row); } catch (e) { return { ok: false, reason: 'fetch_error', detail: String(e && e.message || e) }; }
    if (!fetched || !fetched.ok || !fetched.text) return { ok: false, reason: 'no_doc' };
    const parsed = parseDeedSignatory(fetched.text);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    return { ok: true, person_name: parsed.person_name, role: parsed.role, authority: parsed.authority, confidence: parsed.confidence, source_doc: fetched.source_url || null };
  };
}
