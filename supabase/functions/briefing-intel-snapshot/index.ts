// ============================================================================
// Briefing Intel Snapshot — Edge Function
// Life Command Center — Executive Briefing v2
//
// Runs once each weekday morning (cron 5:30 AM America/Chicago) and once on
// Friday after market close (Friday deep-dive variant). Builds a single
// briefing_intel_snapshot row in LCC Opps containing:
//
//   - market_data    (yields, indices, REITs, commodities — from Yahoo Finance)
//   - key_numbers    (top 6 metrics rendered as cards in the email header)
//   - fed_outlook    (EFFR baseline + implied Fed path)
//   - sector_news    (RSS feeds, grouped by stream)
//   - reading_list   (curated long-form picks)
//   - analyst_take   (Claude-generated narrative)
//   - capital_markets (Claude-generated capital markets sub-narrative)
//   - weekly_changes (Friday variant only)
//
// The /api/briefing-email handler reads today's row and renders the email.
// If this function fails (or hasn't landed yet), the handler degrades
// gracefully — macro/news sections are skipped, internal LCC sections still
// render.
//
// Routes:
//   GET  /functions/v1/briefing-intel-snapshot?dry_run=1   — preview JSON
//   POST /functions/v1/briefing-intel-snapshot             — write snapshot
//   POST /functions/v1/briefing-intel-snapshot?variant=friday_deep_dive
//
// Required env:
//   OPS_SUPABASE_URL, OPS_SUPABASE_SERVICE_KEY
//   ANTHROPIC_API_KEY      (optional — without it, analyst_take is null)
//   ANTHROPIC_MODEL        (optional — defaults to claude-sonnet-4-6)
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// ---------------------------------------------------------------------------
// CORS helpers (inlined from ../_shared/cors.ts so this function deploys as
// a single file — keeps the Supabase MCP / CLI deploy path simple).
// ---------------------------------------------------------------------------

const FRONTEND_URL = Deno.env.get("VERCEL_FRONTEND_URL")
  || Deno.env.get("LCC_BASE_URL")
  || "https://tranquil-delight-production-633f.up.railway.app";
const ALLOWED_ORIGINS: string[] = [
  FRONTEND_URL,
  "https://tranquil-delight-production-633f.up.railway.app",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : FRONTEND_URL;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-LCC-Workspace, X-LCC-Key, X-PA-Webhook-Secret, X-LCC-User-Id, X-LCC-User-Email",
    "Access-Control-Max-Age": "86400",
  };
}

function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      ...(extraHeaders || {}),
    },
  });
}

