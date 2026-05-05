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
  return selectParser(host)(html, finalUrl, status);
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
