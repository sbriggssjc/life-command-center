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

// ---- shared helpers --------------------------------------------------------

function lower(s) { return s ? String(s).toLowerCase() : null; }

function extractEmail(graphAddress) {
  // Graph emailAddress shape: { address, name }
  return lower(graphAddress?.emailAddress?.address);
}

function extractRecipients(arr) {
  return (arr || []).map(extractEmail).filter(Boolean);
}

/**
 * Look up tracked contacts for a list of email addresses. Returns up to
 * `max` rows; never throws. Email match is case-insensitive (uses ilike).
 *
 * Note: PostgREST `in.(...)` is case-sensitive on text, so we lowercase
 * inputs and match against lower(email). The unified_contacts schema
 * already has a unique index on lower(email), so this is index-friendly.
 */
async function findTrackedContacts(workspaceId, emails, max = 25) {
  if (!emails || !emails.length) return [];
  const lowered = [...new Set(emails.map(lower).filter(Boolean))];
  if (!lowered.length) return [];
  const filter = `email=in.(${lowered.map(e => pgFilterVal(e)).join(',')})`;
  // entity_id added by Phase 3.5 — needed for activity_events writes.
  const r = await opsQuery('GET',
    `unified_contacts?${filter}&select=unified_id,entity_id,email,full_name,sf_contact_id,total_emails_sent,total_calls&limit=${max}`,
    null, { countMode: 'none' }
  );
  return (r.ok && Array.isArray(r.data)) ? r.data : [];
}

// ---- outlook.message.extract -----------------------------------------------

export async function handleOutlookMessageExtract(job) {
  const p = job.payload || {};
  const workspaceId  = job.workspace_id;
  const sourceUserId = p._source_user_id || null;
  const msgId        = p.internetMessageId || p.id || job.external_id;
  if (!msgId)        return { ok: false, error: 'missing_message_id' };
  if (!sourceUserId) return { ok: false, error: 'missing_source_user_id' };

  // Drop drafts — they're not real touches and the user might still be editing.
  if (p.isDraft) return { ok: true, result: { skipped: 'draft' } };

  const fromEmail = extractEmail(p.from);
  const toEmails  = extractRecipients(p.toRecipients);
  const ccEmails  = extractRecipients(p.ccRecipients);
  const allParties = [fromEmail, ...toEmails, ...ccEmails].filter(Boolean);

  if (!allParties.length) return { ok: true, result: { skipped: 'no_parties' } };

  // Look up tracked contacts. If none, drop — we don't store untracked traffic.
  const tracked = await findTrackedContacts(workspaceId, allParties);
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

  // Body format split — Graph returns body as { contentType: 'text'|'html', content }
  const bodyFmt = p.body?.contentType || null;
  const bodyContent = p.body?.content || null;
  const bodyText = bodyFmt === 'text' ? bodyContent : null;
  const bodyHtml = bodyFmt === 'html' ? bodyContent : null;

  // Pick a primary tracked contact to attach the email to. Prefer the
  // first non-source-user contact (i.e. the "other party" in the thread).
  const primaryContact = tracked[0]; // for now; UI can render all linked contacts via metadata

  await opsQuery('POST',
    'email_bodies?on_conflict=workspace_id,internet_message_id',
    {
      workspace_id:        workspaceId,
      internet_message_id: msgId,
      conversation_id:     p.conversationId || null,
      subject:             p.subject || null,
      body_preview:        p.bodyPreview || null,
      body_format:         bodyFmt,
      body_text:           bodyText,
      body_html:           bodyHtml,
      from_email:          fromEmail,
      from_name:           p.from?.emailAddress?.name || null,
      to_emails:           toEmails,
      cc_emails:           ccEmails,
      has_attachments:     !!p.hasAttachments,
      is_sent:             isSent,
      received_at:         p.receivedDateTime || null,
      sent_at:             p.sentDateTime || null,
      source_user_id:      sourceUserId
    },
    { headers: { Prefer: 'resolution=merge-duplicates' } }
  );

  // Refresh touch metrics on every tracked contact in the message.
  // Outbound bumps total_emails_sent on each recipient; inbound just
  // updates last_email_date.
  const occurredAt = p.receivedDateTime || p.sentDateTime || new Date().toISOString();
  for (const c of tracked) {
    const patch = { last_email_date: occurredAt };
    if (isSent && lower(c.email) !== fromEmail) {
      patch.total_emails_sent = (c.total_emails_sent || 0) + 1;
    }
    await opsQuery('PATCH',
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
    await appendActivityEvent({
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
        to_emails:           toEmails,
        cc_emails:           ccEmails,
        has_attachments:     !!p.hasAttachments,
        linked_unified_ids:  tracked.map(c => c.unified_id),
        linked_entity_ids:   tracked.map(c => c.entity_id).filter(Boolean)
      }
    });
  }

  return {
    ok: true,
    result: {
      message_id:    msgId,
      tracked_count: tracked.length,
      is_sent:       isSent,
      primary:       primaryContact?.unified_id || null,
      timeline_attached: !!primaryEntityId
    }
  };
}

// ---- calendar.event.link ---------------------------------------------------

export async function handleCalendarEventLink(job) {
  const p = job.payload || {};
  const workspaceId  = job.workspace_id;
  const sourceUserId = p._source_user_id || null;
  const eventId      = p.id || job.external_id;
  if (!eventId)      return { ok: false, error: 'missing_event_id' };
  if (!sourceUserId) return { ok: false, error: 'missing_source_user_id' };

  // Graph event attendees: [{ emailAddress: { address, name }, type, status }, ...]
  const attendeeEmails = (p.attendees || [])
    .map(a => lower(a.emailAddress?.address))
    .filter(Boolean);
  const organizerEmail = lower(p.organizer?.emailAddress?.address);
  const allParties = [organizerEmail, ...attendeeEmails].filter(Boolean);

  if (!allParties.length) return { ok: true, result: { skipped: 'no_parties' } };

  const tracked = await findTrackedContacts(workspaceId, allParties);
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

  await opsQuery('POST',
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

  // Refresh last_meeting_date on each tracked attendee. Use start of meeting
  // as the "occurred" timestamp — that's the canonical "when did we meet".
  if (startsAt) {
    for (const c of tracked) {
      await opsQuery('PATCH',
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
    await appendActivityEvent({
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
  }

  return {
    ok: true,
    result: {
      event_id:      eventId,
      tracked_count: tracked.length,
      starts_at:     startsAt,
      timeline_attached: !!primaryEntityId
    }
  };
}
