// ============================================================================
// calendar-caldav-push (Cortex F4 / write-back layer #2) — the KEYSTONE.
// Reads the de-duplicated, registry-classified v_calendar_events_merged and
// writes each event into ONE canonical iCloud calendar ("Cortex") via CalDAV.
// That calendar then syncs natively to iPhone / Apple Calendar / Outlook /
// the LCC app / a dashboard — every surface shows the identical unified view
// with the same emoji+title formatting. No per-surface work.
//
// Idempotent: a ledger table (cortex_calendar_push) tracks what was written by
// content hash, so each run only PUTs changed events and DELETEs (tombstones)
// events that left the merged view. Authenticates AS Scott via the Apple
// app-specific password (same secrets as calendar-caldav-sync).
//
// Secrets:  APPLE_ID, APPLE_APP_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Env opt:  CORTEX_CAL_NAME (default "Cortex"), CORTEX_PUSH_DOMAINS (csv; default all)
// ============================================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPLE_ID = Deno.env.get("APPLE_ID") || "";
const APPLE_PW = Deno.env.get("APPLE_APP_PASSWORD") || "";
const AUTH = "Basic " + btoa(APPLE_ID + ":" + APPLE_PW);
const CAL_NAME = Deno.env.get("CORTEX_CAL_NAME") || "Cortex";
const DOMAIN_FILTER = (Deno.env.get("CORTEX_PUSH_DOMAINS") || "").split(",").map((s) => s.trim()).filter(Boolean);

// Per-domain colored iCloud calendars. iOS colors PER CALENDAR (not per event),
// so one calendar per domain = distinct colors that sync to iPhone/Mac/Outlook.
const DOMAIN_CALS: Record<string, { name: string; color: string }> = {
  business: { name: "Cortex – Work",     color: "#1BADF8FF" }, // blue
  family:   { name: "Cortex – Family",   color: "#34C759FF" }, // green
  coaching: { name: "Cortex – Coaching", color: "#FF9500FF" }, // orange
  personal: { name: "Cortex – Personal", color: "#AF52DEFF" }, // purple
  home:     { name: "Cortex – Home",     color: "#A2845EFF" }, // brown
  travel:   { name: "Cortex – Travel",   color: "#5AC8FAFF" }, // teal
};
const DEFAULT_CAL = { name: "Cortex – Other", color: "#8E8E93FF" }; // graphite
function calSpecForDomain(domain: string | null | undefined) {
  return (domain && DOMAIN_CALS[domain]) || DEFAULT_CAL;
}

// ---- CalDAV transport (mirrors calendar-caldav-sync: redirect-safe, ns-stripped) ----
async function dav(method: string, url: string, body?: string, depth = "0", extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { Authorization: AUTH, "User-Agent": "cortex-caldav-push/1.0", ...extra };
  if (body && !headers["Content-Type"]) headers["Content-Type"] = "application/xml; charset=utf-8";
  if (method === "PROPFIND" || method === "REPORT" || method === "MKCALENDAR") headers["Depth"] = depth;
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(target, { method, headers, body, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get("location"); await r.text();
      if (!loc) return { status: r.status, text: "", etag: null as string | null, finalUrl: target };
      target = loc.startsWith("http") ? loc : new URL(target).origin + loc;
      continue;
    }
    const etag = r.headers.get("etag");
    const text = (await r.text()).replace(/(<\/?)[A-Za-z][\w.-]*:/g, "$1");
    return { status: r.status, text, etag, finalUrl: target };
  }
  return { status: 508, text: "too many redirects", etag: null, finalUrl: target };
}
function rxAll(re: RegExp, s: string): string[] {
  const out: string[] = []; let m; while ((m = re.exec(s)) !== null) out.push(m[1]); return out;
}
async function rest(path: string, init?: RequestInit) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...init, headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("rest " + r.status + ": " + t);
  return t ? JSON.parse(t) : null;
}

