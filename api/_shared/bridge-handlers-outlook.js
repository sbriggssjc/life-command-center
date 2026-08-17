// ============================================================================
// Bridge handlers — Outlook + Calendar
// Life Command Center — Phase 3
// ----------------------------------------------------------------------------
// Two handlers:
//
//   outlook.message.extract → email_bodies (subject + meta + body)
//                             + unified_contacts.last_email_date / counters
//
//   calendar.event.link     → meetings (subject + attendees + entity_links)
//                             + unified_contacts.last_meeting_date
//
// Both run after the ingest receiver injects `_source_user_id` into the job
// payload (per-user PA flows tag each batch with the user whose mailbox /
// calendar it came from). The receiver enforces requireSourceUser=true for
// these bridges.
//
// Privacy gate: a message or event is only stored if at least one party is
// already in `unified_contacts` (i.e. tracked). Untracked traffic (random
// internal noise, marketing newsletters, personal stuff) is dropped at the
// handler with reason 'no_tracked_party' and never lands in the DB.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { appendActivityEvent } from './activity-events.js';
import { growCadenceFromOutreach } from './cadence-engine.js';
import { parseAddress, parseAddressList } from './outlook-recipients.js';
import { resolveSourceUserId } from './source-user-id.js';

// ---- the upsert 409 that was NOT a conflict (Prompt 116) -------------------
//
// Prompt 115 started recording `result.body_persist_error = 'upsert_<status>'`,
// and 10,470 of the backward sweep's writes came back `upsert_409`. A 409 on an
// `on_conflict=…` + `Prefer: resolution=merge-duplicates` POST reads exactly
// like "merge-duplicates didn't take, so the existing row 23505'd" — and that
// is the wrong diagnosis. PostgREST maps **both** 23505 (unique_violation) and
// **23503 (foreign_key_violation)** onto HTTP 409.
//
// Grounded live 2026-08-17 from the Postgres log, not from the status code:
//   insert or update on table "email_bodies"
//     violates foreign key constraint "email_bodies_source_user_id_fkey"
//
// The merge-duplicates upsert was correct all along (proven by a
// self-rolling-back SQL gate: the same ON CONFLICT statement with a VALID user
// id UPDATES the existing row in place). What failed was the FK: the sweep's
// `_source_user_id` is an `lcc_users.lcc_user_id`, and these columns FK
// `public.users(id)`. See `source-user-id.js` for the id-space bridge.
//
// So the error field now carries the DB's own code + message, never just the
// HTTP status — a future 409 must be self-diagnosing.
function describeWriteFailure(r) {
  const d = r?.data;
  const code = (d && typeof d === 'object' && d.code) ? String(d.code) : null;
  const msg = (d && typeof d === 'object')
    ? String(d.message || d.details || d.hint || '')
    : (typeof d === 'string' ? d : '');
  return {
    status: r?.status ?? null,
    ...(code ? { code } : {}),
    ...(msg ? { message: msg.slice(0, 300) } : {})
  };
}

// ---- shared helpers --------------------------------------------------------

function lower(s) { return s ? String(s).toLowerCase() : null; }

function extractEmail(graphAddress) {
  // Accept Graph shape { emailAddress: { address } }, plain { address }, or a bare string.
  if (graphAddress == null) return null;
  if (typeof graphAddress === 'string') return lower(graphAddress.trim());
  return lower(graphAddress?.emailAddress?.address || graphAddress?.address);
}

function extractRecipients(v) {
  // Accept an array (of strings or {emailAddress:{address}}) OR a ';'/',' separated string
  // (the Office 365 Outlook connector returns recipients as a delimited string).
  if (typeof v === 'string') return v.split(/[;,]/).map((s) => lower(s.trim())).filter(Boolean);
  return (v || []).map(extractEmail).filter(Boolean);
}

// ---- body normalization (Prompt 115) ---------------------------------------
//
// `payload.body` has arrived in THREE distinct live shapes (all observed in
// `enrichment_jobs` on 2026-08-15, LCC Opps):
//
//   1. the Graph object   { contentType: 'html'|'text', content: '<html>…' }
//   2. a JSON STRING      '{"content":"<html>…","contentType":"html"}'
//      — a Power Automate compose/setProperty variant serialises the object
//        before it reaches the receiver, so `p.body.contentType` is undefined.
//   3. absent entirely    — the 5-minute forward sweep sends no body at all.
//
// The pre-115 split (`p.body?.contentType === 'html' ? content : null`) turned
// (2) into NULL for BOTH columns while silently discarding a 90-180 KB body,
// and wrote an explicit NULL for (3) — which, through the merge-duplicates
// upsert, CLOBBERS a body an earlier body-bearing sweep had already stored.
//
// Rule now: a non-empty `content` must ALWAYS land in one of the two columns,
// and a payload with no content must never overwrite a stored body.