function errorResponse(req: Request, message: string, status = 400): Response {
  return jsonResponse(req, { error: message }, status);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OPS_URL = Deno.env.get("OPS_SUPABASE_URL") || "";
const OPS_KEY = Deno.env.get("OPS_SUPABASE_SERVICE_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const ANTHROPIC_MODEL   = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";
// LCC custom API key — pg_cron's lcc_cron_post(...,'edge') passes this as
// Authorization: Bearer <key>. We deploy with verify_jwt=false (matches the
// availability-checker pattern) and do our own bearer check against this
// env var. The service-role key is also accepted so an operator can curl
// the function directly with their Supabase admin token.
const LCC_API_KEY = Deno.env.get("LCC_API_KEY") || "";

function isAuthorized(req: Request): boolean {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const token = m[1].trim();
  if (!token) return false;
  if (LCC_API_KEY && token === LCC_API_KEY) return true;
  if (OPS_KEY && token === OPS_KEY)         return true;
  return false;
}

// Yahoo Finance ticker map. Yields are ^XXX series; everything else is the
// raw ticker. The chart API returns OHLC for an arbitrary range.
const YIELD_TICKERS = [
  { sym: "^TNX",  label: "10Y Treasury", unit: "%" },
  { sym: "^FVX",  label: "5Y Treasury",  unit: "%" },
  { sym: "^IRX",  label: "3M T-Bill",    unit: "%" },
  { sym: "^TYX",  label: "30Y Treasury", unit: "%" },
];
const INDEX_TICKERS = [
  { sym: "^GSPC", label: "S&P 500" },
  { sym: "^DJI",  label: "Dow Jones" },
  { sym: "^IXIC", label: "Nasdaq" },
];
// Net-lease and healthcare REITs — used in the REIT table.
const REIT_TICKERS = [
  { sym: "O",   label: "Realty Income (O)" },
  { sym: "NNN", label: "NNN REIT" },
  { sym: "ADC", label: "Agree Realty" },
  { sym: "EPRT", label: "Essential Properties" },
];
// Tenant stocks to watch.
const TENANT_TICKERS = [
  { sym: "DVA", label: "DaVita" },
  { sym: "FMS", label: "Fresenius" },
];
const COMMODITY_TICKERS = [
  { sym: "CL=F", label: "WTI Crude" },
  { sym: "GC=F", label: "Gold" },
];

// RSS feeds grouped by stream. Keep concise — 3-5 per stream is enough.
const RSS_FEEDS: Record<string, { url: string; source: string }[]> = {
  healthcare: [
    { source: "Healio (Nephrology)", url: "https://www.healio.com/rss/site/nephrology" },
    { source: "CMS Newsroom",        url: "https://www.cms.gov/about-cms/contact/newsroom/press-releases/rss.xml" },
    { source: "Modern Healthcare",   url: "https://www.modernhealthcare.com/rss/all" },
  ],
  government: [
    { source: "GSA News",        url: "https://www.gsa.gov/about-us/newsroom/news-releases/rss" },
    { source: "Government Executive", url: "https://www.govexec.com/rss/all/" },
  ],
  net_lease: [
    { source: "GlobeSt",          url: "https://www.globest.com/feed/" },
    { source: "Bisnow National",  url: "https://www.bisnow.com/rss" },
    { source: "Commercial Observer", url: "https://commercialobserver.com/feed/" },
  ],
  tax_policy: [
    { source: "Tax Foundation",   url: "https://taxfoundation.org/feed/" },
  ],
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function ctDateIso(): string {
  // YYYY-MM-DD in America/Chicago
  const ctNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return ctNow.toISOString().slice(0, 10);
}

function isFridayCt(): boolean {
  const ctNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return ctNow.getDay() === 5;
}

function fmtPct(v: number, digits = 2): string {
  return v.toFixed(digits) + "%";
}

function fmtBps(deltaPct: number): string {
  const bps = Math.round(deltaPct * 100);
  const sign = bps > 0 ? "+" : "";
  return `${sign}${bps} bps`;
}

function fmtChangePct(deltaPct: number, digits = 2): string {
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${deltaPct.toFixed(digits)}%`;
}

async function fetchJson<T = unknown>(url: string, timeoutMs = 6000): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "LCC-BriefingIntel/2.0" },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "LCC-BriefingIntel/2.0" },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Yahoo Finance — chart endpoint
//
// Returns close-of-day values for the last few sessions. We pull range=5d
// for delta calculations (Friday variant uses these for weekly changes).
// ---------------------------------------------------------------------------

interface QuoteResult {
  symbol:   string;
  label:    string;
  current:  number;
  prior:    number;     // prior-session close
  weekAgo:  number;     // ~5 sessions ago
  change_1d_pct: number;
  change_5d_pct: number;
  unit?:    string;
}

async function fetchQuote(sym: string, label: string, unit?: string): Promise<QuoteResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?interval=1d&range=10d&includePrePost=false`;
  const data = await fetchJson<any>(url);
  const result = data?.chart?.result?.[0];
  const closes: number[] = result?.indicators?.quote?.[0]?.close || [];
  // Drop nulls (holidays) and take the last 6 valid samples.
  const valid = closes.filter((v) => Number.isFinite(v));
  if (valid.length < 2) return null;
  const current = valid[valid.length - 1];
  const prior   = valid[valid.length - 2];
  const weekAgo = valid.length >= 6 ? valid[valid.length - 6] : valid[0];

  const change_1d_pct = ((current - prior) / prior) * 100;
  const change_5d_pct = ((current - weekAgo) / weekAgo) * 100;

  return { symbol: sym, label, current, prior, weekAgo, change_1d_pct, change_5d_pct, unit };
}

async function fetchMarketData(): Promise<{
  yields: any[]; indices: any[]; reits: any[]; tenants: any[]; commodities: any[];
}> {
  const all = [
    ...YIELD_TICKERS.map((t) => ({ ...t, group: "yields" })),
    ...INDEX_TICKERS.map((t) => ({ ...t, group: "indices" })),
    ...REIT_TICKERS.map((t) => ({ ...t, group: "reits" })),
    ...TENANT_TICKERS.map((t) => ({ ...t, group: "tenants" })),
    ...COMMODITY_TICKERS.map((t) => ({ ...t, group: "commodities" })),
  ];
  const results = await Promise.all(all.map((t) => fetchQuote(t.sym, t.label, (t as any).unit)));

  const buckets: Record<string, any[]> = { yields: [], indices: [], reits: [], tenants: [], commodities: [] };
  results.forEach((r, i) => {
    if (!r) return;
    const group = all[i].group;
    const isYield = group === "yields";
    // ^TNX / ^FVX / ^IRX / ^TYX from Yahoo's chart API are returned as
    // direct percent values (4.62 = 4.62%), NOT scaled by 10 the way the
    // /v6/finance/quote endpoint sometimes is. Use the raw value.
    const value = r.current;
    // bps delta: (currentPct - priorPct) * 100 = bps.
    const delta = isYield
      ? fmtBps(r.current - r.prior)
      : fmtChangePct(r.change_1d_pct);
    const delta_dir = (isYield ? r.current - r.prior : r.change_1d_pct) > 0 ? "up"
                    : (isYield ? r.current - r.prior : r.change_1d_pct) < 0 ? "down"
                    : "flat";
    buckets[group].push({
      label:     r.label,
      value:     isYield ? fmtPct(value, 2)
                : group === "indices" || group === "tenants" || group === "reits"
                  ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                  : value.toFixed(2),
      delta,
      delta_dir,
      raw_value: value,
      raw_change_1d_pct: isYield ? (r.current - r.prior) : r.change_1d_pct,
      raw_change_5d_pct: isYield ? (r.current - r.weekAgo) : r.change_5d_pct,
    });
  });
  return buckets as any;
}

// ---------------------------------------------------------------------------
// Key Numbers strip — the 6-metric cards in the email header
// ---------------------------------------------------------------------------

function buildKeyNumbers(market: any): any[] {
  const out: any[] = [];
  const find = (group: string, label: string) =>
    (market[group] || []).find((x: any) => x.label.startsWith(label));

  const tnx = find("yields", "10Y");
  if (tnx) out.push({ label: "10Y", value: tnx.value, delta: tnx.delta, delta_dir: tnx.delta_dir });

  const fvx = find("yields", "5Y");
  if (fvx) out.push({ label: "5Y", value: fvx.value, delta: fvx.delta, delta_dir: fvx.delta_dir });

  const sp = find("indices", "S&P");
  if (sp) out.push({ label: "S&P", value: sp.value, delta: sp.delta, delta_dir: sp.delta_dir });

  const o = find("reits", "Realty Income");
  if (o) out.push({ label: "O", value: o.value, delta: o.delta, delta_dir: o.delta_dir });

  const dva = find("tenants", "DaVita");
  if (dva) out.push({ label: "DVA", value: dva.value, delta: dva.delta, delta_dir: dva.delta_dir });

  const wti = find("commodities", "WTI");
  if (wti) out.push({ label: "WTI", value: wti.value, delta: wti.delta, delta_dir: wti.delta_dir });

  return out;
}

function buildWeeklyChanges(market: any): any[] {
  const groups = ["yields", "indices", "reits", "tenants", "commodities"];
  const rows: any[] = [];
  for (const g of groups) {
    for (const item of market[g] || []) {
      const c1d = item.raw_change_1d_pct != null
        ? (g === "yields" ? fmtBps(item.raw_change_1d_pct) : fmtChangePct(item.raw_change_1d_pct))
        : "";
      const c5d = item.raw_change_5d_pct != null
        ? (g === "yields" ? fmtBps(item.raw_change_5d_pct) : fmtChangePct(item.raw_change_5d_pct))
        : "";
      rows.push({ label: item.label, value: item.value, change_1d: c1d, change_5d: c5d });
    }
  }
  return rows.slice(0, 14);
}

// ---------------------------------------------------------------------------
// RSS parser — minimal, regex-based. RSS 2.0 + Atom 1.0.
// ---------------------------------------------------------------------------

interface NewsItem {
  title:        string;
  url:          string;
  published_at: string | null;
  source:       string;
  summary:      string | null;
}

function stripTags(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/\s+/g, " ")
          .trim();
}

function parseRss(xml: string, source: string): NewsItem[] {
  const out: NewsItem[] = [];
  const itemRegex = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  const matches = xml.match(itemRegex) || [];
  for (const item of matches.slice(0, 15)) {
    const title = item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const link =
      item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ||
      item.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const pub =
      item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ||
      item.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1] ||
      item.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1];
    const desc =
      item.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ||
      item.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1];
    if (!title || !link) continue;
    const cleanTitle = stripTags(title);
    const cleanDesc  = desc ? stripTags(desc).slice(0, 240) : null;
    let isoPub: string | null = null;
    if (pub) {
      const d = new Date(pub.trim());
      if (!isNaN(d.getTime())) isoPub = d.toISOString();
    }
    out.push({ title: cleanTitle, url: link.trim(), published_at: isoPub, source, summary: cleanDesc });
  }
  return out;
}

