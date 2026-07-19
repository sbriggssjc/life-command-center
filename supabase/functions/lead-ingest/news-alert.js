// ============================================================================
// news-alert.js — Google/News Alert classification + confidence gate (pure ESM)
//
// Google Alerts (from googlealerts-noreply@google.com) on new construction /
// new locations for tracked tenants are a CROSS-VERTICAL lead source: a hit can
// be dialysis, government, or net-lease. Unlike CREXi/LoopNet listing inquiries
// (every hit is a real for-sale inquiry), a news alert is only a lead when the
// article is about a tenant Scott actually tracks — so it runs a confidence gate
// before creating a lead.
//
// This module is PURE ESM (no Deno/Node APIs) so it is imported by BOTH the Deno
// edge function (lead-ingest/index.ts) AND the node test (test/news-alert.test.mjs)
// with no drift. All I/O (DB, env) lives in the handler.
//
// A match has a *kind* that drives the confidence gate:
//   exact    — the article names a tracked tenant (canonical name)   -> auto
//   alias    — the article names a known alias / DBA of a tenant      -> auto
//   keyword  — only a loose domain keyword matched (no tenant named)  -> review
//   none     — nothing recognizable matched                          -> review
//
// Domains: 'dialysis' | 'government' | 'netlease'.
// ============================================================================

// ── Seed watchlist ──────────────────────────────────────────────────────────
// domain -> { tenants: [{ name, aliases:[] }], keywords: [] }
// The handler may pass an override (parsed from TRACKED_TENANTS_JSON) so Scott
// maintains the real list without a code change; a missing/invalid override
// falls back to this seed.
export const DEFAULT_TRACKED_TENANTS = {
  dialysis: {
    tenants: [
      { name: "DaVita", aliases: ["DaVita Kidney Care", "DaVita Dialysis"] },
      { name: "Fresenius", aliases: ["Fresenius Medical Care", "Fresenius Kidney Care", "FMC"] },
      { name: "U.S. Renal Care", aliases: ["US Renal Care", "USRC"] },
      { name: "American Renal Associates", aliases: ["American Renal", "ARA"] },
      { name: "Satellite Healthcare", aliases: ["Satellite Dialysis"] },
      { name: "Dialysis Clinic Inc", aliases: ["DCI", "Dialysis Clinic, Inc."] },
    ],
    keywords: ["dialysis", "dialysis center", "kidney care center", "esrd clinic"],
  },
  government: {
    tenants: [
      { name: "Social Security Administration", aliases: ["SSA"] },
      { name: "Department of Veterans Affairs", aliases: ["VA", "Veterans Affairs", "VA clinic", "CBOC"] },
      { name: "Federal Bureau of Investigation", aliases: ["FBI"] },
      { name: "Internal Revenue Service", aliases: ["IRS"] },
      { name: "Department of Homeland Security", aliases: ["DHS"] },
      { name: "Drug Enforcement Administration", aliases: ["DEA"] },
      { name: "United States Department of Agriculture", aliases: ["USDA"] },
      { name: "General Services Administration", aliases: ["GSA"] },
      { name: "Customs and Border Protection", aliases: ["CBP"] },
      { name: "Federal Aviation Administration", aliases: ["FAA"] },
    ],
    keywords: ["gsa lease", "federal courthouse", "federal building", "government lease"],
  },
  netlease: {
    tenants: [
      { name: "Dollar General", aliases: ["DG Market"] },
      { name: "Dollar Tree", aliases: [] },
      { name: "Family Dollar", aliases: [] },
      { name: "Walgreens", aliases: [] },
      { name: "CVS", aliases: ["CVS Pharmacy", "CVS Health"] },
      { name: "Starbucks", aliases: [] },
      { name: "7-Eleven", aliases: ["7 Eleven", "Seven Eleven"] },
      { name: "O'Reilly Auto Parts", aliases: ["O'Reilly", "OReilly Auto Parts"] },
      { name: "AutoZone", aliases: [] },
      { name: "Take 5 Oil Change", aliases: ["Take 5", "Take Five Oil Change"] },
      { name: "Chase Bank", aliases: ["JPMorgan Chase"] },
      { name: "Chick-fil-A", aliases: ["Chick fil A"] },
    ],
    keywords: ["net lease", "single tenant net lease", "nnn lease"],
  },
};

// Confidence at/above which a news alert auto-creates a developer_unknown lead
// (caller archives the source email); below it -> needs_review, email left.
export const NEWS_ALERT_AUTO_THRESHOLD = 0.7;
export const NEWS_ALERT_DEDUP_DAYS = 90;

// Base confidence + per-kind ceiling: a loose keyword/none match can NEVER clear
// the auto threshold (so it always routes to the review queue).
const MATCH_BASE = { exact: 0.85, alias: 0.78, keyword: 0.5, none: 0.2 };
const MATCH_CEIL = { exact: 0.98, alias: 0.92, keyword: 0.65, none: 0.4 };

// ── Normalization ────────────────────────────────────────────────────────────
function norm(text) {
  if (!text) return " ";
  let t = String(text).toLowerCase();
  t = t.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? ` ${t} ` : " ";
}

function phraseIn(needle, haystackNorm) {
  const n = norm(needle).trim();
  if (!n) return false;
  return haystackNorm.includes(` ${n} `);
}

function watchlistRules(watchlist) {
  const wl = watchlist && typeof watchlist === "object" ? watchlist : DEFAULT_TRACKED_TENANTS;
  const rules = [];
  for (const [domain, cfg] of Object.entries(wl)) {
    const keywords = Array.isArray(cfg?.keywords) ? cfg.keywords.filter(Boolean) : [];
    for (const t of Array.isArray(cfg?.tenants) ? cfg.tenants : []) {
      if (!t?.name) continue;
      rules.push({
        domain,
        name: t.name,
        aliases: Array.isArray(t.aliases) ? t.aliases.filter(Boolean) : [],
        keywords,
      });
    }
  }
  return rules;
}

