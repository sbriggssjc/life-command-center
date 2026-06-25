import { getDialysisClient, getGovClient, jsonResponse, normalizeSFArray, ANTHROPIC_API_KEY, BD_ROUTING_PATTERNS, constructOutlookWebLink, constructOutlookDesktopLink, parseSenderEmail, parseSenderName, categorizeEmail } from "./utils.ts";
import type { FlaggedEmail, CalendarEvent } from "./utils.ts";

export async function handleSyncFlaggedEmails(body: { emails?: FlaggedEmail[] | { value?: FlaggedEmail[] }; email?: FlaggedEmail; }) {
  console.log("handleSyncFlaggedEmails called, body keys:", Object.keys(body || {}));
  const emailsList = body.email ? [body.email] : normalizeSFArray<FlaggedEmail>(body.emails as FlaggedEmail[] | { value?: FlaggedEmail[] });
  if (emailsList.length === 0) return jsonResponse({ error: "No emails provided" }, 400);
  const d = getDialysisClient(); const results = { upserted: 0, errors: [] as string[], total_received: emailsList.length }; const batchSize = 100;
  for (let i = 0; i < emailsList.length; i += batchSize) { const batch = emailsList.slice(i, i + batchSize).map(e => { const emailId = (e.Id || e.id || '') as string; if (!emailId) return null; return { id: emailId, subject: (e.Subject || e.subject || null) as string | null, sender_name: parseSenderName(e), sender_email: parseSenderEmail(e), received_date: (e.ReceivedDate || e.received_date || e.receivedDateTime || null) as string | null, flag_status: (e.FlagStatus || e.flag_status || 'flagged') as string, flag_due_date: (e.FlagDueDate || e.flag_due_date || (() => { const f = (e as Record<string,unknown>).flag as Record<string,unknown> | undefined; if (f?.dueDateTime) { const dt = f.dueDateTime as Record<string,string>; return dt.dateTime || null; } return null; })()) as string | null, importance: (e.Importance || e.importance || null) as string | null, has_attachments: (e.HasAttachments ?? e.has_attachments ?? e.hasAttachments ?? false) as boolean, preview: (e.Preview || e.preview || e.bodyPreview || null) as string | null, categories: (e.Categories || e.categories || []) as string[], web_link: (e.WebLink || e.web_link || e.webLink || constructOutlookWebLink(emailId)) as string | null, synced_at: new Date().toISOString() }; }).filter(Boolean); if (batch.length === 0) continue; const { data, error } = await d.from("flagged_emails").upsert(batch, { onConflict: "id", ignoreDuplicates: false }).select("id"); if (error) { results.errors.push(`Batch ${i}: ${error.message}`); } else results.upserted += data?.length || batch.length; }
  let namesResolved = 0; try { await d.rpc("exec_sql", { query: `UPDATE flagged_emails fe SET sender_name = TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) FROM salesforce_contacts c WHERE LOWER(fe.sender_email) = LOWER(c.email) AND fe.sender_email IS NOT NULL AND c.first_name IS NOT NULL AND TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) != ''` }); await d.rpc("exec_sql", { query: `UPDATE flagged_emails SET sender_name = INITCAP(REPLACE(SPLIT_PART(sender_email, '@', 1), '.', ' ')) WHERE sender_email IS NOT NULL AND (sender_name IS NULL OR sender_name = '' OR sender_name LIKE '%@%')` }); namesResolved = 1; } catch (e) { results.errors.push(`Sender name resolution: ${(e as Error).message}`); }
  return jsonResponse({ success: results.errors.length === 0, emails_upserted: results.upserted, total_received: results.total_received, names_resolved: namesResolved, errors: results.errors, version: 52 });
}

