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

// Prompt 95 — three new arms for sentence-fragment / doc-label / bare-title
// "names" (Scott's U3 lane review, 2026-08-11). Same disease as the TrafficMetrix
// misparse (a table/field/sentence minted as a PERSON), different vocabulary.
// Live examples that must flag: "The deed was unavailable at the time of
// publication", "Income & Expenses", "Expenses", "Buyer information not
// available", "Sale Notes", "Senior Managing Director Investments" (bare title),
// "Associate Director Investments". Real people ("Jane G. Polen", "Richard
// Ehmer") must NOT flag — the never-flag-clean-"First Last" guarantee is preserved.

// (a) sentence_fragment — clause/verb markers that a real name never carries.
// Only ever fires alongside the >5-word length gate below, so a short name that
// merely contains one of these words in isolation is not swept in.
const SENTENCE_MARKER_RE = /\b(was|were|is|are|been|being|the|of|at|with|not\s+available|verified|unavailable|published|publication)\b/i;

// (b) doc_label — OM / sale-record field labels minted as a contact. Anchored,
// exact-or-near-exact (optional trailing "not available" / ":" / "."). These are
// document section headers, never a person's name.
const DOC_LABEL_RE = new RegExp(
  '^(?:'
  + 'income\\s*(?:&|and)\\s*expenses'
  + '|expenses?'
  + '|expense\\s+recoveries'
  + '|sale\\s+notes?'
  + '|lease\\s+notes?'
  + '|buyer\\s+information'
  + '|seller\\s+information'
  + '|renewal\\s+options?'
  + '|property\\s+description'
  + '|lease\\s+abstract'
  + '|rent\\s+roll'
  + '|tenant\\s+information'
  + '|financials?'
  + '|demographics'
  + '|highlights?'
  + '|remarks?'
  + '|notes?'
  + '|description'
  + '|zoning'
  + '|parking'
  + ')(?:\\s+not\\s+available)?\\s*[:.]?$',
  'i',
);

// (c) bare_title — the "name" is ONLY a job title, with no personal-name token.
// A word is title-ish if it is a title word or a pure connector; a bare_title
// requires a CORE title word AND that EVERY alphabetic token be title-ish. A real
// person always contributes at least one non-title token, so is never swept in.
const TITLE_WORDS = new Set([
  'senior', 'managing', 'director', 'executive', 'vice', 'president', 'associate',
  'advisor', 'adviser', 'investment', 'investments', 'principal', 'partner',
  'chairman', 'chairwoman', 'chair', 'broker', 'analyst', 'officer', 'ceo', 'cfo',
  'coo', 'cio', 'evp', 'svp', 'first', 'national', 'regional', 'sales', 'leasing',
  'capital', 'markets', 'group', 'team', 'specialist', 'representative', 'agent',
  'consultant', 'coordinator', 'manager', 'head', 'services', 'division',
  // pure connectors that may appear between title words
  'of', 'and', 'the', 'for', '&',
]);
const CORE_TITLE_RE = /\b(director|president|advisor|adviser|associate|managing|vice|principal|partner|chairman|chairwoman|broker|analyst|officer|evp|svp|specialist|manager|investments?)\b/i;

function isBareTitle(s) {
  if (!CORE_TITLE_RE.test(s)) return false;
  const tokens = s.split(/\s+/).map((t) => t.replace(/^[^A-Za-z&]+|[^A-Za-z&]+$/g, '')).filter(Boolean);
  if (tokens.length < 2) return false; // a single generic word ("Director") is left to doc_label / other arms
  for (const t of tokens) {
    if (!TITLE_WORDS.has(t.toLowerCase())) return false; // a non-title (personal-name) token — real contact
  }
  return true;
}

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
  const dl = s.match(DOC_LABEL_RE);
  if (dl) {
    return { heuristic: TM_MISPARSE_HEURISTIC, evidence: s.slice(0, 200), signal: 'doc_label', match: dl[0] };
  }
  if (isBareTitle(s)) {
    return { heuristic: TM_MISPARSE_HEURISTIC, evidence: s.slice(0, 200), signal: 'bare_title', match: s.slice(0, 60) };
  }
  const wordCount = s.split(/\s+/).filter(Boolean).length;
  const sm = s.match(SENTENCE_MARKER_RE);
  if (wordCount > 5 && sm) {
    return { heuristic: TM_MISPARSE_HEURISTIC, evidence: s.slice(0, 200), signal: 'sentence_fragment', match: sm[0] };
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

  // ENTC (2026-09-03) — the ENTITY mint guard was weaker than the one on the
  // domain `contacts` write. `upsertSidebarContacts` drops a candidate whose name
  // trips isJunkContactName; `unpackContacts` never did, so a firm/section-label/
  // narrative name carrying a real mailbox minted a PERSON entity that the
  // ensureEntityLink email tier then resolves inbound people onto (the junk80
  // population). The filter is INJECTED, not imported: this module is pure and
  // sidebar-pipeline imports it, so importing back would be circular — and a
  // second copy of the regex here is the normaliser drift this repo keeps paying
  // for. It is deliberately PERSON-ONLY: isJunkContactName rejects firm suffixes,
  // so running it on an organization candidate would block every legitimate
  // company mint.
  const personJunkName = typeof opts.personJunkName === 'function' ? opts.personJunkName : null;

  const mint = [];
  const review = [];
  for (const c of list) {
    if (!c || !c.name) continue;
    const em = c.email ? String(c.email).toLowerCase().trim() : '';
    if (personJunkName) {
      const junk = personJunkName(c);
      if (junk) {
        review.push({ contact: c, reason: 'person_junk_name', signal: typeof junk === 'string' ? junk : 'junk_contact_name', evidence: String(c.name).slice(0, 200) });
        continue;
      }
    }
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
