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
//   slug     — the tenant name appeared ONLY in the URL path/slug     -> review
//              (a weaker signal than a real title/body mention: slugs are
//               auto-generated, truncatable, and occasionally misleading, so a
//               slug-only hit is capped BELOW the auto threshold and always
//               routes to review; a combined signal — slug + city/state — can
//               push it over)
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
//
// `slug` (a tenant named ONLY in the URL path) sits BETWEEN keyword and alias:
// higher than a generic keyword (it identified a real tenant) but lower than a
// title/body mention (a slug is a weaker, occasionally-misleading source). Tuned
// so a slug-ONLY hit stays under the 0.7 auto threshold even with the
// always-present article_url bonus (0.65 + 0.03 = 0.68 -> review), while a
// combined signal (slug + city/state) crosses it (0.65 + 0.05 + 0.03 = 0.73 ->
// auto). CHOICE FLAG: these two values (base 0.65 / ceil 0.75) are the tunable
// slug tier — revisit against real slug-match false-positive/negative rates as
// more mobile-share volume comes through.
const MATCH_BASE = { exact: 0.85, alias: 0.78, slug: 0.65, keyword: 0.5, none: 0.2 };
const MATCH_CEIL = { exact: 0.98, alias: 0.92, slug: 0.75, keyword: 0.65, none: 0.4 };

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

// Reduce a URL to the human-readable text of its path/slug (the portion AFTER
// the domain), for tracked-tenant scanning. A real https URL yields its
// `/path?query#fragment` tail (percent-decoded); a non-http / bare-host / empty
// value yields "" (nothing to scan). Hyphens/underscores/slashes need no special
// handling here — `norm()` collapses every non-alphanumeric run to a space, so
// `new-net-lease-opportunity-davita-dialysis-share-…` normalizes to
// `new net lease opportunity davita dialysis share …` and phrase-matches cleanly.
export function urlSlugText(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const m = /^https?:\/\/[^/]+(\/[^\s]*)?$/i.exec(raw);
  if (!m) return "";              // not an http(s) URL (e.g. about:blank) — no slug
  let tail = m[1] || "";          // path (+ ?query #fragment), or "" for a bare host
  try { tail = decodeURIComponent(tail); } catch { /* keep raw on malformed % */ }
  return tail;
}

// Grade a single normalized haystack against the watchlist rules. Returns the
// STRONGEST match { tenant, domain, match_kind, matched } or null.
// Preference: exact tenant name > alias > loose keyword.
function bestMatchOver(haystack, rules) {
  if (haystack.trim() === "") return null;

  let bestAlias = null;
  let keywordHit = null;

  for (const { domain, name, aliases, keywords } of rules) {
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

/**
 * Grade how directly the given text matches a tracked tenant.
 * Accepts an array of text fragments (tenant field, subject, body snippet).
 * Returns the STRONGEST match { tenant, domain, match_kind, matched } or null.
 *
 * When `options.url` is supplied and the CONTENT parts produced no explicit
 * tenant name (only a keyword, or nothing), the URL path/slug is scanned as a
 * FALLBACK. A tenant named only in the slug is returned as `match_kind:'slug'`
 * — a LOWER confidence tier than a title/body mention (see MATCH_BASE/CEIL): it
 * cannot auto-create on its own but a combined signal can push it over. A strong
 * content mention (exact/alias) always wins over the slug; a keyword-only slug
 * hit is NOT promoted (a generic domain word in a URL adds nothing over a content
 * keyword). No `url` ⇒ byte-identical to the pre-slug behavior.
 */
export function matchTenant(textParts, watchlist, options = {}) {
  const rules = watchlistRules(watchlist);
  const parts = Array.isArray(textParts) ? textParts : [textParts];
  const contentMatch = bestMatchOver(norm(parts.filter(Boolean).join(" ")), rules);

  // A real title/body tenant mention is the strongest signal — it always wins.
  if (contentMatch && (contentMatch.match_kind === "exact" || contentMatch.match_kind === "alias")) {
    return contentMatch;
  }

  // Fallback: the tenant may be named only in the URL slug. Promote an exact/alias
  // slug hit to the weaker `slug` tier (a named tenant beats a content keyword).
  const slugMatch = bestMatchOver(norm(urlSlugText(options.url)), rules);
  if (slugMatch && (slugMatch.match_kind === "exact" || slugMatch.match_kind === "alias")) {
    return {
      tenant: slugMatch.tenant,
      domain: slugMatch.domain,
      match_kind: "slug",
      matched: slugMatch.matched,
      via: "url_slug",
      slug_source_kind: slugMatch.match_kind, // exact | alias — how the slug matched
    };
  }

  // Otherwise keep the weaker content signal (keyword) if any, else null.
  return contentMatch;
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

  // Resolve the article link FIRST so its slug is available to matchTenant as a
  // fallback signal (the publisher URL slug often names the tenant even when the
  // html2text headline is truncated / generic).
  const { article_url, article_title, summary } = extractArticle(body, subjTerm);

  const match = matchTenant([subjTerm, subj, body.slice(0, 4000)], watchlist, { url: article_url });
  const tenant_name = (match && match.tenant) || (subjTerm ? subjTerm.trim() : null);

  // Location: first "City, ST" in the body — 1-3 Title-Case words directly
  // before the comma (so "...center in Dallas, TX" yields "Dallas", not the
  // whole phrase, and internal caps like "DaVita" are not mistaken for a city).
  const loc = body.match(/\b([A-Z][a-z.\-']+(?:\s+[A-Z][a-z.\-']+){0,2}),\s*([A-Z]{2})\b/);
  const city = loc ? loc[1].trim() : null;
  const state = loc ? loc[2].trim() : null;

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
