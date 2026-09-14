// api/_shared/deal-milestone-cues.js
// W7.2 — DETERMINISTIC milestone-cue detection for the deal-comms propagation tick.
//
// The tick reads deal-stamped comm rows and turns UNAMBIGUOUS transaction cues
// (LOI / PSA / escrow / EMD / due-diligence / financing / listing / close) into
// lcc_deal_milestone rows. This module is the cue engine: pure, word-boundary
// regexes (the W3.3 discipline — no fuzzy substring), independently testable, no
// AI. A cue hit is an auditable deterministic write; anything the LLM merely
// *suggests* (no cue here) never writes — it routes to a confirm lane instead.
//
// Contract:
//   detectMilestoneCues(subject, body) -> Array<{ key, status, label, matched }>
//     key    — a canonical lcc_deal_milestone.milestone_key
//              (loi|psa|escrow|diligence|financing|marketing|close)
//     status — 'past' (it happened / was sent-received-executed) or
//              'next'  (explicitly scheduled/expected/targeted for the future)
//     label  — a short human summary for lcc_deal_milestone.summary
//     matched— the phrase that fired (diagnostics only)
//
// occurred_on is NOT parsed from prose (never fabricate a date) — the caller
// stamps the comm's own date and points detail_ref at the activity for the real
// event date. Multiple distinct cues in one message all fire (a message can
// announce both "PSA executed" and "escrow opened").

const WB = (s) => new RegExp(`(^|[^a-z0-9])(${s})([^a-z0-9]|$)`, 'i');