export async function handleGetFlaggedEmails(url: URL) {
  const d = getDialysisClient(); const statusFilter = url.searchParams.get('status') || 'flagged'; const limit = parseInt(url.searchParams.get('limit') || '5000'); const offset = parseInt(url.searchParams.get('offset') || '0');
  const { data, error } = await d.from("flagged_emails").select("id, subject, sender_name, sender_email, received_date, flag_status, flag_due_date, importance, has_attachments, preview, categories, web_link").eq("flag_status", statusFilter).order("received_date", { ascending: false }).range(offset, offset + limit - 1);
  if (error) return jsonResponse({ error: "Failed to fetch flagged emails", details: error.message }, 500);
  const { count: totalCount } = await d.from("flagged_emails").select("id", { count: "planned", head: true });
  const enrichedEmails = (data || []).map((e: Record<string, unknown>) => ({ ...e, outlook_link: constructOutlookDesktopLink((e.web_link || null) as string | null, (e.id || '') as string), computed_category: categorizeEmail((e.subject || null) as string | null, (e.sender_email || null) as string | null) }));
  return jsonResponse({ emails: enrichedEmails, count: enrichedEmails.length, total: totalCount || 0, offset, limit });
}

// Windows timezone name → IANA mapping for Microsoft Graph payloads. Only includes
// US zones we expect from Outlook/Power Automate; falls through to the raw value so
// IANA names ("America/Chicago") pass through unchanged.
const WIN_TZ_TO_IANA: Record<string, string> = {
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
  "Eastern Standard Time": "America/New_York",
  "Eastern Daylight Time": "America/New_York",
  "US Eastern Standard Time": "America/Indiana/Indianapolis",
  "Central Standard Time": "America/Chicago",
  "Central Daylight Time": "America/Chicago",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Mountain Standard Time": "America/Denver",
  "Mountain Daylight Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Pacific Daylight Time": "America/Los_Angeles",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
};

// Convert a naive wall-time string (no offset) interpreted in `tzName` to a real UTC
// ISO string. Uses Intl.DateTimeFormat to discover the offset at that instant —
// handles DST transitions correctly without a TZ library.
function naiveInZoneToUtc(naive: string, tzName: string): string | null {
  const iana = WIN_TZ_TO_IANA[tzName] || tzName;
  // Strip any stray offset / Z / fractional seconds for clean parse
  const clean = naive.replace(/\.\d+/, '').replace(/[Zz]$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  // First pass: treat the wall-time AS IF it were UTC to get a reference instant
  const asUtc = new Date(clean + 'Z');
  if (isNaN(asUtc.getTime())) return null;
  // Now ask Intl what wall-time that UTC instant has in the target zone. The diff
  // between (the wall-time we wanted, interpreted as UTC) and (the wall-time Intl
  // reports for asUtc in iana) is the offset at this instant.
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: iana, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(asUtc)) parts[p.type] = p.value;
    const localAsUtcMs = Date.UTC(
      parseInt(parts.year, 10),
      parseInt(parts.month, 10) - 1,
      parseInt(parts.day, 10),
      parseInt(parts.hour, 10) % 24,
      parseInt(parts.minute, 10),
      parseInt(parts.second, 10)
    );
    const offsetMs = localAsUtcMs - asUtc.getTime();
    // naive wall-time minus offset = real UTC instant
    return new Date(asUtc.getTime() - offsetMs).toISOString();
  } catch {
    return null;
  }
}

