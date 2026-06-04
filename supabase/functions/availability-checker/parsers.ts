// ============================================================================
// availability-checker/parsers.ts
//
// Per-site HTML parsers for off-market markers. CREXi / CoStar / LoopNet
// each render listings differently and use different "no longer available"
// language. Keeping the rules in a per-host registry avoids the parser
// false-positiving on benign words ("sold" inside a paragraph about the
// neighborhood, "off market" mentioned in a comp blurb).
//
// Each parser returns a `ParseResult`. The caller decides what to do with
// it; this file does not mutate state.
//
// Design rules:
//   - We only ever return outcome='off_market' on off-market markers.
//     Even when a page says "Sold", we hand that back as 'off_market_sold_hint'
//     because the cron worker is forbidden from auto-marking 'sold' without
//     a sales_transactions match (that's the existing auto-scrape cron's
//     job — see api/admin.js handleAutoScrapeListings).
//   - 'unreachable' covers 4xx/5xx, network errors, and bot-block pages.
//     The worker increments consecutive_check_failures and only crosses
//     into 'off_market' once the count crosses a threshold.
//   - 'still_available' requires either an explicit active marker OR a
//     successful 200 response that does NOT match any off-market markers
//     (so we don't false-positive on a stale-but-still-live listing).
// ============================================================================

export type ParseOutcome =
  | "off_market"
  | "off_market_sold_hint"
  | "still_available"
  | "unreachable"
  | "manual_review_needed"
  // Emitted only by index.ts handleDebugCheckUrl when shouldSkipHost short-
  // circuits before the fetch (URL shorteners, mail-tracking redirectors,
  // etc.). Parsers never produce this — including it here just lets the
  // ParseResult type cover the synthetic envelope returned to the script.
  | "skipped";

export interface ParseResult {
  outcome: ParseOutcome;
  reason?: string;        // e.g. 'withdrawn', 'unverified_assumed_off'
  matched?: string;       // the marker fragment that matched
  http_status: number;
  parser: string;         // 'crexi' | 'costar' | 'loopnet' | 'generic'
  notes: string;
  // Round 68-A (Task 1) — marketing-start date recovered from a page marker
  // ("Listed on" / "Date on Market" / "Days on Market" / JSON-LD datePosted).
  // The worker uses this to re-date a listing_date that was defaulted to a
  // capture date, but ONLY with this receipt (never a guess).
  listed_on?: string | null;        // ISO yyyy-mm-dd
  listed_on_marker?: string | null; // the label/fragment that yielded it
}

interface FetchResponse {
  finalUrl: string;
  status: number;
  body: string;
  blocked: boolean;       // bot-block / captcha indicator
}

// Lowercased, plain text — no regex, no HTML decoding. Catches the
// overwhelming majority of off-market banners that CREXi / CoStar /
// LoopNet render server-side. Anything that requires JS to surface
// the marker stays in 'manual_review_needed' territory.
const OFF_MARKET_GENERIC = [
  "no longer available",
  "no longer active",
  "this listing has been removed",
  "this listing is no longer",
  "this property is no longer",
  "off market",
  "off-market",
  "withdrawn",
  "removed from the market",
  "has been taken off the market",
  "listing not found",
  "the listing you are looking for",
];

const UNDER_CONTRACT_FRAGMENTS = [
  "under contract",
  "sale pending",
  "pending sale",
];

// Sold-flavored hints. Worker NEVER promotes these to status='sold'
// without a sales_transactions match — see top-of-file note. These
// surface as off_market_sold_hint so the worker can record an
// 'off_market' check with off_market_reason='unverified_assumed_off'.
const SOLD_HINT_FRAGMENTS = [
  "this property has been sold",
  "property has been sold",
  "this listing has been sold",
  "marked as sold",
];

// JSON-LD availability marker — CREXi embeds Schema.org Offer with
// availability set to "https://schema.org/SoldOut" or "OutOfStock"
// when a listing closes.
const JSONLD_OFF_MARKET = [
  '"availability":"https://schema.org/soldout"',
  '"availability":"https://schema.org/outofstock"',
  '"availability":"soldout"',
  '"availability":"sold"',
];

// Active-listing tells. We don't need to see these for a still_available
// verdict (a clean 200 with no off-market markers is enough), but they
// raise confidence and let us short-circuit when the page is clearly
// alive.
const ACTIVE_FRAGMENTS = [
  "asking price",
  "request more info",
  "schedule a tour",
  "investment highlights",
  "for sale by",
  "offering memorandum",
  "broker contact",
];

const BOT_BLOCK_FRAGMENTS = [
  "are you a robot",
  "captcha",
  "access denied",
  "request blocked",
  "akamai",
  "press & hold to confirm",
  "verify you are human",
  "checking your browser",
  "cf-browser-verification",
];

