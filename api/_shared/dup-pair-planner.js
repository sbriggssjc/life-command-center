// W8 U2 — Ollama duplicate-pair proposals → resolver fuel (Prompt 63).
//
// Pure, dependency-free helpers for the hygiene campaign's second unit. Doctrine
// (playbook §7 + the U2 prompt): DUPES ARE THE RESOLVER'S JOB (Fellegi-Sunter
// /match + the entity_match_labels corpus). Ollama ASSISTS — it emits CANDIDATE
// PAIRS only. It never merges, never scores the auditable band, never writes
// canonical data. This module (1) deterministically generates the NEAR-MISS pool
// the resolver's token-blocks + embedding-KNN skip (NO LLM — an auditable gate),
// (2) shapes the prompt the local model gives a same-party/distinct/unsure second
// look, (3) normalizes that proposal, and (4) drops unsure/low-confidence.
//
// The blocking-rule blind spot: the resolver blocks candidate pairs on SHARED
// TOKENS (and embedding-KNN). A pair that shares NO significant word token is
// never generated for the resolver to score — even when the two names are one
// typo apart ("DaVita"/"DaVeta"), an abbreviation/expansion ("DVA"/"DaVita"), or
// share a mailing address under two different names. Those are exactly the pairs
// this generator surfaces so a human verdict can turn them into labels (both
// same_party positives AND — the W4.3 finding — hard-negative `distinct` pairs
// the too-easy corpus lacks).
//
// The live query + write side lives in api/admin.js (handleDupPairTick + the
// owner_reconcile 'w8_u2_ollama_pair' seeder branch); this module is the brain it
// calls. Every function is unit-testable in isolation.

// ---------------------------------------------------------------------------
// Target catalogue — the entity-class tables we generate near-miss pairs across.
// Per the U2 prompt: ops entities + gov/dia true_owners. Each target is
// self-describing so the tick stays generic. `addrCol` is null where the table
// has no reliable mailing column (→ the same-address generator is skipped for it,
// never guessed).
// ---------------------------------------------------------------------------
export const DUP_PAIR_TARGETS = [
  {
    domain: 'lcc', table: 'entities', pkCol: 'id', nameCol: 'name',
    mergedCol: 'merged_into_entity_id', addrCol: null,
    // Only real BD entities (owners/orgs), never the LCC-internal / generic-CRE
    // rows — those are not dup-resolution subjects.
    extraFilter: 'domain=in.(dia,gov,cre)',
  },
  {
    // gov.true_owners has NO scalar mailing-address column (the address lives in
    // the `contact_info` jsonb) — selecting a non-existent `mailing_address`
    // returned a PostgREST 400 that the old scan swallowed to records:0 (Prompt
    // 68 coverage bug). addrCol=null ⇒ the same-address generator is skipped for
    // this target (never guessed), name/abbrev methods still run.
    domain: 'gov', table: 'true_owners', pkCol: 'true_owner_id', nameCol: 'name',
    mergedCol: 'merged_into_true_owner_id', addrCol: null,
    extraFilter: null,
  },
  {
    // dia.true_owners has NO `address` column either — its owner mailing lives in
    // `notice_address_1` (the same 400→records:0 bug). Use the real column.
    domain: 'dia', table: 'true_owners', pkCol: 'true_owner_id', nameCol: 'name',
    mergedCol: 'merged_into_true_owner_id', addrCol: 'notice_address_1',
    extraFilter: null,
  },
];

export function dupPairTargetKey(t) {
  return `${t.domain}:${t.table}`;
}

export function findDupPairTarget(domain, table) {
  const d = String(domain || '').toLowerCase();
  const dom = d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
  return DUP_PAIR_TARGETS.find((t) => t.domain === dom && t.table === table) || null;
}

// A stable ref for one side of a pair: domain:table:pk. Used to build the
// canonical order-independent pair key + the federated subject_ref.
export function dupSideRef(domain, table, pk) {
  const d = String(domain || '').toLowerCase();
  const dom = d === 'dialysis' ? 'dia' : d === 'government' ? 'gov' : d;
  return `${dom}:${table}:${pk}`;
}