// Normalize any incoming start/end value to a true-UTC ISO string. The second
// return value (`trusted`) indicates whether the source carried unambiguous
// timezone info; `false` means we had to guess UTC for a naive string, which
// matches the legacy Power Automate behavior and means the row still needs the
// backfill migration to shift it to real CT-derived UTC.
function parseDateTimeDetailed(val: string | Record<string, unknown> | undefined | null): { iso: string | null; trusted: boolean } {
  if (!val) return { iso: null, trusted: false };
  if (typeof val === 'string') {
    if (!val) return { iso: null, trusted: false };
    if (/[Zz]$/.test(val) || /[+-]\d{2}:?\d{2}$/.test(val)) {
      const d = new Date(val);
      return { iso: isNaN(d.getTime()) ? val : d.toISOString(), trusted: true };
    }
    // Naive string with no offset — legacy Power Automate V3 emits these as
    // "naive Central wall-time" tagged as UTC. We pass through unchanged and
    // leave tz_normalized_at NULL so the backfill migration can shift them.
    const d = new Date(val + 'Z');
    return { iso: isNaN(d.getTime()) ? null : d.toISOString(), trusted: false };
  }
  if (typeof val === 'object') {
    const dt = (val.dateTime || val.DateTime) as string | undefined;
    const tz = (val.timeZone || val.TimeZone) as string | undefined;
    if (!dt) return { iso: null, trusted: false };
    if (/[Zz]$/.test(dt) || /[+-]\d{2}:?\d{2}$/.test(dt)) {
      const d = new Date(dt);
      return { iso: isNaN(d.getTime()) ? dt : d.toISOString(), trusted: true };
    }
    if (tz && tz !== 'UTC' && tz !== 'Coordinated Universal Time') {
      const converted = naiveInZoneToUtc(dt, tz);
      if (converted) return { iso: converted, trusted: true };
    }
    if (tz === 'UTC' || tz === 'Coordinated Universal Time') {
      const d = new Date(dt + 'Z');
      return { iso: isNaN(d.getTime()) ? null : d.toISOString(), trusted: true };
    }
    // Object with naive dateTime and no timeZone hint — same fallback as bare string
    const d = new Date(dt + 'Z');
    return { iso: isNaN(d.getTime()) ? null : d.toISOString(), trusted: false };
  }
  return { iso: null, trusted: false };
}

function parseDateTime(val: string | Record<string, unknown> | undefined | null): string | null {
  return parseDateTimeDetailed(val).iso;
}
function parseLocation(val: string | Record<string, unknown> | undefined | null): string | null { if (!val) return null; if (typeof val === 'string') return val; if (typeof val === 'object') { return (val.displayName || val.DisplayName || val.name || null) as string | null; } return null; }