// Each rule: a canonical key + label + an ordered list of {re, status} phrase
// tests. First matching phrase per key wins (most-specific status first).
// Phrases are lower-cased, word-boundary-anchored, and deliberately narrow.
const RULES = [
  {
    key: 'loi', label: 'Letter of intent',
    tests: [
      { re: WB('loi (?:is )?(?:fully )?executed|executed loi|loi (?:has been )?signed|signed loi'), status: 'past', label: 'LOI executed' },
      { re: WB('loi (?:was |is )?(?:received|submitted|sent)|received (?:your |the |an )?loi|submitted (?:an |a |the )?loi|sending (?:you )?(?:an |a |the )?loi'), status: 'past', label: 'LOI exchanged' },
      { re: WB('letter of intent'), status: 'past', label: 'Letter of intent' },
      { re: WB('loi'), status: 'past', label: 'LOI' },
    ],
  },
  {
    key: 'psa', label: 'Purchase & sale agreement',
    tests: [
      { re: WB('psa (?:is )?(?:fully )?executed|executed psa|psa (?:has been )?signed|signed (?:the )?psa|contract (?:is )?(?:fully )?executed|fully executed contract|executed the contract'), status: 'past', label: 'PSA executed' },
      { re: WB('psa draft|draft psa|draft of the psa|first draft of the (?:psa|contract)|psa (?:has been )?circulated|circulating (?:the )?psa|attached (?:is )?(?:the )?psa'), status: 'past', label: 'PSA drafted / circulated' },
      { re: WB('purchase (?:and|&) sale agreement|purchase agreement'), status: 'past', label: 'Purchase & sale agreement' },
      { re: WB('psa'), status: 'past', label: 'PSA' },
    ],
  },
  {
    key: 'escrow', label: 'Escrow / earnest money',
    tests: [
      { re: WB('escrow (?:is )?(?:now )?open|opened escrow|open(?:ed|ing) (?:of )?escrow|into escrow|went (?:hard|firm)|earnest money (?:has been )?(?:wired|deposited|posted|received)|emd (?:wired|deposited|posted|received)|wire(?:d)? (?:the )?(?:earnest|emd)'), status: 'past', label: 'Escrow opened / EMD posted' },
      { re: WB('escrow (?:will|to) open|open escrow (?:on|by)|escrow (?:is )?(?:expected|scheduled) to open'), status: 'next', label: 'Escrow opening scheduled' },
      { re: WB('escrow|earnest money|\\bemd\\b'), status: 'past', label: 'Escrow / earnest money' },
    ],
  },
  {
    key: 'diligence', label: 'Due diligence',
    tests: [
      { re: WB('(?:due diligence|dd|inspection) (?:period )?(?:has )?(?:expired|ended|waived|removed|completed|is complete)|waive(?:d)? (?:our |the )?(?:dd|due diligence|contingency|contingencies)|removed (?:the )?(?:dd|due diligence|contingency|contingencies)'), status: 'past', label: 'Due diligence completed / waived' },
      { re: WB('(?:due diligence|dd|inspection) (?:period )?(?:has )?(?:begun|started|commenced|underway)|start(?:ing|ed) (?:our |the )?(?:dd|due diligence)|begin(?:ning)? (?:due diligence|dd)|kick(?:ing)? off (?:dd|due diligence)'), status: 'past', label: 'Due diligence started' },
      { re: WB('(?:dd|due diligence|inspection) (?:period )?(?:ends|expires|will end|to end|deadline)'), status: 'next', label: 'Due diligence deadline' },
      { re: WB('due diligence'), status: 'past', label: 'Due diligence' },
    ],
  },
  {
    key: 'financing', label: 'Financing / lender commitment',
    tests: [
      { re: WB('loan commitment|lender commitment|commitment letter|financing (?:is )?(?:approved|committed|secured|in place)|rate lock(?:ed)?|clear(?:ed)? to close|term sheet (?:signed|executed|accepted)'), status: 'past', label: 'Financing commitment' },
      { re: WB('financing contingency (?:waived|removed|expired)|waive(?:d)? financing'), status: 'past', label: 'Financing contingency cleared' },
    ],
  },
  {
    key: 'marketing', label: 'Listing / marketing launch',
    tests: [
      { re: WB('(?:om|offering memo(?:randum)?|listing|deal) (?:is )?(?:now )?(?:live|launched|out|on the market|hit the market|gone to market)|launch(?:ed|ing) (?:the )?(?:listing|marketing|om)|went to market|to market (?:this|next) week|blast(?:ed|ing) (?:the )?om'), status: 'past', label: 'Marketing launched' },
    ],
  },
  {
    key: 'close', label: 'Closing',
    tests: [
      { re: WB('(?:we )?closed(?: escrow| the deal| the sale| the transaction)?|closing (?:is )?(?:complete|done|funded)|deal (?:has )?closed|sale (?:has )?closed|funded (?:and|&) (?:recorded|closed)|recorded (?:the )?deed'), status: 'past', label: 'Closed' },
      { re: WB('clos(?:e|ing) (?:is )?(?:scheduled|set|targeted|expected|slated) (?:for|on)|target(?:ing)? (?:a )?close|close (?:on|by) [a-z0-9]|scheduled to close|expected to close|closing date (?:is|of)'), status: 'next', label: 'Closing scheduled' },
    ],
  },
];

/**
 * Detect deterministic milestone cues in one message.
 * @param {string} subject
 * @param {string} body
 * @returns {Array<{key,status,label,matched}>} 0..n cues (deduped by key; the
 *   first/most-specific status per key wins).
 */
export function detectMilestoneCues(subject, body) {
  const text = `${subject || ''}\n${body || ''}`;
  if (!text.trim()) return [];
  const out = [];
  const seen = new Set();
  for (const rule of RULES) {
    if (seen.has(rule.key)) continue;
    for (const t of rule.tests) {
      const m = text.match(t.re);
      if (m) {
        out.push({ key: rule.key, status: t.status, label: t.label || rule.label, matched: (m[2] || m[0] || '').trim().slice(0, 80) });
        seen.add(rule.key);
        break; // first (most-specific) test per key wins
      }
    }
  }
  return out;
}

export const __test__ = { RULES, WB };