/**
 * Grade how directly the given text matches a tracked tenant.
 * Accepts an array of text fragments (tenant field, subject, body snippet).
 * Returns the STRONGEST match { tenant, domain, match_kind, matched } or null.
 * Preference: exact tenant name > alias > loose keyword.
 */
export function matchTenant(textParts, watchlist) {
  const parts = Array.isArray(textParts) ? textParts : [textParts];
  const haystack = norm(parts.filter(Boolean).join(" "));
  if (haystack.trim() === "") return null;

  let bestAlias = null;
  let keywordHit = null;

  for (const { domain, name, aliases, keywords } of watchlistRules(watchlist)) {
    if (phraseIn(name, haystack)) {
      return { tenant: name, domain, match_kind: "exact", matched: name };
    }
    if (!bestAlias) {
      for (const alias of aliases) {
        if (phraseIn(alias, haystack)) {
          bestAlias = { tenant: name, domain, match_kind: "alias", matched: alias };
          break;
        }
      }
    }
    if (!keywordHit) {
      for (const kw of keywords) {
        if (phraseIn(kw, haystack)) {
          keywordHit = { tenant: null, domain, match_kind: "keyword", matched: kw };
          break;
        }
      }
    }
  }
  return bestAlias || keywordHit;
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/**
 * Grade a news alert 0.0-1.0 for how directly it matches a tracked tenant.
 * Driven by the match KIND (exact/alias vs. a loose keyword), plus small
 * completeness bonuses. The per-kind ceiling guarantees a keyword/none match
 * can never clear the auto threshold.
 */
export function scoreNewsAlert(tenantMatch, extracted) {
  const kind = tenantMatch?.match_kind || "none";
  const base = MATCH_BASE[kind] ?? MATCH_BASE.none;
  const ceil = MATCH_CEIL[kind] ?? MATCH_CEIL.none;
  const ex = extracted || {};
  let bonus = 0;
  if (ex.city && ex.state) bonus += 0.05;
  if (ex.article_url) bonus += 0.03;
  const score = Math.min(base + bonus, ceil);
  return Math.round(Math.max(0, score) * 1000) / 1000;
}

/**
 * Map a confidence score to a routing decision.
 *   >= threshold -> auto-create a developer_unknown lead + archive the email
 *   <  threshold -> create needs_review, leave the email flagged
 */
export function routeNewsAlert(confidence, threshold = NEWS_ALERT_AUTO_THRESHOLD) {
  if (confidence != null && confidence >= threshold) {
    return { route: "auto", status: "developer_unknown", archive: true };
  }
  return { route: "review", status: "needs_review", archive: false };
}

// ── Google Alert parsing (deterministic — the edge function has no AI) ────────
function unwrapGoogleRedirect(url) {
  // Google Alert links wrap the destination in https://www.google.com/url?...&url=<ENCODED>
  const m = /[?&]url=([^&]+)/i.exec(url);
  if (m) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch {
      /* fall through */
    }
  }
  return url;
}

const URL_SKIP = [
  "google.com/alerts", "support.google.com", "policies.google", "accounts.google",
  "unsubscribe", "feedback", "mailto:", "myaccount.google",
];

function firstArticleUrl(rawBody) {
  const urls = String(rawBody || "").match(/https?:\/\/[^\s"'<>)]+/gi) || [];
  for (const raw of urls) {
    const url = unwrapGoogleRedirect(raw.replace(/[.,)]+$/, ""));
    const low = url.toLowerCase();
    if (URL_SKIP.some((s) => low.includes(s))) continue;
    return url;
  }
  return null;
}

/**
 * Extract the primary news story from a Google Alert (deterministic).
 * The confidence driver is the tracked-tenant match (matchTenant over
 * subject+body), so this only needs tenant hint / location / URL.
 */
export function parseGoogleAlert(rawBody, subject, watchlist) {
  const body = String(rawBody || "");
  const subj = String(subject || "");

  // Subject: "Google Alert - <term>"
  const subjTerm = (subj.replace(/^\s*(Fwd?|FW|RE):\s*/i, "")
    .match(/Google Alert(?:s)?\s*[-–:]\s*(.+)$/i) || [])[1] || null;

  const match = matchTenant([subjTerm, subj, body.slice(0, 4000)], watchlist);
  const tenant_name = (match && match.tenant) || (subjTerm ? subjTerm.trim() : null);

  // Location: first "City, ST" in the body — 1-3 Title-Case words directly
  // before the comma (so "...center in Dallas, TX" yields "Dallas", not the
  // whole phrase, and internal caps like "DaVita" are not mistaken for a city).
  const loc = body.match(/\b([A-Z][a-z.\-']+(?:\s+[A-Z][a-z.\-']+){0,2}),\s*([A-Z]{2})\b/);
  const city = loc ? loc[1].trim() : null;
  const state = loc ? loc[2].trim() : null;

  const article_url = firstArticleUrl(body);

  // Title/summary: first substantial text line (best-effort).
  const firstLine = body.split(/\r?\n/).map((l) => l.trim())
    .find((l) => l.length > 12 && !/^https?:\/\//i.test(l)) || null;

  return {
    tenant_name,
    city,
    state,
    article_url,
    article_title: firstLine,
    summary: firstLine,
    match,
  };
}

// Normalized dedup key for a tenant name (for the 90-day repost guard).
export function tenantDedupKey(tenant) {
  return norm(tenant).trim();
}