// Canonical, order-independent pair key. (A,B) and (B,A) collapse to one key so
// the reciprocal pair is never proposed twice and the exclusion joins are stable.
export function dupPairKey(refA, refB) {
  const a = String(refA == null ? '' : refA);
  const b = String(refB == null ? '' : refB);
  return [a, b].sort().join('|');
}

// The federated subject_ref for the owner_reconcile lane (seeder D). Namespaced
// distinctly (ownrec:w8u2:<pairKey>) so a verdict routes back to exactly one
// w8_u2_dup_pair row and the exclusion set drains the lane.
export function dupPairSubjectRef(refA, refB) {
  return 'ownrec:w8u2:' + dupPairKey(refA, refB);
}

// ---------------------------------------------------------------------------
// Name normalization (NO LLM). Mirrors the resolver's shape closely enough that
// "shares a token block" here is a faithful proxy for "the resolver already sees
// this pair". Legal-entity form words AND generic-CRE nouns are stripped for the
// DISTINCTIVE CORE (the semantic name). A shared core is treated as an exact/
// blocked match — NOT a near-miss.
//
// Prompt 68: the old set stripped legal forms + a few CRE nouns but MISSED the
// high-frequency ones (investment(s), service(s), enterprise(s), real estate,
// owner(s)), so generic vocabulary dominated char-level similarity and produced
// garbage pairs ("P & A Investments" ↔ "B & W Realty Investment" = 0.909;
// "Owner" ↔ "Downer & Associates" = 0.833; "T.D. Service Company" ↔ "I.C.E.
// Services Inc" = 0.875). Stripping the full stoplist collapses those to an EMPTY
// distinctive core so they are never paired, while true typo-dupes on the
// distinctive word ("Invester" ↔ "Investar") survive.
// ---------------------------------------------------------------------------
const LEGAL_FORM_TOKENS = new Set([
  // Pure legal-entity forms.
  'llc', 'l.l.c', 'llp', 'lp', 'l.p', 'inc', 'incorporated', 'corp', 'corporation',
  'co', 'company', 'ltd', 'limited', 'trust', 'reit', 'dst', 'lllp', 'plc', 'pllc',
  'lc', 'pa', 'pc',
  // Generic-CRE nouns (the stoplist): these carry no distinguishing signal — they
  // recur across thousands of unrelated owners, so char-similarity on them is noise.
  'partners', 'partnership', 'holdings', 'holding', 'group', 'associates', 'assoc',
  'properties', 'property', 'realty', 'management', 'mgmt', 'capital', 'ventures',
  'venture', 'investment', 'investments', 'investors', 'investor', 'enterprise',
  'enterprises', 'service', 'services', 'real', 'estate', 'owner', 'owners',
  'development', 'developments', 'equity', 'fund', 'funds', 'income', 'acquisitions',
  'acquisition',
  // Connectives / articles.
  'the', 'of', 'and',
]);

// The distinctive core must clear this many alphanumeric characters (across all
// significant tokens) to be pairable BY NAME similarity — below it the "core" is
// initials/noise (e.g. "P & A" → nothing; "T.D." → nothing) and only a
// same-address match may pair it. A single tunable knob.
export const DISTINCTIVE_CORE_MIN_LEN = 4;