// Cheap structural sniff — used only when contentType is missing/unrecognized.
const HTML_SNIFF_RE = /<\s*(html|body|div|p|table|span|a|br|meta)\b/i;

/**
 * Normalize any of the observed `payload.body` shapes into
 * `{ format: 'html'|'text', html, text }`, or null when there is genuinely
 * no content to store (never fabricates — a bodyless message stays bodyless).
 *
 * @param {object|string|null} rawBody
 * @returns {{format:'html'|'text', html:string|null, text:string|null}|null}
 */
export function normalizeGraphBody(rawBody) {
  let body = rawBody;

  // Shape 2 — the payload arrived as a string. It may be serialized JSON
  // (the observed PA variant) or a bare body string; either way the content
  // is recoverable, so never drop it.
  if (typeof body === 'string') {
    const s = body.trim();
    if (!s) return null;
    let parsed = null;
    if (s.startsWith('{')) {
      try { parsed = JSON.parse(s); } catch { parsed = null; }
    }
    body = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed
      : { content: s };  // not JSON → the string IS the body
  }

  if (!body || typeof body !== 'object') return null;

  const content = typeof body.content === 'string' ? body.content
    : (typeof body.Content === 'string' ? body.Content : null);
  if (!content || !content.trim()) return null;

  // Case/whitespace-insensitive; accept the mime spellings too.
  const declared = String(body.contentType ?? body.ContentType ?? '')
    .toLowerCase().trim();

  let format;
  if (declared === 'html' || declared === 'text/html') format = 'html';
  else if (declared === 'text' || declared === 'text/plain') format = 'text';
  // Missing / unrecognized contentType → sniff rather than discard.
  else format = (HTML_SNIFF_RE.test(content) || content.trimStart().startsWith('<'))
    ? 'html' : 'text';

  return format === 'html'
    ? { format, html: content, text: null }
    : { format, html: null, text: content };
}

/**
 * Look up tracked contacts for a list of email addresses. Returns up to
 * `max` rows; never throws. Email match is case-insensitive (uses ilike).
 *
 * Note: PostgREST `in.(...)` is case-sensitive on text, so we lowercase
 * inputs and match against lower(email). The unified_contacts schema
 * already has a unique index on lower(email), so this is index-friendly.
 */
async function findTrackedContacts(workspaceId, emails, max = 25, q = opsQuery) {
  if (!emails || !emails.length) return [];
  const lowered = [...new Set(emails.map(lower).filter(Boolean))];
  if (!lowered.length) return [];
  const filter = `email=in.(${lowered.map(e => pgFilterVal(e)).join(',')})`;
  // entity_id added by Phase 3.5 — needed for activity_events writes.
  const r = await q('GET',
    `unified_contacts?${filter}&select=unified_id,entity_id,email,full_name,sf_contact_id,total_emails_sent,total_calls&limit=${max}`,
    null, { countMode: 'none' }
  );
  return (r.ok && Array.isArray(r.data)) ? r.data : [];
}

// ---- outlook.message.extract -----------------------------------------------

/**
 * Build the `email_bodies` upsert row. Pure — no I/O — so the body-persistence
 * contract is testable without a DB.
 *
 * The body columns are OMITTED (not set to null) when the payload carries no
 * content. The upsert is `resolution=merge-duplicates`, so an omitted column is
 * left out of the ON CONFLICT SET list: a fresh row still lands with NULLs
 * (column default) — no fabrication — while an existing row keeps the body a
 * previous body-bearing sweep stored. Sending explicit NULLs is what let the
 * bodyless 5-minute forward sweep erase a filled body.
 */
export function buildEmailBodyRow({
  workspaceId, msgId, payload, fromEmail, toEmails, ccEmails, isSent, sourceUserId
}) {
  const p = payload || {};
  const row = {
    workspace_id:        workspaceId,
    internet_message_id: msgId,
    conversation_id:     p.conversationId || null,
    subject:             p.subject || null,
    body_preview:        p.bodyPreview || null,
    from_email:          fromEmail,
    from_name:           p.from?.emailAddress?.name || null,
    to_emails:           toEmails,
    cc_emails:           ccEmails,
    has_attachments:     !!p.hasAttachments,
    is_sent:             isSent,
    received_at:         p.receivedDateTime || null,
    sent_at:             p.sentDateTime || null,
    source_user_id:      sourceUserId
  };

  const body = normalizeGraphBody(p.body);
  if (body) {
    row.body_format = body.format;
    row.body_text   = body.text;
    row.body_html   = body.html;
  }
  return row;
}