// ---- locate (or create) the canonical "Cortex" calendar ----
async function homeUrl(): Promise<string> {
  let r = await dav("PROPFIND", "https://caldav.icloud.com/",
    `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`);
  const principal = rxAll(/current-user-principal[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/gi, r.text)[0];
  if (!principal) throw new Error("no principal (status " + r.status + ")");
  const origin = new URL(r.finalUrl || "https://caldav.icloud.com/").origin;
  const principalUrl = principal.startsWith("http") ? principal : origin + principal;
  r = await dav("PROPFIND", principalUrl,
    `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`);
  const home = rxAll(/calendar-home-set[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/gi, r.text)[0];
  if (!home) throw new Error("no calendar-home");
  return home.startsWith("http") ? home : new URL(principalUrl).origin + home;
}
// List every calendar in the home as {href, name}.
async function listCalendars(home: string): Promise<{ href: string; name: string }[]> {
  const r = await dav("PROPFIND", home,
    `<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`, "1");
  const origin = new URL(home).origin;
  const out: { href: string; name: string }[] = [];
  for (const b of r.text.split(/<response[ >]/i).slice(1)) {
    if (!/calendar\b/i.test(b)) continue;
    const href = (b.match(/<href[^>]*>([^<]+)<\/href>/i) || [])[1];
    const name = (b.match(/<displayname[^>]*>([^<]*)<\/displayname>/i) || [])[1];
    if (href && name) out.push({ href: href.startsWith("http") ? href : origin + href, name: name.trim() });
  }
  return out;
}
async function setCalendarColor(calUrl: string, color: string) {
  await dav("PROPPATCH", calUrl,
    `<d:propertyupdate xmlns:d="DAV:" xmlns:i="http://apple.com/ns/ical/"><d:set><d:prop>` +
    `<i:calendar-color>${color}</i:calendar-color></d:prop></d:set></d:propertyupdate>`);
}
// Find or create a calendar by display name; set its color. Cached per run.
const _calCache = new Map<string, string>();
async function findOrCreateCalendarByName(home: string, name: string, color?: string): Promise<string> {
  if (_calCache.has(name)) return _calCache.get(name)!;
  const cals = await listCalendars(home);
  let calUrl = cals.find((c) => c.name.toLowerCase() === name.toLowerCase())?.href;
  if (!calUrl) {
    const slug = "cortex-" + crypto.randomUUID().slice(0, 8);
    calUrl = home.replace(/\/$/, "") + "/" + slug + "/";
    const mk = await dav("MKCALENDAR", calUrl,
      `<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop>` +
      `<d:displayname>${name}</d:displayname>` +
      `<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>` +
      `</d:prop></d:set></c:mkcalendar>`);
    if (mk.status >= 400) throw new Error("MKCALENDAR '" + name + "' failed " + mk.status + ": " + mk.text.slice(0, 160));
    if (color) await setCalendarColor(calUrl, color);
  }
  _calCache.set(name, calUrl);
  return calUrl;
}
async function calForDomain(home: string, domain: string | null | undefined): Promise<string> {
  const spec = calSpecForDomain(domain);
  return await findOrCreateCalendarByName(home, spec.name, spec.color);
}

// ---- normalization: registry conventions -> one consistent title everywhere ----
function applyTemplate(tpl: string, row: Record<string, unknown>): string {
  const map: Record<string, string> = {
    summary: String(row.subject ?? "").trim(),
    emoji: String(row.emoji ?? "").trim(),
    sport: String(row.calendar_sport ?? "").trim(),
    kid: String(row.calendar_kid ?? "").trim(),
    location: String(row.location ?? "").trim(),
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? "").replace(/\s+/g, " ").trim();
}
// ---- content-aware title rules (config-driven, from cortex_title_rules) ----
type TitleRule = { priority: number; emoji: string | null; label: string | null; format: string; re: RegExp };
let RULES: TitleRule[] = [];
let KIDS: string[] = [];
async function loadTitleRules() {
  const rows: Record<string, unknown>[] = (await rest(
    "cortex_title_rules?select=kind,priority,pattern,emoji,label,format&active=eq.true&order=priority.desc")) || [];
  RULES = []; KIDS = [];
  for (const r of rows) {
    if (r.kind === "kids") { KIDS = String(r.pattern).split(",").map((s) => s.trim()).filter(Boolean); continue; }
    try { RULES.push({ priority: Number(r.priority), emoji: r.emoji as string, label: r.label as string, format: String(r.format), re: new RegExp(String(r.pattern), "i") }); } catch { /* skip bad regex */ }
  }
}
const TYPO: [RegExp, string][] = [[/\bleason\b/gi, "Lesson"], [/\bpracitce\b/gi, "Practice"], [/\blessson\b/gi, "Lesson"]];
function clean(s: string): string { let o = String(s ?? "").replace(/\s+/g, " ").trim(); for (const [re, rep] of TYPO) o = o.replace(re, rep); return o; }
function capFirst(s: string): string { return /[A-Za-z]/.test(s.charAt(0)) ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function detectKid(s: string): string | null { for (const k of KIDS) if (new RegExp("\\b" + k + "\\b", "i").test(s)) return k; return null; }
const SPORT_NOUNS = /\b(soccer|basketball|bball|football|baseball|tennis)\b/ig;

function normalizeTitle(row: Record<string, unknown>): string {
  const fallbackEmoji = String(row.emoji ?? "").trim();
  const cleaned = clean(String(row.subject ?? "")) || "(untitled)";

  // 1) AUTHORITATIVE registry template wins (e.g. TeamSnap "{emoji} {kid} soccer: {summary}"
  //    with kid from the registry, or business "{summary}"). Content rules must NOT override
  //    these — otherwise a TeamSnap "… - PDA" loses the kid (kid lives in the registry, not the title).
  if (row.title_template) {
    let body = applyTemplate(String(row.title_template), row) || cleaned;
    if (fallbackEmoji && !body.startsWith(fallbackEmoji)) body = fallbackEmoji + " " + body;
    return body.replace(/\s+/g, " ").trim();
  }

  // 2) content rule (for events with no registry template — manual/shared-calendar entries)
  const rule = RULES.find((r) => r.re.test(cleaned));
  if (rule) {
    const kid = detectKid(cleaned) || (row.calendar_kid ? String(row.calendar_kid) : null);
    if (rule.format === "kid_sport") {
      let detail = cleaned;
      if (kid) detail = detail.replace(new RegExp("\\b" + kid + "\\b", "ig"), " ");
      detail = detail.replace(SPORT_NOUNS, " ").replace(/\s+/g, " ").replace(/^[\s\-:–]+/, "").trim();
      const head = (kid ? kid + " " : "") + (rule.label || "");
      return (rule.emoji + " " + capFirst(head.trim()) + (detail ? ": " + capFirst(detail) : "")).trim();
    }
    if (rule.format === "kid_activity") {
      let detail = cleaned;
      if (kid) detail = detail.replace(new RegExp("\\b" + kid + "\\b", "ig"), " ").replace(/\s+/g, " ").trim();
      detail = detail.replace(/^[\s\-:–]+/, "").trim();
      return (rule.emoji + " " + (kid ? kid + " " : "") + capFirst(detail || rule.label || "")).trim();
    }
    return (rule.emoji + " " + cleaned).trim(); // plain
  }

  // 3) fallback -> domain emoji + cleaned subject
  let body = cleaned;
  if (fallbackEmoji && !body.startsWith(fallbackEmoji)) body = fallbackEmoji + " " + body;
  return body;
}

// ---- ICS building ----
function esc(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function utcStamp(d: Date): string { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function dateOnly(d: Date): string { return d.toISOString().slice(0, 10).replace(/-/g, ""); }
function fold(line: string): string {
  // RFC5545 75-octet folding (approx by chars; ASCII content here)
  if (line.length <= 73) return line;
  const parts: string[] = []; let i = 0;
  while (i < line.length) { parts.push((i === 0 ? "" : " ") + line.slice(i, i + 73)); i += 73; }
  return parts.join("\r\n");
}
function buildICS(row: Record<string, unknown>, uid: string): string {
  const allDay = !!row.is_all_day;
  const start = new Date(String(row.start_time));
  const end = row.end_time ? new Date(String(row.end_time)) : new Date(start.getTime() + 60 * 60 * 1000);
  const title = normalizeTitle(row);
  const L: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cortex//write-back//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + utcStamp(new Date()),
  ];
  if (allDay) {
    const endD = row.end_time ? end : new Date(start.getTime() + 864e5);
    L.push("DTSTART;VALUE=DATE:" + dateOnly(start));
    L.push("DTEND;VALUE=DATE:" + dateOnly(endD));
  } else {
    L.push("DTSTART:" + utcStamp(start));
    L.push("DTEND:" + utcStamp(end));
  }
  L.push("SUMMARY:" + esc(title));
  if (row.location) L.push("LOCATION:" + esc(String(row.location)));
  if (row.cortex_domain) L.push("CATEGORIES:" + esc(String(row.cortex_domain)));
  L.push("X-CORTEX-SOURCE:" + esc(String(row.canonical_source ?? "")));
  L.push("X-CORTEX:1");
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

function stableSig(row: Record<string, unknown>, uid: string): string {
  // Change-detection signature: ONLY meaningful fields (NOT DTSTAMP/now), so an
  // unchanged event hashes identically every run -> no needless re-PUT.
  return [uid, normalizeTitle(row), String(row.start_time ?? ""), String(row.end_time ?? ""),
          row.is_all_day ? "1" : "0", String(row.location ?? ""), String(row.cortex_domain ?? "")].join("|");
}
async function hashOf(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function uidFor(eventId: string): string {
  return "cortex-" + eventId.replace(/[^A-Za-z0-9_.@-]/g, "_") + "@cortex";
}

async function run(dryRun: boolean, limit = 0, ORDER_ASC = false) {
  const home = await homeUrl();
  await loadTitleRules(); // content-aware title normalization (config-driven)

  // desired set
  let q = "v_calendar_events_merged?select=id,subject,start_time,end_time,location,is_all_day,cortex_domain,calendar_sport,calendar_kid,emoji,color,title_template,canonical_source&order=start_time." + (ORDER_ASC ? "asc" : "desc");
  if (DOMAIN_FILTER.length) q += "&cortex_domain=in.(" + DOMAIN_FILTER.map(encodeURIComponent).join(",") + ")";
  if (limit > 0) q += "&limit=" + limit;
  const rows: Record<string, unknown>[] = (await rest(q)) || [];

  // ledger (live rows)
  const ledger: Record<string, unknown>[] = (await rest("cortex_calendar_push?select=event_id,uid,href,content_hash,deleted_at")) || [];
  const ledgerBy = new Map<string, Record<string, unknown>>();
  for (const l of ledger) ledgerBy.set(String(l.event_id), l);

  const res = { calendars: {} as Record<string, string>, total: rows.length, created: 0, updated: 0, unchanged: 0, moved: 0, deleted: 0, errors: [] as string[] };
  const desiredIds = new Set<string>();

  for (const row of rows) {
    const eventId = String(row.id);
    desiredIds.add(eventId);
    const uid = uidFor(eventId);
    const ics = buildICS(row, uid);
    const hash = await hashOf(stableSig(row, uid));
    const prev = ledgerBy.get(eventId);
    const title = normalizeTitle(row);
    // target calendar for this event's domain
    const targetCal = await calForDomain(home, row.cortex_domain as string | null);
    res.calendars[calSpecForDomain(row.cortex_domain as string).name] = targetCal;
    const inRightCal = !!prev?.href && String(prev.href).startsWith(targetCal);
    if (prev && prev.deleted_at == null && prev.content_hash === hash && inRightCal) { res.unchanged++; continue; }
    if (dryRun) { prev ? res.updated++ : res.created++; continue; }
    const href = inRightCal ? (prev!.href as string) : (targetCal.replace(/\/$/, "") + "/" + uid + ".ics");
    try {
      // Migrating to a different (domain) calendar: delete the old resource first.
      if (prev?.href && !inRightCal) { try { await dav("DELETE", String(prev.href), undefined, "0"); res.moved++; } catch { /* ignore */ } }
      // iCloud throttles bulk writes with 503/429 — retry with backoff so cron converges quietly.
      let put = await dav("PUT", href, ics, "0", { "Content-Type": "text/calendar; charset=utf-8" });
      for (let attempt = 0; (put.status === 503 || put.status === 429) && attempt < 4; attempt++) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        put = await dav("PUT", href, ics, "0", { "Content-Type": "text/calendar; charset=utf-8" });
      }
      if (put.status >= 400) { res.errors.push(eventId + ": PUT " + put.status); continue; }
      await rest("cortex_calendar_push?on_conflict=event_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ event_id: eventId, uid, href, etag: put.etag, content_hash: hash, title, cortex_domain: row.cortex_domain ?? null, pushed_at: new Date().toISOString(), deleted_at: null }]),
      });
      prev ? res.updated++ : res.created++;
    } catch (e) { res.errors.push(eventId + ": " + String((e as Error).message)); }
  }

  // tombstone: ONLY on a full sweep — a limited/filtered run has an artificially
  // small desired set and must never delete events outside its window.
  const fullSweep = limit === 0 && DOMAIN_FILTER.length === 0;
  for (const l of (fullSweep ? ledger : [])) {
    if (l.deleted_at != null) continue;
    const id = String(l.event_id);
    if (desiredIds.has(id)) continue;
    if (dryRun) { res.deleted++; continue; }
    try {
      if (l.href) await dav("DELETE", String(l.href), undefined, "0");
      await rest("cortex_calendar_push?event_id=eq." + encodeURIComponent(id), {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
      res.deleted++;
    } catch (e) { res.errors.push(id + " (del): " + String((e as Error).message)); }
  }
  return res;
}

Deno.serve(async (req: Request) => {
  if (!APPLE_ID || !APPLE_PW) return Response.json({ ok: false, error: "APPLE_ID / APPLE_APP_PASSWORD not set" }, { status: 400 });
  const url = new URL(req.url);
  try {
    if (req.method === "GET" && url.searchParams.get("probe") === "1") {
      const home = await homeUrl();
      const cals = await listCalendars(home);
      return Response.json({ service: "calendar-caldav-push", domain_calendars: DOMAIN_CALS, existing: cals.map((c) => c.name) });
    }
    // Admin: preview before/after normalized titles WITHOUT writing.
    if (req.method === "GET" && url.searchParams.get("preview") === "1") {
      await loadTitleRules();
      const n = parseInt(url.searchParams.get("n") || "30", 10) || 30;
      const filt = url.searchParams.get("source"); // optional canonical_source filter
      let q = "v_calendar_events_merged?select=subject,emoji,title_template,calendar_sport,calendar_kid,cortex_domain,canonical_source,start_time&order=start_time.desc&limit=" + n;
      if (filt) q += "&canonical_source=eq." + encodeURIComponent(filt);
      const rows: Record<string, unknown>[] = (await rest(q)) || [];
      return Response.json({ ok: true, kids: KIDS, rules: RULES.length,
        items: rows.map((r) => ({ raw: r.subject, normalized: normalizeTitle(r), source: r.canonical_source })) });
    }
    // Admin: list event summaries in a named calendar (to inspect leftovers safely).
    if (req.method === "GET" && url.searchParams.get("inspect")) {
      const want = String(url.searchParams.get("inspect")).toLowerCase();
      const home = await homeUrl();
      const cals = await listCalendars(home);
      const cal = cals.find((c) => c.name.trim().toLowerCase() === want);
      if (!cal) return Response.json({ ok: false, error: "no calendar named " + want });
      const rep = await dav("REPORT", cal.href,
        `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop>` +
        `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`, "1");
      const datas = rxAll(/<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/gi, rep.text)
        .map((d) => d.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      const items = datas.map((d) => ({
        summary: (d.match(/SUMMARY:(.+)/) || [])[1]?.trim(),
        dtstart: (d.match(/DTSTART[^:]*:(.+)/) || [])[1]?.trim(),
        uid: (d.match(/UID:(.+)/) || [])[1]?.trim(),
      }));
      return Response.json({ ok: true, calendar: cal.name, count: items.length, items });
    }
    // Admin: delete a named calendar outright (post-migration cleanup of the legacy "Cortex").
    if (req.method === "GET" && url.searchParams.get("retire_force")) {
      const want = String(url.searchParams.get("retire_force")).toLowerCase();
      const home = await homeUrl();
      const cals = await listCalendars(home);
      const cal = cals.find((c) => c.name.trim().toLowerCase() === want);
      if (!cal) return Response.json({ ok: false, error: "no calendar named " + want });
      const del = await dav("DELETE", cal.href, undefined, "0");
      return Response.json({ ok: del.status < 400, calendar: cal.name, status: del.status });
    }
    // Admin: delete the legacy single "Cortex" calendar once it's empty (post-migration).
    if (req.method === "GET" && url.searchParams.get("retire_empty") === "1") {
      const home = await homeUrl();
      const cals = await listCalendars(home);
      const out: string[] = [];
      for (const c of cals) {
        if (c.name.trim().toLowerCase() !== CAL_NAME.toLowerCase()) continue; // only the bare legacy "Cortex"
        const rep = await dav("REPORT", c.href,
          `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop>` +
          `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`, "1");
        const count = (rep.text.match(/<response[ >]/gi) || []).length;
        if (count === 0) { const del = await dav("DELETE", c.href, undefined, "0"); out.push(c.name + " -> DELETE " + del.status); }
        else out.push(c.name + " -> kept (" + count + " events)");
      }
      return Response.json({ ok: true, retired: out });
    }
    const dryRun = url.searchParams.get("dry") === "1";
    const limit = parseInt(url.searchParams.get("limit") || "0", 10) || 0;
    const asc = url.searchParams.get("oldest") === "1";
    const out = await run(dryRun, limit, asc);
    return Response.json({ ok: true, dryRun, ...out });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message) }, { status: 500 });
  }
});