export async function handleSyncCalendarEvents(body: { events?: CalendarEvent[] | { value?: CalendarEvent[] }; event?: CalendarEvent; }) {
  const eventsList = body.event ? [body.event] : normalizeSFArray<CalendarEvent>(body.events as CalendarEvent[] | { value?: CalendarEvent[] });
  if (eventsList.length === 0) return jsonResponse({ success: true, upserted: 0, message: "No events to sync" }, 200);
  const d = getDialysisClient(); const results = { upserted: 0, errors: [] as string[], total_received: eventsList.length }; const batchSize = 100;
  const runStartedAt = new Date().toISOString();
  for (let i = 0; i < eventsList.length; i += batchSize) { const batch = eventsList.slice(i, i + batchSize).map(e => { const eventId = (e.Id || e.id || '') as string; if (!eventId) return null; const rawOrganizer = e.Organizer || e.organizer; const organizerIsString = typeof rawOrganizer === 'string'; const organizer = (organizerIsString ? {} : rawOrganizer || {}) as Record<string, unknown>; const orgEmail = organizer.emailAddress as Record<string, string> | undefined; const respStatus = (e.ResponseStatus || e.responseStatus || {}) as Record<string, unknown>; const startParsed = parseDateTimeDetailed(e.Start || e.start); const endParsed = parseDateTimeDetailed(e.End || e.end); return { id: eventId, subject: (e.Subject || e.subject || e.title || null) as string | null, start_time: startParsed.iso, end_time: endParsed.iso, location: parseLocation(e.Location || e.location), organizer_name: (orgEmail?.name || organizer.name || null) as string | null, organizer_email: (organizerIsString ? rawOrganizer : orgEmail?.address || organizer.email || null) as string | null, is_all_day: (e.IsAllDay ?? e.isAllDay ?? e.is_all_day ?? false) as boolean, calendar_name: (e.CalendarName || e.calendar_name || null) as string | null, categories: (e.Categories || e.categories || []) as string[], body_preview: (e.BodyPreview || e.bodyPreview || e.body_preview || e.body || null) as string | null, web_link: (e.WebLink || e.webLink || e.web_link || null) as string | null, sensitivity: (e.Sensitivity || e.sensitivity || 'normal') as string, show_as: (e.ShowAs || e.showAs || e.show_as || null) as string | null, response_status: (respStatus.response || respStatus.Response || null) as string | null, is_recurring: (e.IsRecurring ?? e.isRecurring ?? e.is_recurring ?? false) as boolean, synced_at: new Date().toISOString(), tz_normalized_at: (startParsed.trusted && (endParsed.iso === null || endParsed.trusted)) ? new Date().toISOString() : null }; }).filter(Boolean); if (batch.length === 0) continue; const { data, error } = await d.from("calendar_events").upsert(batch, { onConflict: "id", ignoreDuplicates: false }).select("id"); if (error) results.errors.push(`Batch ${i}: ${error.message}`); else results.upserted += data?.length || batch.length; }
  // ── Deletion reconciliation ────────────────────────────────────────────────
  // Events removed at the source are simply absent from the payload; an upsert
  // never deletes them, so they linger forever. Within the window the sources
  // actually covered THIS run, any row NOT touched this run (synced_at <
  // runStartedAt) was not re-sent => it was deleted at the source. We delete it.
  //
  // SAFETY: a silently-dropped calendar source (e.g. an iCal fetch returns empty
  // on error) would make all its events look "deleted". Two guards prevent a
  // mass-delete: (1) the window end is derived from the payload's own max start,
  // so it never exceeds real coverage; (2) if the candidate count exceeds
  // MAX_RECONCILE_DELETES we SKIP and warn instead of deleting. Reconciliation
  // only runs on a full array sync that upserted cleanly.
  const reconcile = { window_start: null as string | null, window_end: null as string | null, candidates: 0, deleted: 0, skipped: false, skip_reason: null as string | null };
  const MAX_RECONCILE_DELETES = parseInt(Deno.env.get('CALENDAR_MAX_RECONCILE_DELETES') || '10', 10);
  if (!body.event && results.errors.length === 0 && results.upserted > 0) {
    const nowMs = Date.now();
    let maxStartMs = nowMs;
    for (const e of eventsList) { const p = parseDateTimeDetailed(e.Start || e.start); if (p.iso) { const ms = Date.parse(p.iso); if (!isNaN(ms) && ms > maxStartMs) maxStartMs = ms; } }
    // FORWARD-ONLY: start at now, not in the past. Some sources (iCal subscriptions
    // like TeamSnap) only return events from now forward, so a PAST row missing from
    // the payload is ambiguous (deleted vs. simply aged out of the source's window).
    // From `now` onward, every active source still returns anything that exists, so
    // an absent row genuinely means it was deleted at the source.
    const windowStart = new Date(nowMs).toISOString();
    const windowEnd = new Date(maxStartMs).toISOString();                        // furthest event the sources actually returned
    reconcile.window_start = windowStart; reconcile.window_end = windowEnd;
    try {
      const { data: stale, error: staleErr } = await d.from("calendar_events")
        .select("id, subject, start_time")
        .gte("start_time", windowStart).lte("start_time", windowEnd)
        .lt("synced_at", runStartedAt);
      if (staleErr) { results.errors.push(`Reconcile query: ${staleErr.message}`); }
      else {
        const candidates = stale || [];
        reconcile.candidates = candidates.length;
        if (candidates.length > MAX_RECONCILE_DELETES) {
          reconcile.skipped = true;
          reconcile.skip_reason = `candidate count ${candidates.length} exceeds MAX_RECONCILE_DELETES (${MAX_RECONCILE_DELETES}); likely a dropped calendar source — skipping to avoid mass delete`;
          console.warn(`[calendar-reconcile] SKIP: ${reconcile.skip_reason}`);
        } else if (candidates.length > 0) {
          const ids = candidates.map((r: { id: string }) => r.id);
          const { error: delErr } = await d.from("calendar_events").delete().in("id", ids);
          if (delErr) { results.errors.push(`Reconcile delete: ${delErr.message}`); }
          else { reconcile.deleted = ids.length; console.warn(`[calendar-reconcile] deleted ${ids.length} stale event(s) no longer at source: ${candidates.map((r: { subject?: string }) => r.subject || '(untitled)').join(' | ')}`); }
        }
      }
    } catch (e) { results.errors.push(`Reconcile exception: ${String(e)}`); }
  }

  return jsonResponse({ success: results.errors.length === 0, events_upserted: results.upserted, total_received: results.total_received, reconcile, errors: results.errors, version: 54 });
}

