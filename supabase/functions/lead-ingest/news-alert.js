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
//
// Google Alerts are HTML; Power Automate runs them through html2text before we
// see them, so `rawBody` is the plain-text rendering. The header logo <img> is
// rendered as a bracketed URL line, e.g.
//   [https://www.google.com/intl/en_us/alerts/logo.png?cd=...]
// followed by the alert term, a "Daily update ⋅ <date>" line, section headers,
// then the actual result items. Each result item's link is a
//   https://www.google.com/url?...&url=<ENCODED-PUBLISHER-URL>...
// redirect, and the headline is the anchor/text next to it. The parser must
// target that article link + headline, NOT the header logo (Bug: 2026-07-20 —
// article_url/title/summary were all capturing the logo image URL because the
// first URL in the body is the logo and the "skip lines starting with http"
// filter missed the bracket-wrapped logo line).
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

// A URL still on a Google-infrastructure host after redirect-unwrapping is
// chrome (the header logo image, alert settings, RSS, tracking) — never the
// article. A real article link is a google.com/url?...&url=<publisher> redirect,
// which unwrapGoogleRedirect turns into the publisher's (non-Google) URL.
function isGoogleInfraUrl(url) {
  return /^https?:\/\/([a-z0-9-]+\.)*(google\.com|gstatic\.com|googleusercontent\.com|goo\.gl)(?:[/?]|$)/i
    .test(url);
}

// URL match that stops at a closing bracket, so the html2text `[<url>]` wrapping
// (the logo line) doesn't fold the trailing "]" into the match.
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

// Resolve the first REAL article link in a plain-text Google Alert: the first
// URL that, after unwrapping the Google redirect, is not Google chrome. Returns
// { url, lineIdx } (lineIdx is the body line it was found on, for headline
// association) or null.
function findArticleUrl(lines) {
  for (let i = 0; i < lines.length; i++) {
    const urls = lines[i].match(URL_RE) || [];
    for (const raw of urls) {
      const url = unwrapGoogleRedirect(raw.replace(/[\].,)]+$/, ""));
      const low = url.toLowerCase();
      if (URL_SKIP.some((s) => low.includes(s))) continue;
      if (isGoogleInfraUrl(url)) continue;
      return { url, lineIdx: i };
    }
  }
  return null;
}

// Strip URLs + markdown/link scaffolding from a candidate headline line so we
// keep the human-readable text: `[Title](url)` -> `Title`, `Title (url)` ->
// `Title`, and a bare/bracketed URL -> "".
function cleanTitleText(s) {
  return String(s || "")
    .replace(/\[([^\]]+)\]\(\s*https?:[^)]*\)/gi, "$1") // [Title](url) -> Title
    .replace(/\(\s*https?:[^)]*\)/gi, " ")              // trailing (url)
    .replace(URL_RE, " ")                               // any bare url
    .replace(/[[\]]/g, " ")                             // stray brackets
    .replace(/\s+/g, " ")
    .trim();
}

// Is `line` Google-Alert chrome/boilerplate rather than an article headline?
function isChromeLine(line, subjTerm) {
  const s = String(line || "").trim();
  if (!s) return true;
  if (/^\[?\(?\s*https?:\/\//i.test(s)) return true;             // a (bracketed) URL line
  if (/alerts\/logo\.png/i.test(s)) return true;                  // header logo
  if (/^google\s+alerts?$/i.test(s)) return true;
  if (/^(daily|weekly)\s+update\b/i.test(s)) return true;         // "Daily update ⋅ <date>"
  if (/^(news|web|blogs?|videos?|books?|finance|scholar)\s*$/i.test(s)) return true; // section headers
  if (/^(flag as irrelevant|see more results|edit (this )?alert|delete (this )?alert|unsubscribe|rss|view all|see all)/i.test(s)) return true;
  if (subjTerm && s.toLowerCase() === subjTerm.trim().toLowerCase()) return true;   // the alert query heading
  return false;
}

// Extract the article headline + link. Prefers the anchor text on the same line
// as the article link, then the nearest preceding content line (the common
// "headline line, then link line" html2text layout), then the first content
// line anywhere, then the alert term as a last resort — but NEVER the logo/URL.
function extractArticle(rawBody, subjTerm) {
  const lines = String(rawBody || "").split(/\r?\n/).map((l) => l.trim());
  const found = findArticleUrl(lines);
  const article_url = found ? found.url : null;

  const isContent = (line) =>
    !isChromeLine(line, subjTerm) && /[A-Za-z]/.test(cleanTitleText(line));

  let title = null;
  if (found) {
    const sameLine = cleanTitleText(lines[found.lineIdx]); // anchor text beside the link
    if (sameLine.length > 3 && /[A-Za-z]/.test(sameLine)) title = sameLine;
    if (!title) {
      for (let i = found.lineIdx - 1; i >= 0; i--) {
        if (isContent(lines[i])) { title = cleanTitleText(lines[i]); break; }
      }
    }
  }
  if (!title) {
    const first = lines.find(isContent);
    if (first) title = cleanTitleText(first);
  }
  if (!title && subjTerm) title = subjTerm.trim();

  return { article_url, article_title: title || null, summary: title || null };
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

  const { article_url, article_title, summary } = extractArticle(body, subjTerm);

  return {
    tenant_name,
    city,
    state,
    article_url,
    article_title,
    summary,
    match,
  };
}

// Normalized dedup key for a tenant name (for the 90-day repost guard).
export function tenantDedupKey(tenant) {
  return norm(tenant).trim();
}