export function normalizeOwnerName(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The significant word tokens (drop legal forms + 1-char noise). These are the
// resolver's blocking tokens: a shared one means the resolver already pairs them.
export function nameTokens(name) {
  const toks = normalizeOwnerName(name).split(' ').filter(Boolean);
  const out = new Set();
  for (const t of toks) {
    if (t.length < 2) continue;
    if (LEGAL_FORM_TOKENS.has(t)) continue;
    out.add(t);
  }
  return out;
}

// The semantic core string (significant tokens, sorted+joined) — used for
// exact-core equality (a shared core is a match the resolver sees, not a
// near-miss) and prefix bucketing.
export function ownerCore(name) {
  return [...nameTokens(name)].sort().join(' ');
}

// TRUE iff a name's DISTINCTIVE core is substantial enough to pair on by name
// similarity: at least DISTINCTIVE_CORE_MIN_LEN alphanumeric chars across its
// significant tokens AND at least one token of length ≥ 3 (so a purely-initials
// core like "ab cd" — or an empty one — is NOT pairable by name; it can still
// pair via the same-address method). Prompt 68 guard against the initials-vs-
// initials noise ("P & A" ↔ "B & W").
export function coreIsPairable(name) {
  const toks = [...nameTokens(name)];
  if (!toks.length) return false;
  const flatLen = toks.join('').replace(/[^a-z0-9]/g, '').length;
  if (flatLen < DISTINCTIVE_CORE_MIN_LEN) return false;
  return toks.some((t) => t.length >= 3);
}

// TRUE iff the two names share at least one significant token — i.e. the resolver
// blocks (and scores) this pair already, so it is NOT in our blind-spot pool.
export function sharesTokenBlock(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Similarity primitives (character trigram Dice + Levenshtein ratio). The
// generator keys on the MAX of the two, so both a transposition ("DaVita"↔
// "DaVtia") and a short edit are caught.
// ---------------------------------------------------------------------------
export function charTrigrams(s) {
  const t = '  ' + String(s == null ? '' : s).replace(/\s+/g, ' ').trim() + '  ';
  const out = new Set();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function trigramSimilarity(a, b) {
  const ta = charTrigrams(a);
  const tb = charTrigrams(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter += 1;
  return (2 * inter) / (ta.size + tb.size);
}

export function levenshtein(a, b) {
  const s = String(a == null ? '' : a);
  const t = String(b == null ? '' : b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[t.length];
}

export function levenshteinRatio(a, b) {
  const s = String(a == null ? '' : a);
  const t = String(b == null ? '' : b);
  const max = Math.max(s.length, t.length);
  if (!max) return 1;
  return 1 - levenshtein(s, t) / max;
}

// Combined similarity on the semantic cores (0..1).
export function nameSimilarity(a, b) {
  const ca = ownerCore(a);
  const cb = ownerCore(b);
  if (!ca || !cb) return 0;
  return Math.max(trigramSimilarity(ca, cb), levenshteinRatio(ca, cb));
}

// ---------------------------------------------------------------------------
// Abbreviation / expansion detection (e.g. "DVA" ↔ "DaVita", "USRC" ↔ "US Renal
// Care"). A short all-letters token whose letters are the INITIALS of the other
// name's significant tokens, or an explicit known-abbreviation mapping.
// ---------------------------------------------------------------------------
export function nameInitials(name) {
  return [...nameTokens(name)].map((t) => t[0]).join('').toLowerCase();
}

// Domain-seeded known abbreviations (net-lease operators). Small + explicit — the
// generator is deterministic; this is not an LLM guess.
export const KNOWN_ABBREVIATIONS = {
  dva: 'davita',
  usrc: 'us renal care',
  fmc: 'fresenius medical care',
  fms: 'fresenius medical',
  ara: 'american renal',
};

// TRUE iff one name is an abbreviation/expansion of the other. Returns the shape
// of the match so the evidence quote is grounded.
export function abbreviationMatch(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  // Single short token on one side, multi-token on the other.
  const single = (toks) => toks.size === 1 ? [...toks][0] : null;
  const sa = single(ta);
  const sb = single(tb);
  const tryOne = (short, otherToks, otherName) => {
    if (!short || short.length < 2 || short.length > 6) return null;
    if (!/^[a-z]+$/.test(short)) return null;
    // Known-abbreviation map (expansion core-contains).
    const expansion = KNOWN_ABBREVIATIONS[short];
    if (expansion) {
      const otherCore = ownerCore(otherName);
      if (otherCore === ownerCore(expansion) || nameSimilarity(otherName, expansion) >= 0.7) {
        return { kind: 'known_abbrev', short, expansion };
      }
    }
    // Initials match: the short token equals the initials of the other's tokens.
    if (otherToks.size >= 2) {
      const inits = [...otherToks].map((t) => t[0]).join('');
      if (inits === short) return { kind: 'initials', short, initials: inits };
    }
    return null;
  };
  return tryOne(sa, tb, b) || tryOne(sb, ta, a) || null;
}

// ---------------------------------------------------------------------------
// Address normalization (for the same-address / different-name generator).
// ---------------------------------------------------------------------------
export function normalizeAddress(addr) {
  const s = String(addr == null ? '' : addr).toLowerCase();
  if (!s.trim()) return '';
  return s
    .replace(/\b(suite|ste|apt|unit|floor|fl|#)\b\.?\s*\w+/g, ' ')
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|place|pl|parkway|pkwy|highway|hwy|circle|cir|way|terrace|ter|trail|trl|square|sq|suite)\b/g, (m) => m)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A pure P.O.-box / minimal address is too weak to key a same-address pair on.
export function isWeakAddress(normAddr) {
  const s = String(normAddr || '');
  if (s.replace(/[^a-z0-9]/g, '').length < 6) return true;
  if (/^p ?o box\b/.test(s) || /^box \d+$/.test(s)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// The deterministic near-miss pair generator (NO LLM — the auditable gate).
//
// `records`: [{ ref, name, address? }] for one domain target (ref = dupSideRef).
// Returns a capped, deduped list of candidate pairs the resolver's blocking would
// miss, each carrying { a, b, pairKey, method, similarity, evidence }.
//   method: 'name_near_miss' | 'same_address_diff_name' | 'abbrev_expansion'
//
// Blocking here is designed to be O(n·bucket) not O(n²): name candidates are
// compared only within a normalized-core PREFIX bucket; address candidates within
// a normalized-address bucket; abbreviations via an initials/short-token index.
// A pair is only emitted when it does NOT share a resolver token block (the blind
// spot) AND its cores are not identical (an identical core is a block the resolver
// already sees).
// ---------------------------------------------------------------------------
export function generateCandidatePairs(records, opts = {}) {
  const list = Array.isArray(records) ? records : [];
  const nameThreshold = Number.isFinite(opts.nameThreshold) ? opts.nameThreshold : 0.82;
  const prefixLen = Number.isFinite(opts.prefixLen) ? opts.prefixLen : 3;
  const maxPairs = Number.isFinite(opts.maxPairs) ? Math.max(0, opts.maxPairs) : 200;
  const maxBucket = Number.isFinite(opts.maxBucket) ? opts.maxBucket : 400;

  // Pre-compute per-record normalized fields once. Keep a record if it can
  // participate in ANY method — a distinctive core/tokens (name near-miss /
  // abbrev) or a usable address (same-address). `pairable` (Prompt 68) gates the
  // NAME near-miss method only: an initials-only / sub-threshold core still
  // reaches the same-address + abbrev methods but is never paired by name noise.
  const recs = [];
  for (const r of list) {
    const name = r && r.name != null ? String(r.name) : '';
    const addr = r && r.address != null ? normalizeAddress(r.address) : '';
    const core = ownerCore(name);
    const tokens = nameTokens(name);
    if (!tokens.size && (!addr || isWeakAddress(addr))) continue; // nothing to match on
    recs.push({ ref: String(r.ref), name, core, tokens, addr, pairable: coreIsPairable(name) });
  }

  const pairs = new Map(); // pairKey -> pair (first/strongest wins)
  const consider = (ra, rb, method, similarity, evidence) => {
    if (ra.ref === rb.ref) return;
    if (ra.core === rb.core) return;                 // identical core = resolver sees it
    if (sharesTokenBlock(ra.name, rb.name)) return;  // shared token = resolver blocks it
    const key = dupPairKey(ra.ref, rb.ref);
    const existing = pairs.get(key);
    if (existing && existing.similarity >= similarity) return;
    // Order the sides by ref so (a,b) is stable/canonical.
    const [firstRef] = [ra.ref, rb.ref].sort();
    const [a, b] = ra.ref === firstRef ? [ra, rb] : [rb, ra];
    pairs.set(key, {
      a: { ref: a.ref, name: a.name }, b: { ref: b.ref, name: b.name },
      pairKey: key, method, similarity: Math.round(similarity * 1000) / 1000, evidence,
    });
  };

  // 1. Name near-miss — bucket by BOTH a core prefix and a core suffix so a typo
  //    in the first characters ("DaVita"/"NaVita") still shares the suffix bucket
  //    and a typo in the tail ("DaVita"/"DaVeta") still shares the prefix bucket.
  //    A pair is compared if it collides in EITHER bucket (dedup via the pairs map).
  const byPrefix = new Map();
  const addKey = (map, key, r) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  };
  for (const r of recs) {
    if (!r.pairable) continue; // only distinctive-core records pair by name similarity
    const flat = r.core.replace(/\s/g, '');
    addKey(byPrefix, 'p:' + flat.slice(0, prefixLen), r);
    if (flat.length >= prefixLen) addKey(byPrefix, 's:' + flat.slice(-prefixLen), r);
  }
  for (const bucket of byPrefix.values()) {
    if (bucket.length < 2 || bucket.length > maxBucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const sim = nameSimilarity(bucket[i].name, bucket[j].name);
        if (sim >= nameThreshold) {
          consider(bucket[i], bucket[j], 'name_near_miss', sim,
            `name similarity ${sim.toFixed(2)} with no shared word token ("${bucket[i].name}" vs "${bucket[j].name}")`);
        }
      }
    }
  }

  // 2. Same normalized address, different names.
  const byAddr = new Map();
  for (const r of recs) {
    if (!r.addr || isWeakAddress(r.addr)) continue;
    if (!byAddr.has(r.addr)) byAddr.set(r.addr, []);
    byAddr.get(r.addr).push(r);
  }
  for (const [addr, bucket] of byAddr.entries()) {
    if (bucket.length < 2 || bucket.length > maxBucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const sim = nameSimilarity(bucket[i].name, bucket[j].name);
        consider(bucket[i], bucket[j], 'same_address_diff_name', Math.max(sim, 0.5),
          `same mailing address "${addr}" under different names ("${bucket[i].name}" vs "${bucket[j].name}")`);
      }
    }
  }

  // 3. Abbreviation / expansion — index short single-token records + initials.
  for (let i = 0; i < recs.length; i++) {
    const ri = recs[i];
    // Only pursue when one side could be an acronym (single short token).
    if (ri.tokens.size !== 1) continue;
    const short = [...ri.tokens][0];
    if (short.length < 2 || short.length > 6) continue;
    for (let j = 0; j < recs.length; j++) {
      if (i === j) continue;
      const rj = recs[j];
      const m = abbreviationMatch(ri.name, rj.name);
      if (m) {
        consider(ri, rj, 'abbrev_expansion', 0.6,
          m.kind === 'known_abbrev'
            ? `"${m.short}" is a known abbreviation of "${m.expansion}"`
            : `"${m.short}" matches the initials of "${rj.name}"`);
      }
    }
  }

  const all = [...pairs.values()].sort((x, y) => y.similarity - x.similarity);
  return maxPairs ? all.slice(0, maxPairs) : all;
}

// Exclude pairs whose canonical key is already known (already labeled, already
// merged, or already in the resolver review pool). Pure set filter.
export function excludeKnownPairs(pairs, knownKeySet) {
  const set = knownKeySet instanceof Set ? knownKeySet : new Set(knownKeySet || []);
  const list = Array.isArray(pairs) ? pairs : [];
  if (!set.size) return list.slice();
  return list.filter((p) => !set.has(p.pairKey));
}

// ---------------------------------------------------------------------------
// The prompt the local model gives a same-party / distinct / unsure SECOND LOOK.
// Proposal-only: the model NEVER merges and NEVER scores the auditable band — its
// verdict becomes a human-review card, and only a HUMAN verdict writes a label.
// ---------------------------------------------------------------------------
export function buildDupPairPrompt(pair, fewShot) {
  const shots = Array.isArray(fewShot) ? fewShot.slice(0, 8) : [];
  const p = pair || {};
  const payload = {
    name_a: p.a ? p.a.name : null,
    name_b: p.b ? p.b.name : null,
    generator_method: p.method || null,
    deterministic_evidence: p.evidence || null,
    name_similarity: p.similarity != null ? p.similarity : null,
  };
  const lines = [
    'You are the LCC Ollama data-hygiene duplicate-pair pre-screen agent.',
    'You ONLY propose. You never merge, never delete, never write data, and never invent facts.',
    'Two owner/entity records were flagged by a DETERMINISTIC near-miss generator as a POSSIBLE duplicate the resolver\'s blocking rules would miss (they share no significant word token). Give a second look.',
    '',
    'Return ONLY strict JSON with keys: verdict, confidence, evidence_quote, reason.',
    '- verdict: one of "same_party" (the two records are the SAME real-world owner/entity), "distinct" (they are DIFFERENT parties despite the near-miss), "unsure" (not enough signal to say).',
    '- confidence: 0.0 to 1.0.',
    '- evidence_quote: the VERBATIM substring(s) from name_a / name_b that justify the verdict (copy exactly, never paraphrase).',
    '- reason: one short sentence citing the concrete signal (a typo/abbreviation/shared address for same_party; a distinguishing token, different city, or different entity number for distinct).',
    '- Prefer "distinct" over "same_party" when a distinguishing token could mean two different entities (e.g. "…Fund I" vs "…Fund II", "North" vs "South", different property codes). A wrong same_party pollutes the training corpus — a careful distinct is valuable HARD-NEGATIVE training data.',
    '- Use "unsure" when the names are close but you have no basis to decide; unsure pairs are dropped, not shown to a human.',
    '',
    'Calibration examples:',
    '- name_a "DaVita Inc", name_b "DaVeta Inc" -> same_party (a one-letter typo of the same operator)',
    '- name_a "DVA", name_b "DaVita" -> same_party (a known abbreviation/expansion)',
    '- name_a "Blackstone Real Estate Fund I", name_b "Blackstone Real Estate Fund II" -> distinct (different fund series)',
    '- name_a "Oak Street Realty", name_b "Oakstreet Realty LLC" -> same_party (spacing variant of one firm)',
    '- name_a "ARC GSDVRDE001 LLC", name_b "ARC GSDVRDE002 LLC" -> distinct (different property-coded SPEs)',
    '- name_a "Invester Properties LLC", name_b "Investar Properties LLC" -> same_party (a one-letter typo/spelling variant of the same firm; a human confirms)',
    '- name_a "Winbrook Management", name_b "Twinbrook Properties" -> same_party (a spelling variant of one firm — lean same_party, pending human confirm)',
    '- name_a "Harrison Capital", name_b "Garrison Capital" -> distinct (DIFFERENT personal/proper surnames, not a typo)',
    'Rubric: a typo / spelling-variant of the SAME distinctive word leans same_party (a human confirms). DIFFERENT personal or proper surnames (Harrison vs Garrison, Downer vs Bowman) are distinct. An entity-form ("LLC" vs "LP") or state-suffix difference ALONE never distinguishes two records.',
  ];
  if (shots.length) {
    lines.push('Operator rubric — real past human verdicts on similar pairs:');
    for (const s of shots) {
      lines.push(`- "${String(s.a || '').slice(0, 60)}" vs "${String(s.b || '').slice(0, 60)}" -> ${s.verdict}`);
    }
  }
  lines.push(JSON.stringify({ pair: payload }, null, 2));
  return lines.join('\n');
}

const DUP_VERDICTS = new Set(['same_party', 'distinct', 'unsure']);

export function normalizeDupPairProposal(raw, pair) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  let verdict = String(obj.verdict || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (verdict === 'same' || verdict === 'match' || verdict === 'duplicate') verdict = 'same_party';
  if (verdict === 'different' || verdict === 'not_a_match' || verdict === 'no') verdict = 'distinct';
  if (!DUP_VERDICTS.has(verdict)) verdict = 'unsure';
  const n = Number(obj.confidence);
  const confidence = Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  // Evidence quote must be verbatim from one of the two names; else fall back to
  // the deterministic evidence the generator captured.
  let quote = obj.evidence_quote != null ? String(obj.evidence_quote) : '';
  const na = String(pair?.a?.name || '').toLowerCase();
  const nb = String(pair?.b?.name || '').toLowerCase();
  const q = quote.toLowerCase();
  if (!quote || (q && !na.includes(q) && !nb.includes(q))) {
    quote = pair?.evidence != null ? String(pair.evidence) : quote;
  }
  quote = quote.slice(0, 200);
  const reason = String(obj.reason || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    || `Deterministic ${pair?.method || 'near-miss'} generator flagged this pair.`;
  return { verdict, confidence, evidence_quote: quote, reason };
}

// Reuse the tolerant JSON extraction (fenced ```json, then first/last-brace).
export function parseDupPairJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch (_e) { /* fall through */ }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)); } catch (_e) { /* fall through */ }
  }
  return null;
}

// A proposal is PROPOSABLE (persisted to the resolver review pool) only when it
// is a decided verdict (same_party OR distinct — both are training fuel) AND
// confidence clears the floor. `unsure` and low-confidence are DROPPED (counted
// only) — never shown to a human, never a merge.
export function isProposablePair(proposal, minConfidence = 0.6) {
  const v = String(proposal?.verdict || '').toLowerCase();
  if (v !== 'same_party' && v !== 'distinct') return false;
  const c = Number(proposal?.confidence);
  return Number.isFinite(c) && c >= minConfidence;
}

// Core-similarity floor at/above which an `unsure` verdict is NOT dropped but
// ROUTED to the human review lane (Prompt 68). A high-core-similarity near-miss
// the model can't decide is exactly the typo-variant judgment call the human lane
// exists for — dropping it silently loses the unit's best finds. Below the floor,
// an unsure is genuine noise and still drops.
export const DUP_PAIR_NEEDS_HUMAN_SIM = 0.85;

// The single disposition of a scored pair (Prompt 68): one of
//   'propose'      — a decided verdict (same_party|distinct) above the confidence
//                    floor. Persists as a model-decided proposal (training fuel).
//   'needs_human'  — the model is unsure BUT the deterministic core similarity is
//                    high (>= DUP_PAIR_NEEDS_HUMAN_SIM). Persists to the review
//                    lane as an `unsure` proposal for a human verdict — NOT dropped.
//   'drop'         — unsure + low similarity, or a decided verdict below the floor.
//                    Counted only; never shown to a human, never a merge.
export function dupPairDisposition(proposal, pair, opts = {}) {
  const minConfidence = Number.isFinite(opts.minConfidence) ? opts.minConfidence : 0.6;
  const needsHumanSim = Number.isFinite(opts.needsHumanSim) ? opts.needsHumanSim : DUP_PAIR_NEEDS_HUMAN_SIM;
  if (isProposablePair(proposal, minConfidence)) return 'propose';
  const v = String(proposal?.verdict || '').toLowerCase();
  const sim = Number(pair?.similarity);
  if (v === 'unsure' && Number.isFinite(sim) && sim >= needsHumanSim) return 'needs_human';
  return 'drop';
}

// Bounded scorer (pure, injectable clock) — mirrors U1's scoreWithBudget so a
// single HTTP invocation never outruns the Railway proxy on ollama latency.
export async function scoreDupPairsWithBudget(pairs, scoreOne, opts = {}) {
  const list = Array.isArray(pairs) ? pairs : [];
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : Infinity;
  const maxN = Number.isFinite(opts.maxN) ? Math.max(0, opts.maxN) : list.length;
  const cap = Math.min(maxN, list.length);
  const start = now();
  const results = [];
  let budgetExhausted = false;
  for (let i = 0; i < cap; i++) {
    if (now() - start >= budgetMs) { budgetExhausted = true; break; }
    // eslint-disable-next-line no-await-in-loop
    results.push(await scoreOne(list[i], i));
  }
  return {
    results, scored: results.length, budget_exhausted: budgetExhausted,
    remaining_unscored: Math.max(0, list.length - results.length),
    capped: Math.max(0, list.length - cap), cap,
  };
}