async function fetchSectorNews(): Promise<Record<string, NewsItem[]>> {
  const result: Record<string, NewsItem[]> = { healthcare: [], government: [], net_lease: [], tax_policy: [] };
  // Drop articles older than 72h so the briefing stays current.
  const cutoff = Date.now() - 72 * 3600 * 1000;

  await Promise.all(
    Object.entries(RSS_FEEDS).flatMap(([stream, feeds]) =>
      feeds.map(async (feed) => {
        const xml = await fetchText(feed.url);
        if (!xml) return;
        const items = parseRss(xml, feed.source);
        for (const it of items) {
          if (it.published_at && new Date(it.published_at).getTime() < cutoff) continue;
          result[stream].push(it);
        }
      }),
    ),
  );

  // Per-stream: dedupe by URL, sort by published_at desc, cap at 6.
  for (const stream of Object.keys(result)) {
    const seen = new Set<string>();
    result[stream] = result[stream]
      .filter((it) => { if (seen.has(it.url)) return false; seen.add(it.url); return true; })
      .sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""))
      .slice(0, 6);
  }

  return result;
}

// "What We're Reading" — pick longest summaries from net_lease + healthcare,
// plus any tax_policy item. Heuristic, but better than nothing.
function buildReadingList(news: Record<string, NewsItem[]>): any[] {
  const pool = [
    ...news.net_lease.map((n) => ({ ...n, _stream: "Net Lease" })),
    ...news.healthcare.map((n) => ({ ...n, _stream: "Healthcare" })),
    ...news.tax_policy.map((n) => ({ ...n, _stream: "Tax Policy" })),
  ];
  return pool
    .filter((p) => (p.summary?.length || 0) > 60)
    .sort((a, b) => (b.summary?.length || 0) - (a.summary?.length || 0))
    .slice(0, 5)
    .map((p) => ({
      title:         p.title,
      url:           p.url,
      source:        p.source,
      published_at:  p.published_at,
      why_it_matters: p.summary,
    }));
}

