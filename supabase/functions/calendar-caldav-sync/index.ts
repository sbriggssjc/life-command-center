// ============================================================================
// calendar-caldav-sync (Cortex F4) - iCloud CalDAV sweep.
// Authenticates AS Scott via an Apple app-specific password and reads EVERY
// iCloud calendar he can see (owned + shared-to-him + subscribed), no per-cal
// publishing. Stamps calendar_name = the calendar's display name (registry
// classifies it) and upserts to calendar_events.
// Secrets: APPLE_ID, APPLE_APP_PASSWORD (set via `supabase secrets set`).
// ============================================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPLE_ID = Deno.env.get("APPLE_ID") || "";
const APPLE_PW = Deno.env.get("APPLE_APP_PASSWORD") || "";
const AUTH = "Basic " + btoa(APPLE_ID + ":" + APPLE_PW);

async function dav(method: string, url: string, body?: string, depth = "0") {
  const headers: Record<string, string> = { Authorization: AUTH, "User-Agent": "cortex-caldav/1.0" };
  if (body) headers["Content-Type"] = "application/xml; charset=utf-8";
  if (method === "PROPFIND" || method === "REPORT") headers["Depth"] = depth;
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(target, { method, headers, body, redirect: "manual" });
    if ([301,302,303,307,308].includes(r.status)) {
      const loc = r.headers.get("location"); await r.text();
      if (!loc) return { status: r.status, text: "", finalUrl: target };
      target = loc.startsWith("http") ? loc : new URL(target).origin + loc;
      continue;
    }
    const text = (await r.text()).replace(/(<\/?)[A-Za-z][\w.-]*:/g, "$1");
    return { status: r.status, text, finalUrl: target };
  }
  return { status: 508, text: "too many redirects", finalUrl: target };
}

function rxAll(re: RegExp, s: string): string[] {
  const out: string[] = []; let m;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

async function rest(path: string, init?: RequestInit) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...init, headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("rest " + r.status + ": " + t);
  return t ? JSON.parse(t) : null;
}

function icsDate(v: string, dateOnly: boolean) {
  if (!v) return { iso: null as string | null, allDay: false };
  if (dateOnly || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/); return m ? { iso: `${m[1]}-${m[2]}-${m[3]}T00:00:00`, allDay: true } : { iso: null, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  return m ? { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ""}`, allDay: false } : { iso: null, allDay: false };
}
function parseICS(text: string) {
  const u = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const out: Record<string, unknown>[] = []; let cur: Record<string, string> | null = null; let ad: Record<string, boolean> = {};
  for (const line of u.split(/\r\n|\n/)) {
    if (line === "BEGIN:VEVENT") { cur = {}; ad = {}; continue; }
    if (line === "END:VEVENT") { if (cur) out.push({ ...cur, __ad: ad }); cur = null; continue; }
    if (!cur) continue;
    const ci = line.indexOf(":"); if (ci === -1) continue;
    const np = line.slice(0, ci); const name = np.split(";")[0].toUpperCase();
    if (np.toUpperCase().includes("VALUE=DATE")) ad[name] = true;
    cur[name] = line.slice(ci + 1);
  }
  return out;
}

async function discoverCalendars() {
  // 1. principal
  let r = await dav("PROPFIND", "https://caldav.icloud.com/",
    `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`);
  const principal = rxAll(/current-user-principal[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/gi, r.text)[0];
  if (!principal) throw new Error("no principal (status " + r.status + ")");
  const base = new URL(r.finalUrl || "https://caldav.icloud.com/");
  const principalUrl = principal.startsWith("http") ? principal : base.origin + principal;
  // 2. calendar-home-set
  r = await dav("PROPFIND", principalUrl,
    `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`);
  const home = rxAll(/calendar-home-set[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/gi, r.text)[0];
  if (!home) throw new Error("no calendar-home");
  const homeUrl = home.startsWith("http") ? home : new URL(principalUrl).origin + home;
  // 3. list calendars (displayname + resourcetype)
  r = await dav("PROPFIND", homeUrl,
    `<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`, "1");
  const cals: { href: string; name: string }[] = [];
  const blocks = r.text.split(/<response[ >]/i).slice(1);
  for (const b of blocks) {
    if (!/calendar\b/i.test(b)) continue; // resourcetype contains <calendar/>
    const href = (b.match(/<href[^>]*>([^<]+)<\/href>/i) || [])[1];
    const name = (b.match(/<displayname[^>]*>([^<]*)<\/displayname>/i) || [])[1];
    if (href && name) cals.push({ href: href.startsWith("http") ? href : new URL(homeUrl).origin + href, name });
  }
  return cals;
}

async function ingestCalendar(cal: { href: string; name: string }) {
  const now = new Date(); const start = new Date(now.getTime() - 30 * 864e5); const end = new Date(now.getTime() + 150 * 864e5);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${fmt(start)}" end="${fmt(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const r = await dav("REPORT", cal.href, body, "1");
  const datas = rxAll(/<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/gi, r.text)
    .map((d) => d.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  const vevents = datas.flatMap((d) => parseICS(d));
  const tag = "icloud:" + cal.name;
  const rows = vevents.map((e: Record<string, unknown>) => {
    const ad = e.__ad as Record<string, boolean>;
    const s = icsDate(String(e.DTSTART || ""), !!ad?.DTSTART); const en = icsDate(String(e.DTEND || ""), !!ad?.DTEND);
    const uid = String(e.UID || crypto.randomUUID());
    return { id: "caldav-" + uid.replace(/[^A-Za-z0-9_.@-]/g, "_"), subject: e.SUMMARY || null,
             start_time: s.iso, end_time: en.iso, location: e.LOCATION || null, is_all_day: s.allDay,
             calendar_name: tag, synced_at: new Date().toISOString() };
  }).filter((x) => x.start_time);
  const seen = new Map<string, Record<string, unknown>>();
  for (const r of rows) seen.set(r.id as string, r);   // dedupe recurring/dup UIDs within the batch
  const dedup = [...seen.values()];
  if (dedup.length) await rest("calendar_events?on_conflict=id", { method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(dedup) });
  return { calendar: cal.name, events: vevents.length, upserted: dedup.length };
}

Deno.serve(async (req: Request) => {
  if (!APPLE_ID || !APPLE_PW) return Response.json({ ok: false, error: "APPLE_ID / APPLE_APP_PASSWORD secrets not set" }, { status: 400 });
  try {
    const cals = await discoverCalendars();
    if (req.method === "GET") return Response.json({ service: "calendar-caldav-sync", calendars: cals.map((c) => c.name) });
    const results = [];
    for (const c of cals) { try { results.push(await ingestCalendar(c)); } catch (e) { results.push({ calendar: c.name, error: String((e as Error).message) }); } }
    return Response.json({ ok: true, calendars_found: cals.length, results });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message) }, { status: 500 });
  }
});
