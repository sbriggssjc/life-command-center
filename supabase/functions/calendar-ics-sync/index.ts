// ============================================================================
// calendar-ics-sync (Cortex F4 Option B) - direct ICS feed ingester.
// Reads calendar_registry rows where source_type='ics_feed' + ics_url, fetches
// each feed server-side (no Outlook.com middleman), parses VEVENTs, stamps
// calendar_name from the row, and upserts into calendar_events. Add a feed =
// add a registry row's ics_url. Self-contained (uses injected service key).
// ============================================================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rest(path: string, init?: RequestInit) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json",
               ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error("rest " + r.status + ": " + (await r.text()));
  return r.status === 204 ? null : r.json();
}

function icsDateToISO(value: string, isDateOnly: boolean): { iso: string | null; allDay: boolean } {
  if (!value) return { iso: null, allDay: false };
  const v = value.trim();
  if (isDateOnly || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? { iso: `${m[1]}-${m[2]}-${m[3]}T00:00:00`, allDay: true } : { iso: null, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return { iso: null, allDay: false };
  return { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}`, allDay: false };
}

function parseICS(text: string) {
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r\n|\n/);
  const events: Record<string, unknown>[] = [];
  let cur: Record<string, string> | null = null;
  let curAllDay: Record<string, boolean> = {};
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; curAllDay = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push({ ...cur, __allDay: curAllDay }); cur = null; continue; }
    if (!cur) continue;
    const ci = line.indexOf(":"); if (ci === -1) continue;
    const namePart = line.slice(0, ci); const value = line.slice(ci + 1);
    const name = namePart.split(";")[0].toUpperCase();
    if (namePart.toUpperCase().includes("VALUE=DATE")) curAllDay[name] = true;
    cur[name] = value;
  }
  return events;
}

async function ingestFeed(row: Record<string, unknown>) {
  const url = String(row.ics_url);
  const tag = String(row.match_pattern).replace(/%/g, "") || "ics";
  const res = await fetch(url, { headers: { Accept: "text/calendar", "User-Agent": "Mozilla/5.0 (calendar-ics-sync)" } });
  const text = await res.text();
  const diag = { http_status: res.status, redirected: res.redirected, final_url: res.url,
                 content_type: res.headers.get("content-type"), body_len: text.length,
                 has_vcalendar: text.includes("BEGIN:VCALENDAR"), has_vevent: text.includes("BEGIN:VEVENT"),
                 head: text.slice(0, 160) };
  if (!res.ok) return { feed: row.label, tag, ...diag };
  const vevents = parseICS(text);
  const rows = vevents.map((e: Record<string, unknown>) => {
    const allDay = e.__allDay as Record<string, boolean>;
    const s = icsDateToISO(String(e.DTSTART || ""), !!allDay?.DTSTART);
    const en = icsDateToISO(String(e.DTEND || ""), !!allDay?.DTEND);
    const uid = String(e.UID || crypto.randomUUID());
    return {
      id: "ics-" + uid.replace(/[^A-Za-z0-9_.@-]/g, "_"),
      subject: e.SUMMARY || null,
      start_time: s.iso, end_time: en.iso,
      location: e.LOCATION || null,
      is_all_day: s.allDay,
      calendar_name: tag,
      synced_at: new Date().toISOString(),
    };
  }).filter((r) => r.start_time);
  if (rows.length) {
    await rest("calendar_events?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  }
  return { feed: row.label || tag, tag, parsed: vevents.length, upserted: rows.length, ...diag };
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const feeds = await rest("calendar_registry?source_type=eq.ics_feed&active=eq.true&select=label,match_pattern,ics_url");
    return Response.json({ service: "calendar-ics-sync", configured_feeds: feeds });
  }
  try {
    const feeds = await rest("calendar_registry?source_type=eq.ics_feed&active=eq.true&ics_url=not.is.null&select=label,match_pattern,ics_url");
    const results = [];
    for (const f of feeds as Record<string, unknown>[]) {
      try { results.push(await ingestFeed(f)); }
      catch (e) { results.push({ feed: f.label, error: String((e as Error).message) }); }
    }
    return Response.json({ ok: true, results });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message) }, { status: 500 });
  }
});