// ---------------------------------------------------------------------------
// Claude analyst's-take generator
// ---------------------------------------------------------------------------

interface AiResult {
  analyst_take:    string | null;
  capital_markets: string | null;
  tokens_in:       number;
  tokens_out:      number;
  model:           string;
  warnings:        string[];
}

async function generateAnalystTake(
  market: any,
  news: Record<string, NewsItem[]>,
  isFriday: boolean,
): Promise<AiResult> {
  const empty: AiResult = {
    analyst_take: null, capital_markets: null,
    tokens_in: 0, tokens_out: 0, model: ANTHROPIC_MODEL, warnings: [],
  };
  if (!ANTHROPIC_API_KEY) {
    empty.warnings.push("ANTHROPIC_API_KEY not set — skipped AI generation");
    return empty;
  }

  // Build a compact human-readable prompt input. We pre-format numbers
  // here so the model can't misread raw JSON. (Lesson from v5.3.)
  const marketBlock = [
    "RATES & YIELDS:",
    ...(market.yields || []).map((y: any) => `  ${y.label}: ${y.value} (${y.delta} 1d)`),
    "",
    "INDICES & COMMODITIES:",
    ...(market.indices || []).map((y: any) => `  ${y.label}: ${y.value} (${y.delta} 1d)`),
    ...(market.commodities || []).map((y: any) => `  ${y.label}: ${y.value} (${y.delta} 1d)`),
    "",
    "NET LEASE REITS:",
    ...(market.reits || []).map((y: any) => `  ${y.label}: ${y.value} (${y.delta} 1d)`),
    "",
    "TENANT STOCKS:",
    ...(market.tenants || []).map((y: any) => `  ${y.label}: ${y.value} (${y.delta} 1d)`),
  ].join("\n");

  const newsBlock = (Object.entries(news) as [string, NewsItem[]][])
    .map(([stream, items]) => {
      const lines = items.slice(0, 4).map((it) =>
        `  - [${it.source}] ${it.title}`,
      );
      return `${stream.toUpperCase()}:\n${lines.join("\n") || "  (no items)"}`;
    }).join("\n\n");

  const audience =
    "You are writing for a Northmarq net lease investment sales broker who covers " +
    "dialysis (DaVita/Fresenius), government-leased real estate (GSA/agency tenants), " +
    "and broader single-tenant net lease product. The reader needs to know what " +
    "moved overnight and what it means for their book today.";

  const fridayBoost = isFriday
    ? " This is the Friday Weekly Deep Dive — frame the week, not just the day. " +
      "Reference any meaningful 5-day moves and end with a forward look at the week ahead."
    : "";

  const prompt =
    `${audience}\n\nUse EXACT numbers from the data below. Do not invent figures. ` +
    `If a delta is +3 bps, say +3 bps — not 30 bps or 27 bps.${fridayBoost}\n\n` +
    `Write two separate sections in plain text, separated by a line containing only "---":\n\n` +
    `SECTION 1: Analyst's Take. 2-3 short paragraphs (each 2-3 sentences). ` +
    `Tie the macro picture (rates, Fed, equities) to net lease pricing dynamics and ` +
    `to the dialysis + government tenant story. Reference specific news items by name ` +
    `where they're material. Be direct; no hedging filler.\n\n` +
    `SECTION 2: Capital Markets. 1 short paragraph on where money is priced — CMBS ` +
    `spreads if any news, REIT performance, what cap rates are doing relative to the ` +
    `10Y. Keep it to 3-4 sentences max.\n\n` +
    `=== MARKET DATA ===\n${marketBlock}\n\n` +
    `=== TOP NEWS (last 72h) ===\n${newsBlock}\n\n` +
    `Begin Section 1 directly. Do not add headings or preamble.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: 1400,
        messages:   [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      empty.warnings.push(`Anthropic API ${r.status}: ${errText.slice(0, 200)}`);
      return empty;
    }
    const json = await r.json();
    const text: string = json.content?.[0]?.text || "";
    const tokens_in  = json.usage?.input_tokens || 0;
    const tokens_out = json.usage?.output_tokens || 0;
    const parts = text.split(/^---\s*$/m);
    const take = parts[0]?.trim() || null;
    const cm   = parts[1]?.trim() || null;
    return {
      analyst_take: take,
      capital_markets: cm,
      tokens_in, tokens_out,
      model: ANTHROPIC_MODEL,
      warnings: [],
    };
  } catch (err) {
    empty.warnings.push(`AI generation error: ${(err as Error).message}`);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Snapshot writer
// ---------------------------------------------------------------------------

async function writeSnapshot(row: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!OPS_URL || !OPS_KEY) {
    return { ok: false, error: "OPS_SUPABASE_URL/SERVICE_KEY not set" };
  }
  // Upsert on (as_of_date, workspace_id) — the unique index.
  const r = await fetch(`${OPS_URL}/rest/v1/briefing_intel_snapshot?on_conflict=as_of_date,workspace_id`, {
    method: "POST",
    headers: {
      "apikey":         OPS_KEY,
      "Authorization":  `Bearer ${OPS_KEY}`,
      "Content-Type":   "application/json",
      "Prefer":         "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { ok: false, error: `Supabase ${r.status}: ${t.slice(0, 400)}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function buildSnapshot(variant: "daily" | "friday_deep_dive"): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  // Parallel: market data + news
  const [market, news] = await Promise.all([
    fetchMarketData().catch((err) => {
      warnings.push(`market_data: ${(err as Error).message}`);
      return { yields: [], indices: [], reits: [], tenants: [], commodities: [] };
    }),
    fetchSectorNews().catch((err) => {
      warnings.push(`sector_news: ${(err as Error).message}`);
      return { healthcare: [], government: [], net_lease: [], tax_policy: [] };
    }),
  ]);

  const keyNumbers = buildKeyNumbers(market);
  const readingList = buildReadingList(news);
  const weeklyChanges = variant === "friday_deep_dive" ? buildWeeklyChanges(market) : [];

  // AI runs after data so the prompt has the freshest numbers and headlines.
  const ai = await generateAnalystTake(market, news, variant === "friday_deep_dive");
  warnings.push(...ai.warnings);

  // Counts for telemetry
  const sourceCounts = {
    yields:        (market.yields || []).length,
    indices:       (market.indices || []).length,
    reits:         (market.reits || []).length,
    tenants:       (market.tenants || []).length,
    commodities:   (market.commodities || []).length,
    news_total:    (news.healthcare.length + news.government.length +
                    news.net_lease.length + news.tax_policy.length),
    reading_items: readingList.length,
    runtime_ms:    Date.now() - startedAt,
  };

  return {
    as_of_date:      ctDateIso(),
    workspace_id:    null,    // global row
    variant,
    generated_at:    new Date().toISOString(),
    key_numbers:     keyNumbers,
    market_data:     market,
    fed_outlook:     {},       // future: pull Fed Funds futures
    analyst_take:    ai.analyst_take,
    capital_markets: ai.capital_markets,
    sector_news:     news,
    reading_list:    readingList,
    weekly_changes:  weeklyChanges,
    source_counts:   sourceCounts,
    ai_model:        ai.model,
    ai_tokens_in:    ai.tokens_in,
    ai_tokens_out:   ai.tokens_out,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// HTTP entry
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (!isAuthorized(req)) {
    return errorResponse(req, "Unauthorized: send Authorization: Bearer <LCC_API_KEY>", 401);
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const variantParam = url.searchParams.get("variant");
  const variant: "daily" | "friday_deep_dive" =
    variantParam === "friday_deep_dive"
      ? "friday_deep_dive"
      : (variantParam === "daily" ? "daily" : (isFridayCt() ? "friday_deep_dive" : "daily"));

  // GET = dry run only; POST = persist.
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse(req, "Use GET (dry-run) or POST (write).", 405);
  }
  if (req.method === "GET" && !dryRun) {
    return errorResponse(req, "GET requires ?dry_run=1. Use POST to persist.", 400);
  }

  let snapshot: Record<string, unknown>;
  try {
    snapshot = await buildSnapshot(variant);
  } catch (err) {
    return errorResponse(req, `buildSnapshot failed: ${(err as Error).message}`, 500);
  }

  if (req.method === "GET" || dryRun) {
    return jsonResponse(req, { ok: true, dry_run: true, snapshot });
  }

  const write = await writeSnapshot(snapshot);
  if (!write.ok) {
    return jsonResponse(req, {
      ok: false, error: write.error,
      snapshot_built: true,
      source_counts: snapshot.source_counts,
      warnings: snapshot.warnings,
    }, 500);
  }
  return jsonResponse(req, {
    ok: true,
    as_of_date: snapshot.as_of_date,
    variant: snapshot.variant,
    source_counts: snapshot.source_counts,
    ai_tokens_in: snapshot.ai_tokens_in,
    ai_tokens_out: snapshot.ai_tokens_out,
    warnings: snapshot.warnings,
  });
});