export async function handleGetCalendarEvents(url: URL) {
  const d = getDialysisClient(); const limit = parseInt(url.searchParams.get('limit') || '200'); const offset = parseInt(url.searchParams.get('offset') || '0'); const daysBack = parseInt(url.searchParams.get('days_back') || '7'); const daysForward = parseInt(url.searchParams.get('days_forward') || '30'); const calendarName = url.searchParams.get('calendar');
  const now = new Date(); const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString(); const endDate = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString();
  // Cortex F4: serve the UNIFIED calendar — v_calendar_events_app is the merged
  // (de-duplicated) view with the normalized title + cortex_domain + hex color.
  let query = d.from("v_calendar_events_app").select("id, subject, start_time, end_time, location, organizer_name, organizer_email, is_all_day, calendar_name, cortex_domain, color, body_preview, web_link, sensitivity, show_as, response_status, is_recurring").gte("start_time", startDate).lte("start_time", endDate).order("start_time", { ascending: true }).range(offset, offset + limit - 1);
  // calendar filter maps to Cortex domains: personal = everything except business.
  if (calendarName === 'personal') { query = query.neq("cortex_domain", "business"); }
  else if (calendarName === 'business') { query = query.eq("cortex_domain", "business"); }
  else if (calendarName) { query = query.eq("cortex_domain", calendarName); }
  const { data, error } = await query;
  if (error) return jsonResponse({ error: "Failed to fetch calendar events", details: error.message }, 500);
  const { count: totalCount } = await d.from("v_calendar_events_app").select("id", { count: "planned", head: true });
  return jsonResponse({ events: data || [], count: (data || []).length, total_stored: totalCount || 0, range: { start: startDate, end: endDate }, offset, limit });
}

export async function handleBDRouteTask(body: { title?: string; subject?: string; company_name?: string; sf_contact_id?: string; sf_company_id?: string; }) {
  const { title, subject, company_name, sf_contact_id, sf_company_id } = body;
  const textToMatch = [title, subject, company_name].filter(Boolean).join(' ');
  if (!textToMatch) return jsonResponse({ error: "At least one of title, subject, or company_name is required" }, 400);
  for (const [category, pattern] of Object.entries(BD_ROUTING_PATTERNS)) { if (pattern.test(subject || '')) { return jsonResponse({ category, confidence: 0.95, reasoning: `Subject matches ${category} pattern`, source: 'subject_keyword' }); } }
  for (const [category, pattern] of Object.entries(BD_ROUTING_PATTERNS)) { if (pattern.test(title || '')) { return jsonResponse({ category, confidence: 0.85, reasoning: `Title matches ${category} pattern`, source: 'title_keyword' }); } }
  if (company_name) { const d = getDialysisClient(); const g = getGovClient(); const searchTerm = `%${company_name}%`; try { const { data } = await d.from("properties").select("property_id, tenant, city, state").or(`tenant.ilike.${searchTerm},building_name.ilike.${searchTerm}`).limit(1); if (data && data.length > 0) { return jsonResponse({ category: 'dialysis', confidence: 0.80, reasoning: `Company "${company_name}" found in dialysis properties DB`, source: 'db_match', property: data[0] }); } } catch (_) {} try { const { data } = await g.from("properties").select("property_id, address, city, state, agency_full_name").or(`agency_full_name.ilike.${searchTerm},address.ilike.${searchTerm}`).limit(1); if (data && data.length > 0) { return jsonResponse({ category: 'government', confidence: 0.80, reasoning: `Company "${company_name}" found in government properties DB`, source: 'db_match', property: data[0] }); } } catch (_) {} }
  if (sf_contact_id || sf_company_id) { const d = getDialysisClient(); try { const conditions: string[] = []; if (sf_contact_id) conditions.push(`sf_contact_id = '${sf_contact_id}'`); if (sf_company_id) conditions.push(`sf_company_id = '${sf_company_id}'`); const { data } = await d.rpc("exec_sql", { query: `SELECT subject, count(*) as cnt FROM salesforce_activities WHERE (${conditions.join(' OR ')}) AND subject IS NOT NULL GROUP BY subject ORDER BY cnt DESC LIMIT 5` }).single(); const rows = Array.isArray(data) ? data : []; for (const row of rows) { const subj = (row.subject || '') as string; for (const [category, pattern] of Object.entries(BD_ROUTING_PATTERNS)) { if (pattern.test(subj)) { return jsonResponse({ category, confidence: 0.75, reasoning: `Historical activity "${subj}" matches ${category}`, source: 'history_match' }); } } } } catch (_) {} }
  return jsonResponse({ category: null, confidence: 0, reasoning: "No matching pattern found", source: 'none' });
}

