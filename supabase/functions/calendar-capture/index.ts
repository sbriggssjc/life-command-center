// ============================================================================
// calendar-capture (Cortex F4b — Event Concierge, create side).
// Accepts an extracted event and inserts it into calendar_events tagged
// `capture:<domain>`, so the EXISTING pipeline (registry classify → merge
// view normalize+dedup → calendar-caldav-push) styles it and writes it to the
// right colored iCloud calendar. Captures are lowest authority, so the merge
// view auto-suppresses a capture that duplicates a TeamSnap/Outlook/iCloud
// event — and this function ALSO pre-checks so it can tell the user.
//
// POST body: { title, start, end?, location?, domain, all_day?, tz?, dry_run? }
//   start/end: ISO (with Z/offset = trusted) OR naive wall time (assumed tz, default America/Chicago)
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_TZ = "America/Chicago";
const DOMAINS = ["business", "family", "coaching", "personal", "home", "travel"];

async function rest(path: string, init?: RequestInit) {
  const r = await fetch(URL_ + "/rest/v1/" + path, {
    ...init, headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("rest " + r.status + ": " + t);
  return t ? JSON.parse(t) : null;
}
function zonedWallToUtcISO(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): string {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcGuess))) p[part.type] = part.value;
  const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return new Date(utcGuess - (asTz - utcGuess)).toISOString();
}
function toUtc(v: string, tz: string): string | null {
  if (!v) return null;
  if (/[Zz]$/.test(v) || /[+-]\d{2}:?\d{2}$/.test(v)) { const d = new Date(v); return isNaN(+d) ? null : d.toISOString(); }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return zonedWallToUtcISO(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz);
  const m2 = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return zonedWallToUtcISO(+m2[1], +m2[2], +m2[3], 0, 0, 0, tz);
  const d = new Date(v); return isNaN(+d) ? null : d.toISOString();
}
// kid/sport derivation mirrors v_calendar_events_merged
const KIDS = ["Jack", "Claire", "Graham"];
function kidOf(s: string) { for (const k of KIDS) if (new RegExp("\\b" + k + "\\b", "i").test(s)) return k; return null; }
function sportOf(s: string) {
  if (/\b(soccer|5v5|pda)\b/i.test(s)) return "soccer";
  if (/\b(basketball|bball)\b/i.test(s)) return "basketball";
  if (/\b(football)\b/i.test(s)) return "football";
  if (/\b(baseball)\b/i.test(s)) return "baseball";
  if (/\b(tennis)\b/i.test(s)) return "tennis";
  return null;
}
async function sha1(s: string) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ ok: false, error: "POST required" }, { status: 405 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }

  const title = String(body.title || "").trim();
  const domain = String(body.domain || "").trim().toLowerCase();
  const tz = String(body.tz || DEFAULT_TZ);
  if (!title) return Response.json({ ok: false, error: "title required" }, { status: 400 });
  if (!DOMAINS.includes(domain)) return Response.json({ ok: false, error: "domain must be one of " + DOMAINS.join("/") }, { status: 400 });

  const allDay = !!body.all_day;
  const startISO = toUtc(String(body.start || ""), tz);
  if (!startISO) return Response.json({ ok: false, error: "could not parse start" }, { status: 400 });
  const endISO = body.end ? toUtc(String(body.end), tz) : new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();
  const location = body.location ? String(body.location) : null;

  // ---- dedup pre-check: same kid+sport+date within 90 min on a more-authoritative source ----
  const kid = kidOf(title), sport = sportOf(title);
  let duplicate: Record<string, unknown> | null = null;
  if (kid && sport) {
    const dayStart = new Date(startISO); const lo = new Date(+dayStart - 90 * 60000).toISOString(); const hi = new Date(+dayStart + 90 * 60000).toISOString();
    const cands: Record<string, unknown>[] = (await rest(
      "v_calendar_events_cortex?select=subject,start_time,calendar_name,calendar_kid,calendar_sport,cortex_domain&start_time=gte." + lo + "&start_time=lte." + hi)) || [];
    for (const c of cands) {
      const ck = (c.calendar_kid as string) || kidOf(String(c.subject || ""));
      const cs = (c.calendar_sport as string) || sportOf(String(c.subject || ""));
      if (ck === kid && cs === sport) { duplicate = c; break; }
    }
  }

  const id = "capture-" + (await sha1(domain + "|" + title.toLowerCase() + "|" + startISO));
  const row = {
    id, subject: title, start_time: startISO, end_time: endISO, location,
    is_all_day: allDay, calendar_name: "capture:" + domain,
    body_preview: "[Cortex capture]", synced_at: new Date().toISOString(), tz_normalized_at: new Date().toISOString(),
  };

  if (body.dry_run) return Response.json({ ok: true, dry_run: true, would_insert: row, duplicate_of: duplicate });
  if (duplicate) return Response.json({ ok: true, status: "duplicate",
    message: "Already on your calendar (" + (duplicate.calendar_name) + ") — not added again.", duplicate_of: duplicate, candidate: row });

  await rest("calendar_events?on_conflict=id", { method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([row]) });
  return Response.json({ ok: true, status: "created", id, event: row, classified: { domain, kid, sport } });
});