export async function handleOutlookMessageExtract(job, deps = {}) {
  // `deps.opsQuery` is a test seam (repo convention) so the upsert CONTRACT —
  // merge-duplicates against an existing row, and the resolved FK stamp — is
  // provable without a live PostgREST.
  const q = deps.opsQuery || opsQuery;
  const p = job.payload || {};
  const workspaceId  = job.workspace_id;
  const rawSourceUserId = p._source_user_id || null;
  const msgId        = p.internetMessageId || p.id || job.external_id;
  if (!msgId)        return { ok: false, error: 'missing_message_id' };
  if (!rawSourceUserId) return { ok: false, error: 'missing_source_user_id' };

  // Drop drafts — they're not real touches and the user might still be editing.
  if (p.isDraft) return { ok: true, result: { skipped: 'draft' } };

  const fromEmail = extractEmail(p.from);
  const toEmails  = extractRecipients(p.toRecipients);
  const ccEmails  = extractRecipients(p.ccRecipients);
  const allParties = [fromEmail, ...toEmails, ...ccEmails].filter(Boolean);
  // Prompt 96 — preserve display names alongside the flattened addresses so the
  // canonical activity_events row (comms-harvest feedstock) carries name↔email
  // pairs, not just bare emails. Graph delivers { emailAddress:{ name,address } }.
  const fromName = parseAddress(p.from).name || null;
  const toNames  = [
    ...parseAddressList(p.toRecipients),
    ...parseAddressList(p.ccRecipients),
  ].filter((x) => x.name).map((x) => ({ name: x.name, email: x.email }));

  if (!allParties.length) return { ok: true, result: { skipped: 'no_parties' } };

  // Look up tracked contacts. If none, drop — we don't store untracked traffic.
  const tracked = await findTrackedContacts(workspaceId, allParties, 25, q);
  if (!tracked.length) {
    return { ok: true, result: { skipped: 'no_tracked_party', parties: allParties.length } };
  }

  // Direction: a message is "sent by us" if the from address is the source
  // user's mailbox. We approximate by checking whether the from address
  // appears among tracked contacts — if not, source user is most likely
  // the sender (since it's THEIR mailbox we're reading).
  // A stricter check would need the source user's email; that's fine to
  // resolve later from users table if precision matters.
  const fromIsTracked = tracked.some(c => lower(c.email) === fromEmail);
  const isSent = !fromIsTracked;

  // Pick a primary tracked contact to attach the email to. Prefer the
  // first non-source-user contact (i.e. the "other party" in the thread).
  const primaryContact = tracked[0]; // for now; UI can render all linked contacts via metadata

  // Prompt 116 — map the flow-supplied id onto `public.users(id)` BEFORE it
  // reaches an FK'd column. An unresolvable id becomes NULL: losing the
  // "whose mailbox" stamp is recoverable, losing the body is not.
  const srcUser = await resolveSourceUserId(rawSourceUserId, { opsQuery: q });
  const sourceUserId = srcUser.id;

  const bodyRow = buildEmailBodyRow({
    workspaceId, msgId, payload: p, fromEmail, toEmails, ccEmails,
    isSent, sourceUserId
  });

  // Bodies run 5 KB–250 KB, well past the shape of a normal ops write, so this
  // one call gets real headroom over the 8s opsQuery default.
  const upsert = await q('POST',
    'email_bodies?on_conflict=workspace_id,internet_message_id',
    bodyRow,
    { headers: { Prefer: 'resolution=merge-duplicates' }, timeoutMs: 20000 }
  );
  // The pre-115 code ignored this result entirely, so a rejected write looked
  // identical to a stored body. Surface it in the job result (queryable via
  // `enrichment_jobs.result ? 'body_persist_error'`) instead of failing the job
  // — a retry would double-count total_emails_sent below.
  let bodyPersistError = null;
  let bodyPersistDetail = null;
  if (!upsert.ok) {
    bodyPersistError = `upsert_${upsert.status}`;
    bodyPersistDetail = describeWriteFailure(upsert);
    console.error(
      `[outlook.message.extract] email_bodies upsert failed status=${upsert.status} ` +
      `code=${bodyPersistDetail.code || '-'} msg=${msgId} ` +
      `body_bytes=${(bodyRow.body_html || bodyRow.body_text || '').length} ` +
      `detail=${bodyPersistDetail.message || '-'}`
    );
  }

  // Refresh touch metrics on every tracked contact in the message.
  // Outbound bumps total_emails_sent on each recipient; inbound just
  // updates last_email_date.
  const occurredAt = p.receivedDateTime || p.sentDateTime || new Date().toISOString();
  for (const c of tracked) {
    const patch = { last_email_date: occurredAt };
    if (isSent && lower(c.email) !== fromEmail) {
      patch.total_emails_sent = (c.total_emails_sent || 0) + 1;
    }
    await q('PATCH',
      `unified_contacts?unified_id=eq.${c.unified_id}`,
      patch
    );
  }

  // Phase 3.5 — write to canonical activity_events timeline. One row per
  // message, attached to the primary tracked contact's entity. Other linked
  // contacts are recorded in metadata.linked_unified_ids so the sidebar can
  // surface a "+N other recipients" affordance.
  const primaryEntityId = primaryContact?.entity_id || null;
  if (primaryEntityId) {
    const appended = await appendActivityEvent({
      workspaceId,
      actorId:    sourceUserId,
      category:   'email',
      title:      p.subject || '(no subject)',
      body:       p.bodyPreview || null,
      entityId:   primaryEntityId,
      sourceType: 'outlook',
      externalId: msgId,
      occurredAt: occurredAt,
      metadata: {
        internet_message_id: msgId,
        conversation_id:     p.conversationId || null,
        is_sent:             isSent,
        from_email:          fromEmail,
        from_name:           fromName,
        to_emails:           toEmails,
        to_names:            toNames.length ? toNames : null,
        cc_emails:           ccEmails,
        has_attachments:     !!p.hasAttachments,
        linked_unified_ids:  tracked.map(c => c.unified_id),
        linked_entity_ids:   tracked.map(c => c.entity_id).filter(Boolean)
      }
    });
    // Phase 1 (2026-07-13) — capture Scott's REAL pipeline: Outlook email is his
    // dominant outreach channel, so a real email to a tracked contact with no
    // cadence GROWS one (the person is the contact → self-stamped, immediately
    // outreach-ready). Best-effort, fresh-insert only (never on a dedup replay);
    // no-ops when a cadence already resolves (the trigger owns that advance).
    if (appended?.inserted) {
      try { await growCadenceFromOutreach({ entityId: primaryEntityId, category: 'email' }); }
      catch (_e) { /* best-effort — the timeline row is written regardless */ }
    }
  }

  return {
    ok: true,
    result: {
      message_id:    msgId,
      tracked_count: tracked.length,
      is_sent:       isSent,
      primary:       primaryContact?.unified_id || null,
      timeline_attached: !!primaryEntityId,
      body_format:   bodyRow.body_format || null,
      body_bytes:    (bodyRow.body_html || bodyRow.body_text || '').length,
      source_user_resolved_via: srcUser.via,
      // Only surfaced when the flow's id could NOT be mapped onto public.users
      // — so an un-stamped provenance column is queryable, never silent.
      ...(sourceUserId ? {} : { source_user_unresolved: srcUser.raw }),
      ...(bodyPersistError ? { body_persist_error: bodyPersistError } : {}),
      ...(bodyPersistDetail ? { body_persist_detail: bodyPersistDetail } : {})
    }
  };
}