export async function handleBDDailyProgress(url: URL) {
  const dateParam = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
  const d = getDialysisClient(); const { data: configData, error: configError } = await d.from("bd_config").select("*").order("sort_order"); if (configError || !configData) return jsonResponse({ error: "Failed to load BD config" }, 500);
  const { data: logData } = await d.rpc("exec_sql", { query: `SELECT bd_category, count(*) as completed FROM bd_execution_log WHERE action_type = 'completed' AND created_at::date = '${dateParam}'::date GROUP BY bd_category` }).single();
  const completions: Record<string, number> = {}; const rows = Array.isArray(logData) ? logData : []; for (const row of rows) { completions[(row.bd_category || '') as string] = parseInt((row.completed || '0') as string); }
  const categories = configData.map((c: Record<string, unknown>) => ({ category: c.category, icon: c.icon, color: c.color, daily_target: c.daily_target as number, completed: completions[(c.category || '') as string] || 0, pct: Math.min(100, Math.round(((completions[(c.category || '') as string] || 0) / (c.daily_target as number || 1)) * 100)) }));
  const totalTarget = categories.reduce((s: number, c: { daily_target: number }) => s + c.daily_target, 0); const totalCompleted = categories.reduce((s: number, c: { completed: number }) => s + c.completed, 0);
  return jsonResponse({ date: dateParam, categories, total_target: totalTarget, total_completed: totalCompleted, total_pct: Math.min(100, Math.round((totalCompleted / (totalTarget || 1)) * 100)) });
}

export async function handleBDGenerateEmail(body: { template_type: string; contact_name?: string; contact_email?: string; company_name?: string; property_name?: string; city_state?: string; custom_context?: string; }) {
  const { template_type, contact_name, company_name, property_name, city_state, custom_context } = body;
  if (!template_type) return jsonResponse({ error: "template_type is required" }, 400);
  const d = getDialysisClient(); const { data: templates } = await d.from("bd_email_templates").select("*").eq("template_type", template_type).limit(1);
  if (templates && templates.length > 0) { const tmpl = templates[0]; const replacements: Record<string, string> = { '{{contact_name}}': contact_name || 'there', '{{company_name}}': company_name || 'your organization', '{{property_name}}': property_name || 'the property', '{{city_state}}': city_state || '', '{{sender_name}}': 'Scott Briggs', '{{sender_title}}': 'Senior Vice President, Investment Sales', '{{sender_company}}': 'Northmarq', '{{sender_phone}}': '(408) 781-5930', '{{sender_email}}': 'sbriggs@northmarq.com' }; let subject = tmpl.subject_template as string; let htmlBody = tmpl.html_body_template as string; for (const [key, val] of Object.entries(replacements)) { subject = subject.replaceAll(key, val); htmlBody = htmlBody.replaceAll(key, val); } return jsonResponse({ subject, html_body: htmlBody, template_used: tmpl.name, source: 'template' }); }
  if (!ANTHROPIC_API_KEY) return jsonResponse({ error: "No template found and Anthropic API key not configured" }, 500);
  const emailPrompt = `Generate a professional business development email for a commercial real estate broker at Northmarq.\nContext:\n- Template type: ${template_type}\n- Contact: ${contact_name || 'Unknown'}\n- Company: ${company_name || 'Unknown'}\n- Property: ${property_name || 'N/A'}\n- Location: ${city_state || 'N/A'}\n${custom_context ? `- Additional context: ${custom_context}` : ''}\n\nRequirements:\n- Professional, warm but not overly casual\n- Concise (3-4 paragraphs max)\n- Include a clear call to action\n- Sign off as Scott Briggs, Senior Vice President, Investment Sales at Northmarq\n- Return JSON with "subject" and "html_body" fields\n- The html_body should use simple HTML (p tags, br tags) suitable for Outlook\n- Do NOT include any markdown \u2014 pure HTML only`;
  try { const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: "You are an email drafting assistant. Return valid JSON only with 'subject' and 'html_body' fields. No markdown.", messages: [{ role: "user", content: emailPrompt }] }) }); const result = await resp.json(); const text = result.content?.[0]?.text || ''; try { const emailJson = JSON.parse(text); return jsonResponse({ ...emailJson, source: 'ai_generated' }); } catch (_) { const jsonMatch = text.match(/\{[\s\S]*\}/); if (jsonMatch) { const emailJson = JSON.parse(jsonMatch[0]); return jsonResponse({ ...emailJson, source: 'ai_generated' }); } return jsonResponse({ subject: `Following up \u2014 ${property_name || company_name || 'Investment Opportunity'}`, html_body: text, source: 'ai_raw' }); } } catch (e) { return jsonResponse({ error: "Failed to generate email", details: (e as Error).message }, 500); }
}