// ── Round 68-A — marketing-start-date extraction (Task 1) ────────────────────
//
// Recover the date a listing first hit the market from the page, so the worker
// can correct a listing_date that was defaulted to a capture/import date. We
// only ever return an explicit calendar date (a receipt) or a date computed
// from an explicit "N days on market" count — never an inference.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MARKETING_START_LABELS = [
  "date on market",
  "on market date",
  "listed on",
  "listed date",
  "date listed",
];

function toISO(y: number, m: number, d: number): string | null {
  if (!(y >= 2005 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Accepts "3/14/2025", "03-14-2025", "Mar 14, 2025", "March 14 2025".
function parseDateToken(token: string): string | null {
  const t = token.trim().toLowerCase();
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return toISO(Number(m[3]), Number(m[1]), Number(m[2]));
  m = t.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3)];
    if (mon) return toISO(Number(m[3]), mon, Number(m[2]));
  }
  return null;
}

// Returns the recovered marketing-start date + the marker that produced it.
// `nowMs` is injected so "N days on market" is deterministic/testable.
export function extractMarketingStartDate(
  html: string,
  nowMs: number = Date.now(),
): { date: string; marker: string } | null {
  const h = lowerSnippet(html);

  // 1. JSON-LD datePosted — the most reliable, structured signal.
  const jsonLd = h.match(/"dateposted"\s*:\s*"(\d{4})-(\d{2})-(\d{2})/);
  if (jsonLd) {
    const iso = toISO(Number(jsonLd[1]), Number(jsonLd[2]), Number(jsonLd[3]));
    if (iso) return { date: iso, marker: "jsonld:datePosted" };
  }

  // 2. Labelled calendar date: "Date on Market: 3/14/2025", "Listed on Mar 14, 2025".
  for (const label of MARKETING_START_LABELS) {
    const re = new RegExp(
      label.replace(/ /g, "\\s+") +
        "\\s*[:\\-]?\\s*([a-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{4})",
    );
    const mm = h.match(re);
    if (mm) {
      const iso = parseDateToken(mm[1]);
      if (iso) return { date: iso, marker: `${label}:${mm[1].trim()}` };
    }
  }

  // 3. "N days on market" / "N days on the market" — subtract from today.
  const dom = h.match(/(\d{1,4})\s+days?\s+on\s+(?:the\s+)?market/);
  if (dom) {
    const n = Number(dom[1]);
    if (n >= 1 && n <= 3650) {
      const d = new Date(nowMs - n * 86_400_000);
      const iso = toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      if (iso) return { date: iso, marker: `days-on-market:${n}` };
    }
  }
  return null;
}

function lowerSnippet(html: string, max = 200_000): string {
  // Most off-market banners render in the first ~50KB of the document.
  // 200KB cap protects against multi-MB CoStar pages that pack imagery
  // and embedded fonts inline.
  return html.slice(0, max).toLowerCase();
}

function detectBotBlock(haystack: string, status: number): string | null {
  // Cloudflare and Akamai both return 200 with an HTML interstitial when
  // they want to make you solve a challenge. Detect the body, not the
  // status, otherwise these look like healthy responses to the worker.
  if (status === 403 || status === 429 || status === 503) {
    return `http ${status}`;
  }
  for (const f of BOT_BLOCK_FRAGMENTS) {
    if (haystack.includes(f)) return f;
  }
  return null;
}

function findFirst(haystack: string, fragments: string[]): string | null {
  for (const f of fragments) {
    if (haystack.includes(f)) return f;
  }
  return null;
}

function classifyByMarkers(
  html: string,
  status: number,
  parser: string,
): ParseResult {
  const h = lowerSnippet(html);

  const blocked = detectBotBlock(h, status);
  if (blocked) {
    return {
      outcome: "unreachable",
      http_status: status,
      parser,
      notes: `bot block / challenge detected: ${blocked}`,
    };
  }

  if (status === 404 || status === 410) {
    return {
      outcome: "unreachable",
      http_status: status,
      parser,
      notes: `http ${status} — page gone (could be stale URL, not necessarily off-market)`,
    };
  }

  if (status >= 400) {
    return {
      outcome: "unreachable",
      http_status: status,
      parser,
      notes: `http ${status} error`,
    };
  }

  // Order matters: sold-hints first (so they don't get stolen by the
  // generic "no longer available" path which downgrades to 'withdrawn').
  const soldHit = findFirst(h, SOLD_HINT_FRAGMENTS) ?? findFirst(h, JSONLD_OFF_MARKET);
  if (soldHit) {
    return {
      outcome: "off_market_sold_hint",
      reason: "unverified_assumed_off",
      matched: soldHit,
      http_status: status,
      parser,
      notes: `page indicates sold; not promoted to status='sold' without sales_transactions match`,
    };
  }

  const underContractHit = findFirst(h, UNDER_CONTRACT_FRAGMENTS);
  if (underContractHit) {
    return {
      outcome: "off_market",
      reason: "withdrawn",
      matched: underContractHit,
      http_status: status,
      parser,
      notes: "page indicates listing is under contract / sale pending",
    };
  }

  const offMarketHit = findFirst(h, OFF_MARKET_GENERIC);
  if (offMarketHit) {
    return {
      outcome: "off_market",
      reason: "withdrawn",
      matched: offMarketHit,
      http_status: status,
      parser,
      notes: `page indicates listing is no longer available: '${offMarketHit}'`,
    };
  }

  // Page returned cleanly and we found no off-market markers. Treat as
  // still_available — even without an active marker, a clean 200 from a
  // listing site is the strongest signal we have without rendering JS.
  const activeHit = findFirst(h, ACTIVE_FRAGMENTS);
  return {
    outcome: "still_available",
    matched: activeHit ?? undefined,
    http_status: status,
    parser,
    notes: activeHit
      ? `page accessible with active markers ('${activeHit}')`
      : "page accessible, no off-market markers found",
  };
}

// ── Per-site parsers ────────────────────────────────────────────────────────
//
// Each parser starts from the generic classifier and may layer site-specific
// adjustments on top. CoStar in particular sends a 200 with a redirect to
// the search results when a property is no longer listed; that's the
// "page accessible, no off-market markers found" branch from above, which
// would (incorrectly) classify it as still_available. The CoStar parser
// detects the redirect-to-search fingerprint and downgrades to off_market.

function parseCrexi(html: string, finalUrl: string, status: number): ParseResult {
  // CREXi keeps the listing slug in the URL; if we get redirected to /
  // or /properties (the search shell), the listing is gone.
  const u = finalUrl.toLowerCase();
  if (status >= 200 && status < 400) {
    if (
      /\/$/.test(u) ||
      /\/properties\/?$/.test(u) ||
      /\/search\b/.test(u) ||
      /\/sale\/?$/.test(u)
    ) {
      return {
        outcome: "off_market",
        reason: "withdrawn",
        matched: `redirect-to-search:${u}`,
        http_status: status,
        parser: "crexi",
        notes: "CREXi redirected to a non-listing URL — listing slug invalid",
      };
    }
  }
  return classifyByMarkers(html, status, "crexi");
}

function parseCoStar(html: string, finalUrl: string, status: number): ParseResult {
  // CoStar returns 200 with the search shell when a listing is removed;
  // the URL morphs to /Property-For-Sale-or-Lease/... (the search index)
  // or to /search.
  const u = finalUrl.toLowerCase();
  if (status >= 200 && status < 400) {
    if (/\/search\b/.test(u) || /\bsearch-result/.test(u)) {
      return {
        outcome: "off_market",
        reason: "withdrawn",
        matched: `costar-redirect-to-search:${u}`,
        http_status: status,
        parser: "costar",
        notes: "CoStar redirected to search index — listing slug invalid",
      };
    }
  }
  return classifyByMarkers(html, status, "costar");
}

function parseLoopNet(html: string, finalUrl: string, status: number): ParseResult {
  // LoopNet uses banners like "This Listing Is No Longer Available" and
  // status pills "Sold", "Under Contract", "Withdrawn" inside a <ng-...>
  // wrapper. The generic classifier already catches the banner text;
  // LoopNet-specific layer is the "results page with no listing card"
  // fingerprint when a slug 404s.
  const u = finalUrl.toLowerCase();
  if (status >= 200 && status < 400) {
    if (/loopnet\.com\/?$/.test(u) || /\/search\b/.test(u)) {
      return {
        outcome: "off_market",
        reason: "withdrawn",
        matched: `loopnet-redirect-to-search:${u}`,
        http_status: status,
        parser: "loopnet",
        notes: "LoopNet redirected to search — listing slug invalid",
      };
    }
  }
  return classifyByMarkers(html, status, "loopnet");
}

function selectParser(host: string): (html: string, finalUrl: string, status: number) => ParseResult {
  const h = host.toLowerCase();
  if (h.endsWith("crexi.com") || h === "crexi.com") return parseCrexi;
  if (h.endsWith("costar.com") || h === "costar.com") return parseCoStar;
  if (h.endsWith("loopnet.com") || h === "loopnet.com") return parseLoopNet;
  return (html, _u, status) => classifyByMarkers(html, status, "generic");
}

export function parseListing(
  html: string,
  finalUrl: string,
  status: number,
): ParseResult {
  let host = "";
  try {
    host = new URL(finalUrl).host;
  } catch {
    host = "";
  }
  const result = selectParser(host)(html, finalUrl, status);
  // Attach a marketing-start receipt when the page (2xx/3xx) exposes one. We
  // skip it on error/bot-block responses — there's no trustworthy body there.
  if (status >= 200 && status < 400) {
    const start = extractMarketingStartDate(html);
    if (start) {
      result.listed_on = start.date;
      result.listed_on_marker = start.marker;
    }
  }
  return result;
}

export const _internals = {
  classifyByMarkers,
  detectBotBlock,
  selectParser,
  OFF_MARKET_GENERIC,
  SOLD_HINT_FRAGMENTS,
  UNDER_CONTRACT_FRAGMENTS,
  ACTIVE_FRAGMENTS,
};