// ---- calendar.event.link ---------------------------------------------------

export async function handleCalendarEventLink(job) {
  const p = job.payload || {};
  const workspaceId  = job.workspace_id;
  const rawSourceUserId = p._source_user_id || null;
  const eventId      = p.id || job.external_id;
  if (!eventId)      return { ok: false, error: 'missing_event_id' };
  if (!rawSourceUserId) return { ok: false, error: 'missing_source_user_id' };

  // Graph event attendees: [{ emailAddress: { address, name }, type, status }, ...]
  const attendeeEmails = (p.attendees || [])
    .map(a => lower(a.emailAddress?.address))
    .filter(Boolean);
  const organizerEmail = lower(p.organizer?.emailAddress?.address);
  const allParties = [organizerEmail, ...attendeeEmails].filter(Boolean);

  if (!allParties.length) return { ok: true, result: { skipped: 'no_parties' } };

  const tracked = await findTrackedContacts(workspaceId, allParties, 25, q);
  if (!tracked.length) {
    return { ok: true, result: { skipped: 'no_tracked_attendee', attendees: attendeeEmails.length } };
  }

  // Build the entity_links blob — one entry per tracked attendee, keyed by
  // unified_id. Sidebar can render this without joining unified_contacts.
  const entityLinks = tracked.map(c => ({
    unified_id:  c.unified_id,
    email:       c.email,
    full_name:   c.full_name,
    sf_contact_id: c.sf_contact_id || null
  }));

  // Attendees blob — preserve raw Graph shape so the UI can show RSVP
  // status, but strip down to fields we care about.
  const attendees = (p.attendees || []).map(a => ({
    email:    lower(a.emailAddress?.address),
    name:     a.emailAddress?.name || null,
    type:     a.type || null,
    response: a.status?.response || null
  }));

  const startsAt = p.start?.dateTime || null;
  const endsAt   = p.end?.dateTime || null;

  // Prompt 116 — `meetings.source_user_id` carries the SAME FK to
  // `public.users(id)` that broke the mailbox sweep, so this path is bridged
  // identically rather than left as a latent 409.
  const srcUser = await resolveSourceUserId(rawSourceUserId, { opsQuery: q });
  const sourceUserId = srcUser.id;

  const meetingUpsert = await q('POST',
    'meetings?on_conflict=workspace_id,external_id',
    {
      workspace_id:      workspaceId,
      external_id:       eventId,
      ical_uid:          p.iCalUId || null,
      organizer_email:   organizerEmail,
      source_user_id:    sourceUserId,
      subject:           p.subject || null,
      starts_at:         startsAt,
      ends_at:           endsAt,
      is_online_meeting: !!p.isOnlineMeeting,
      location:          p.location?.displayName || null,
      attendees,
      entity_links:      entityLinks,
      metadata: {
        body_preview:       p.bodyPreview || null,
        online_meeting_url: p.onlineMeetingUrl || null
      }
    },
    { headers: { Prefer: 'resolution=merge-duplicates' } }
  );
  // Same lesson as the body upsert: a rejected write must never look like a
  // stored one.
  let meetingPersistError = null;
  let meetingPersistDetail = null;
  if (!meetingUpsert.ok) {
    meetingPersistError = `upsert_${meetingUpsert.status}`;
    meetingPersistDetail = describeWriteFailure(meetingUpsert);
    console.error(
      `[calendar.event.link] meetings upsert failed status=${meetingUpsert.status} ` +
      `code=${meetingPersistDetail.code || '-'} event=${eventId} ` +
      `detail=${meetingPersistDetail.message || '-'}`
    );
  }

  // Refresh last_meeting_date on each tracked attendee. Use start of meeting
  // as the "occurred" timestamp — that's the canonical "when did we meet".
  if (startsAt) {
    for (const c of tracked) {
      await q('PATCH',
        `unified_contacts?unified_id=eq.${c.unified_id}`,
        { last_meeting_date: startsAt }
      );
    }
  }

  // Phase 3.5 — write to canonical activity_events timeline. Attach to the
  // first tracked attendee's entity; record all linked entities in metadata
  // so the sidebar can show every relevant participant.
  const primaryAttendee = tracked.find(c => c.entity_id) || tracked[0];
  const primaryEntityId = primaryAttendee?.entity_id || null;
  if (primaryEntityId) {
    const appended = await appendActivityEvent({
      workspaceId,
      actorId:    sourceUserId,
      category:   'meeting',
      title:      p.subject || '(untitled meeting)',
      body:       p.bodyPreview || null,
      entityId:   primaryEntityId,
      sourceType: 'calendar',
      externalId: eventId,
      occurredAt: startsAt || new Date().toISOString(),
      metadata: {
        ical_uid:           p.iCalUId || null,
        organizer_email:    organizerEmail,
        starts_at:          startsAt,
        ends_at:            endsAt,
        is_online_meeting:  !!p.isOnlineMeeting,
        location:           p.location?.displayName || null,
        linked_unified_ids: tracked.map(c => c.unified_id),
        linked_entity_ids:  tracked.map(c => c.entity_id).filter(Boolean),
        attendee_count:     attendees.length
      }
    });
    // Phase 1 — a real meeting with a tracked contact grows the cadence too.
    if (appended?.inserted) {
      try { await growCadenceFromOutreach({ entityId: primaryEntityId, category: 'meeting' }); }
      catch (_e) { /* best-effort */ }
    }
  }

  return {
    ok: true,
    result: {
      event_id:      eventId,
      tracked_count: tracked.length,
      starts_at:     startsAt,
      timeline_attached: !!primaryEntityId,
      source_user_resolved_via: srcUser.via,
      ...(sourceUserId ? {} : { source_user_unresolved: srcUser.raw }),
      ...(meetingPersistError ? { meeting_persist_error: meetingPersistError } : {}),
      ...(meetingPersistDetail ? { meeting_persist_detail: meetingPersistDetail } : {})
    }
  };
}
