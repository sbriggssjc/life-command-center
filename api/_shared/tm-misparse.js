// Prompt 89 — TrafficMetrix misparse detector (pure, dependency-free).
//
// GROUNDING (live forensics, 2026-08-08): a sidebar/CoStar capture (2026-05-09)
// parsed a property page's TrafficMetrix traffic-count TABLE as a contact list —
// every street name / column label ("Collection Street", "Traffic Vol", "Last
// Measured", "Made with TrafficMetrix® Products") became a PERSON entity, and all
// ~16 got stamped with the ONE real email on the page (rehmer@ehmergroup.com —
// Richard Ehmer, a real broker; James Devincenti also real, same fan-out). The
// graph contamination persisted for ~2.5 months and fed garbage clusters to the
// U3 person_email LLM lane.
//
// This module is the SINGLE source of truth for the misparse class detector,
// reused by (1) the one-shot junk-lane seeder, (2) the sidebar contact-extraction
// guard, and (3) the U3 person_email pool exclusion. It NEVER writes data or
// decides truth — it flags CANDIDATES with a verbatim evidence quote; a human
// confirms in the junk lane (seeder), or a suspect is routed to review (sidebar).
//
// DOCTRINE: the detector fires on a street-suffix token or TrafficMetrix vocab.
// It deliberately does NOT fire on a clean personal "First Last" name that carries
// no such token ("Richard Ehmer", "James Devincenti") — those are the REAL cluster
// members and must survive. Names that DO carry a street/label token but happen to
// be a real person ("Ladonna Street") are still flagged, but only ever land in a
// HUMAN-GATED lane (seeder) or a recoverable review route (sidebar) — never an
// automatic destructive write — and the seeder value-gates on the email fan-out so
// a lone real person with a unique email is not swept in.

// A single page email attaching to MORE than this many parsed contacts is the
// structural signature of a table-as-contact-list misparse, not a real roster.
export const EMAIL_FANOUT_SUSPECT_THRESHOLD = 4;

export const TM_MISPARSE_HEURISTIC = 'tm_misparse';

// TrafficMetrix column labels / vocabulary that leaked in as "contact" names.
const TM_VOCAB_RE = /(Traffic\s*Vol|Last\s*Measured|Cross\s*Street|Collection\s*Street|Made\s*with\s*TrafficMetrix)/i;

// A street-suffix token at the END of the name (optionally followed by a
// directional N/S/E/W/NE/NW/SE/SW, and an optional trailing period). The base set
// mirrors the prompt (St|Ave|Blvd|Hwy|Pkwy|Aly|Walk|Dr|Ln|Rd) and adds the
// common variants seen live (Street/Avenue/Alley/Pl/Ct/Way/Ter/Cir/Sq/Loop/Trl)
// plus the trailing directional that real captures carry ("Halleck St N",
// "Jack Kerouac Aly SE", "Stevens Aly N").
const STREET_SUFFIX_RE = /\b(St|Str|Street|Ave|Aven|Avenue|Blvd|Boulevard|Hwy|Highway|Pkwy|Parkway|Aly|Alley|Walk|Dr|Drive|Ln|Lane|Rd|Road|Pl|Place|Ct|Court|Way|Ter|Terrace|Cir|Circle|Sq|Square|Loop|Trl|Trail)\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW))?\.?$/i;

// The misparse class detail, or null for a name that reads as a real contact.
// `evidence` is the VERBATIM name (doctrine: every proposal is evidence-grounded);
// `signal` records which arm fired; `match` is the offending token.
export function tmMisparseReason(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return null;
  const tm = s.match(TM_VOCAB_RE);
  if (tm) {
    return { heuristic: TM_MISPARSE_HEURISTIC, evidence: s.slice(0, 200), signal: 'tm_vocab', match: tm[0] };
  }
  const st = s.match(STREET_SUFFIX_RE);
  if (st) {
    return { heuristic: TM_MISPARSE_HEURISTIC, evidence: s.slice(0, 200), signal: 'street_suffix', match: st[0] };
  }
  return null;
}

export function isMisparseName(name) {
  return tmMisparseReason(name) !== null;
}

// Is a single email's fan-out count over the suspect threshold?
export function isEmailFanoutSuspect(count) {
  return Number(count) > EMAIL_FANOUT_SUSPECT_THRESHOLD;
}

// Sidebar guard planner (PURE). Given the parsed contacts array from a capture,
// split them into { mint, review }: a candidate whose NAME trips the misparse
// detector, OR whose email is part of a suspect one-email fan-out (> threshold
// parsed contacts sharing it), is routed to REVIEW (recoverable) rather than
// minted. Everything else mints normally. Never drops silently — a review item
// carries its reason so a real contact can be recovered.
export function planContactMinting(contacts, opts = {}) {
  const threshold = Number.isFinite(opts.fanoutThreshold) ? opts.fanoutThreshold : EMAIL_FANOUT_SUSPECT_THRESHOLD;
  const list = Array.isArray(contacts) ? contacts : [];
  const emailCounts = new Map();
  for (const c of list) {
    const em = c && c.email ? String(c.email).toLowerCase().trim() : '';
    if (em) emailCounts.set(em, (emailCounts.get(em) || 0) + 1);
  }
  const suspectEmails = new Set();
  for (const [em, n] of emailCounts) if (n > threshold) suspectEmails.add(em);

  const mint = [];
  const review = [];
  for (const c of list) {
    if (!c || !c.name) continue;
    const em = c.email ? String(c.email).toLowerCase().trim() : '';
    const misparse = tmMisparseReason(c.name);
    if (misparse) {
      review.push({ contact: c, reason: 'misparse_name', signal: misparse.signal, evidence: misparse.evidence, match: misparse.match });
      continue;
    }
    if (em && suspectEmails.has(em)) {
      review.push({ contact: c, reason: 'email_fanout', email: em, fanout: emailCounts.get(em) });
      continue;
    }
    mint.push(c);
  }
  return { mint, review, suspectEmails: [...suspectEmails], emailCounts: Object.fromEntries(emailCounts) };
}