export async function handleBDAutoReschedule(body: { bd_category: string; activity_type?: string; completion_date?: string; }) {
  const { bd_category, activity_type, completion_date } = body;
  if (!bd_category) return jsonResponse({ error: "bd_category is required" }, 400);
  const baseDate = completion_date ? new Date(completion_date) : new Date(); let daysToAdd = 14; let reasoning = '';
  switch (bd_category) { case 'dialysis': daysToAdd = 14; reasoning = 'Dialysis area ownership: 2-week follow-up cadence'; break; case 'government': daysToAdd = 14; reasoning = 'Government area ownership: 2-week follow-up cadence'; break; case 'blue_suit': daysToAdd = 21; reasoning = 'Blue suit: 3-week follow-up for relationship building'; break; case 'listing_followup': if (activity_type?.toLowerCase().includes('callback') || activity_type?.toLowerCase().includes('call')) { daysToAdd = 7; reasoning = 'Callback follow-up: 1-week turnaround'; } else if (activity_type?.toLowerCase().includes('om') || activity_type?.toLowerCase().includes('download')) { daysToAdd = 3; reasoning = 'OM download follow-up: 3-day quick follow-up'; } else { daysToAdd = 7; reasoning = 'Listing follow-up: 1-week standard cycle'; } break; default: daysToAdd = 14; reasoning = 'Default: 2-week follow-up cycle'; }
  const suggestedDate = new Date(baseDate); suggestedDate.setDate(suggestedDate.getDate() + daysToAdd); const dayOfWeek = suggestedDate.getDay(); if (dayOfWeek === 0) suggestedDate.setDate(suggestedDate.getDate() + 1); if (dayOfWeek === 6) suggestedDate.setDate(suggestedDate.getDate() + 2);
  return jsonResponse({ suggested_date: suggestedDate.toISOString().split('T')[0], days_from_now: daysToAdd, reasoning, bd_category });
}

export async function handleBDLogCompletion(body: { task_title: string; bd_category: string; action_type?: string; details?: Record<string, unknown>; }) {
  const { task_title, bd_category, action_type = 'completed', details } = body;
  if (!task_title || !bd_category) return jsonResponse({ error: "task_title and bd_category are required" }, 400);
  const d = getDialysisClient(); const { data, error } = await d.from("bd_execution_log").insert({ task_title, bd_category, action_type, details: details || {} }).select().single();
  if (error) return jsonResponse({ error: "Failed to log completion", details: error.message }, 500);
  return jsonResponse({ success: true, log_entry: data });
}

export async function handleBDConfig() { const d = getDialysisClient(); const { data, error } = await d.from("bd_config").select("*").order("sort_order"); if (error) return jsonResponse({ error: "Failed to load BD config" }, 500); return jsonResponse({ config: data }); }

export async function handleBDConfigUpdate(body: { category: string; daily_target: number }) { const { category, daily_target } = body; if (