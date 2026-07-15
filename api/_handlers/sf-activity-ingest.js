// ============================================================================
// Salesforce activity → activity_events ingest
// Life Command Center — Phase 2 Slice 3b (Unit 2, LCC-side handler)
// ----------------------------------------------------------------------------
// Mirrors Salesforce Task AND Event records into the canonical activity_events
// timeline, linked to the LCC entity via the existing external_identities
// (source_system='salesforce') → entity mapping. Salesforce is the system of
// record for client interactions (calls, emails, meetings, notes logged on
// Contacts/Accounts); this is how that correspondence flows into the timeline
// the property/contact context packets + the Next-Best-Touchpoint engine read.
//
//   POST /api/intake?_route=sf-activity   (rewritten to /api/sf-activity)
//   Body: { records: [ { sf_id, type, subject, description, activity_date,
//                        who_id, what_id, status }, ... ] }
//         (a bare array is also accepted)
//
// Per record:
//   - resolve the LCC entity from who_id (Contact) → what_id (Account) via
//     external_identities (source_system='salesforce')
//   - map SF type → activity_events.category
//       Call→call, Email→email, Meeting/Event→meeting, Task/Note/other→note
//   - appendActivityEvent(... sourceType:'salesforce', externalId:sf_id ...)
//     (dedup is automatic on (workspace_id, source_system='salesforce', sf_id))
//   - skip (never guess) when no entity resolves
//
// Reports { matched, skipped_no_entity, inserted, deduped, errors, total }.
//
// NBT Phase 2 (2026-06-20): the feed now carries Scott's REAL prospecting
// history — Tasks of ALL statuses (open AND completed, deal-linked or not) and
// Events (meetings) — not just the thin recent slice. Two ingest doctrines:
//
//   * Tasks of every status land a row. A COMPLETED Task is the prospecting
//     RECORD ("this contact/account was worked"), so it must never be dropped.
//     Its Status / IsClosed / completion date ride in metadata as a SOFT signal
//     — we do NOT infer "successfully contacted / responded" from completion
//     (a Salesforce admin bulk auto-completed Scott's open Tasks; an identical
//     LastModifiedDate+modifier across many rows is tagged `bulk_completed` so
//     the engine can discount it). Writing the activity_events row (source
//     'salesforce') + the trigger's contact-hop advance IS the "this contact
//     is already prospected" signal the NBT engine reads (v_next_best_touchpoint
//     keys last_touch_at on the cadence, else the latest SF activity_event).
//   * Events carry a DIFFERENT shape than Tasks — StartDateTime (not
//     ActivityDate), no Status/IsClosed. They are categorized 'meeting'
//     directly (never run through the Task subject-inference, so an Event titled
//     "RE: ..." is not miscategorized as an email), with StartDateTime resolved
//     to occurred_at. The SQL advance trigger advances the matching cadence on
//     'meeting' via the same entity / contact-hop, no JS advance needed.
//
// THE SF-SIDE FEED IS THE DEPENDENCY (Scott / Power Automate): the "SF → LCC:
// Activity Sync" flow pulls Tasks (watermark widened live to ~now−10y so the
// full history is reachable); the Event pull is added to the flow only AFTER
// this Event-aware ingest ships, so we never POST Events the ingest can't parse.
//
// Out of reach (documented honestly, NOT faked): Salesforce ARCHIVES completed
// Activities older than ~1 year and EXCLUDES them from the standard SOQL /
// connector query — a wider watermark cannot reach them (they need
// isArchived=true / queryAll, i.e. a custom SOQL action or the Bulk API). So the
// deep archived prospecting history is not retrievable through the standard PA
// "Get records" flow; LCC's reliable activity history is go-forward + whatever
// the standard query still returns. See `docs/SF_ACTIVITY_ARCHIVED_HISTORY.md`.
// ============================================================================

import { authenticate, requireRole } from '../_shared/auth.js';
import { appendActivityEvent as defaultAppendActivityEvent } from '../_shared/activity-events.js';
import { findEntityBySfId as defaultFindEntityBySfId } from '../_shared/bridge-handlers-salesforce.js';
import { opsQuery } from '../_shared/ops-db.js';
import { ensureEntityLink, normalizeEmail, isGenericInboxEmail } from '../_shared/entity-link.js';
import {
  advanceCadence as defaultAdvanceCadence,
  resolveCadenceForEntity as defaultResolveCadenceForEntity,
  growCadenceFromOutreach as defaultGrowCadenceFromOutreach,
} from '../_shared/cadence-engine.js';

// SF-CONTACT-RECONCILE Unit 1 — kill-switch for the WhoId contact mint (default
// ON). Even ON, minting is a natural no-op until the PA "Activity Sync" flow
// includes the WhoId's Name/Email, so existing feeds are byte-identical: no
// name/email ⇒ no mint (never fabricated).
const MINT_SF_CONTACTS = process.env.SF_INGEST_MINT_CONTACTS !== 'false';

// CONTACT-SELECTION Slice 2 — an inbound reply is a two-way (engaged) signal:
// lock the owner's active contact pick (the human took over). Best-effort,
// deps-injectable, never blocks the mirror; a no-owner-pivot entity is a no-op.
async function defaultApplyOwnerContactFeedback(ownerEntityId, kind) {
  if (!ownerEntityId) return;
  try {
    await opsQuery('POST', 'rpc/lcc_apply_contact_feedback',
      { p_entity_id: ownerEntityId, p_kind: kind, p_detail: {}, p_source: 'sf_ingest' });
  } catch (_e) { /* non-blocking */ }
}

// ============================================================================
// SF-CONTACT-RECONCILE (2026-07-15)
// ----------------------------------------------------------------------------
// Two Boyd Watterson decision-makers we email/call are in Salesforce but never
// reached LCC — a contact-sync SCOPE gap: the sync only pulled contacts on
// LCC-mapped accounts, so a decision-maker on an unmapped / misfiled account
// (Joseph Capra; Eric Dowling filed under "Arbor Realty Trust") never flowed.
//   Unit 1 — MINT the WhoId contact entity + salesforce/Contact identity on every
//            synced activity (the activity itself is the "already prospected"
//            signal; the contact becomes a first-class linked entity).
//   Unit 2 — RECONCILE by email: minting routes through ensureEntityLink's R39
//            email tier, so the SF Dowling ATTACHES to the existing CoStar/RCA
//            Dowling (one entity, salesforce+costar+rca identities) — never a
//            duplicate. The junk/implausible-person guards reject garbage.
//   Unit 3 — SURFACE the SF data-quality error: an @<firm> email on a different
//            SF account is a disagreement LCC FLAGS (never inherits) via a
//            Decision-Center `sf_contact_account_mismatch` lane.
// LCC is the source of truth; Salesforce is minimum-necessary. No SF writes.
// ============================================================================

/**
 * Mint (or attach-by-email) the WhoId SF Contact as a person entity + a
 * salesforce/Contact external identity. Routes through ensureEntityLink so:
 *  - the R39 email tier ATTACHES to an existing CoStar/RCA person by email
 *    (one entity, multiple source identities) instead of minting a duplicate;
 *  - the junk / implausible-person guards reject garbage (never invents a
 *    contact from a bad name).
 * Returns:
 *   { ok:true, entityId, createdEntity, resolvedByEmail }        — minted/attached
 *   { ok:false, reason:'no_name' }                               — the by-id flow
 *     yielded an id but NO usable name/email (an adapter/field-map miss or a
 *     nameless record) — NOT a guard rejection.
 *   { ok:false, reason:<junk_entity_name|implausible_person_name|
 *     street_fragment_name> }                                    — a genuine
 *     name-guard rejection (ensureEntityLink `skipped`), terminal.
 *   { ok:false, reason:'create_failed', detail }                 — the entities
 *     POST / link failed (a DB/RLS/transient error), NOT a guard rejection —
 *     the caller may retry.
 * The ingest caller only reads `.entityId`, so returning a `{ok:false,…}` object
 * instead of the old bare `null` is backward-compatible.
 */
export async function defaultResolveOrCreateSfContact({ workspaceId, userId, whoId, accountId, name, email, first, last, phone, title }) {
  const seedFields = {};
  // Trim so a whitespace-only name (a padded field-map value) is treated as
  // empty, not minted as a blank entity.
  const trim = (v) => (typeof v === 'string' ? v.trim() : v);
  const tName = trim(name), tFirst = trim(first), tLast = trim(last), tTitle = trim(title), tPhone = trim(phone);
  if (tName)  seedFields.name = tName;
  if (tFirst) seedFields.first_name = tFirst;
  if (tLast)  seedFields.last_name = tLast;
  if (tTitle) seedFields.title = tTitle;
  const ne = normalizeEmail(email);
  if (ne)     seedFields.email = ne;
  if (tPhone) seedFields.phone = tPhone;
  if (!seedFields.name && !seedFields.first_name && !seedFields.last_name && !seedFields.email) {
    return { ok: false, reason: 'no_name' };
  }
  const link = await ensureEntityLink({
    workspaceId, userId,
    sourceSystem: 'salesforce', sourceType: 'Contact', externalId: whoId,
    seedFields,
    metadata: { via: 'sf_activity_ingest', sf_account: accountId || null },
  });
  if (link && link.ok && link.entityId) {
    return { ok: true, entityId: link.entityId, createdEntity: !!link.createdEntity, resolvedByEmail: !!link.resolvedByEmail };
  }
  // Un-conflate: a name-guard rejection (ensureEntityLink `skipped`) is terminal;
  // a create/link failure is a transient DB error the caller can retry.
  if (link && link.skipped) return { ok: false, reason: link.skipped };
  const rawDetail = link && link.detail
    ? (typeof link.detail === 'string' ? link.detail : JSON.stringify(link.detail))
    : null;
  return { ok: false, reason: 'create_failed', detail: rawDetail ? rawDetail.slice(0, 200) : null };
}

// Free personal-mail domains carry NO firm signal, so a mismatch can't be judged
// against them (a broker with a gmail address is not "wrong account").
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net',
  'protonmail.com', 'proton.me', 'gmx.com', 'att.net', 'sbcglobal.net', 'verizon.net',
]);

function orgCore(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

/**
 * Unit 3 detector (pure). An SF Contact whose EMAIL DOMAIN org-token contradicts
 * its SF ACCOUNT name is a Salesforce-side data-quality error (e.g. Eric Dowling
 * `edowling@boydwatterson.com` filed under account "Arbor Realty Trust"). LCC
 * flags it — it does NOT inherit the wrong account.
 *
 * Conservative — returns `mismatch:true` ONLY when BOTH signals are strong:
 *   - the email domain is a real firm domain (non-generic inbox, non-personal),
 *     with a distinctive second-level label ≥ 4 chars (boydwatterson.com →
 *     "boydwatterson");
 *   - the account name collapses to ≥ 4 alnum chars;
 *   - NEITHER core contains the other (no agreement).
 * Any weak / agreeing / generic case ⇒ `mismatch:false`.
 */
export function sfContactAccountMismatch({ email, accountName } = {}) {
  const e = normalizeEmail(email);
  if (!e || isGenericInboxEmail(e)) return { mismatch: false };
  const domain = (e.split('@')[1] || '').trim();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return { mismatch: false };
  const acct = String(accountName || '').trim();
  if (!acct) return { mismatch: false };
  const labels = domain.split('.');
  const domainLabel = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  const domainCore = orgCore(domainLabel);
  if (domainCore.length < 4) return { mismatch: false };
  const acctCore = orgCore(acct);
  if (acctCore.length < 4) return { mismatch: false };
  if (acctCore.includes(domainCore) || domainCore.includes(acctCore)) {
    return { mismatch: false, domain_label: domainLabel, account_name: acct };
  }
  return { mismatch: true, email_domain: domain, domain_label: domainLabel, account_name: acct };
}

/**
 * Unit 3 producer — seed a `sf_contact_account_mismatch` Decision-Center row for
 * an operator to resolve. Idempotent on subject_ref (lcc_open_decision dedupes),
 * best-effort (never blocks the mirror). Record-only verdicts — no SF write.
 */
export async function defaultOpenSfMismatchDecision({ workspaceId, entityId, detail }) {
  if (!entityId) return false;
  try {
    const r = await opsQuery('POST', 'rpc/lcc_open_decision', {
      p_decision_type: 'sf_contact_account_mismatch',
      p_workspace_id: workspaceId || null,
      p_question: null,
      p_context: detail || {},
      p_subject_entity_id: entityId,
      p_subject_domain: null,
      p_subject_property_id: null,
      p_subject_ref: 'sfmismatch:' + entityId,
      p_rank_value: null,
    });
    return !!(r && r.ok);
  } catch (_e) { return false; }
}

/**
 * SF-CONTACT-RECONCILE Unit 1 — enqueue unresolved WhoIds for the by-id resolver.
 * When an activity carries a WhoId (Contact) that the ingest could NOT resolve to
 * an LCC entity (and which isn't already an entity — that's exactly the state at
 * the skipped_no_entity point), record it in sf_contact_resolve_queue so the
 * resolver worker (api/_handlers/sf-contact-resolve.js) can fetch it by id, mint
 * (or attach-by-email) the contact, and run the mismatch detector.
 *
 * Idempotent on who_id (PK): ignore-duplicates so a re-POST of the same Task never
 * resets an existing row's attempts/status (a resolved/dead/no_data row stays put).
 * Best-effort — never blocks the mirror; an absent table is a soft no-op.
 */
async function defaultEnqueueSfContactResolve(whoIds, workspaceId) {
  const ids = Array.from(new Set((whoIds || []).map((w) => String(w || '').trim()).filter(Boolean)));
  if (ids.length === 0) return { ok: true, queued: 0 };
  const rows = ids.map((who_id) => ({ who_id, workspace_id: workspaceId || null }));
  try {
    const r = await opsQuery('POST', 'sf_contact_resolve_queue?on_conflict=who_id', rows,
      { headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
    return { ok: !!r.ok, queued: r.ok ? ids.length : 0 };
  } catch (_e) { return { ok: false, queued: 0 }; }
}

const MAX_BATCH = 500;

/**
 * Map a Salesforce activity type to an activity_events.category.
 * Note/Task and anything unrecognized collapse to 'note' (the closest
 * semantic fit, matching activity-events.js normalizeCategory).
 */
export function mapSfTypeToCategory(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'call')                       return 'call';
  if (t === 'email' || t === 'listemail') return 'email';
  if (t === 'meeting' || t === 'event')   return 'meeting';
  // Task, Note, ToDo, and any other subtype → note.
  return 'note';
}

// OUTREACH #1 (RC1) — conservative outreach-subject shapes. Scott logs most of
// his real outreach in Salesforce as PLAIN Tasks (sf_type='Task', no
// TaskSubtype), which mapSfTypeToCategory collapses to 'note' — and the advance
// trigger skips 'note', so the touch never advances the cadence. Grounded live
// 2026-06-19: 29/31 recent 'note' SF events are real outreach. We recover the
// real category from the SUBJECT for those Tasks only; genuine internal notes
// ("2 - Medical Buyer/Portfolio") match neither pattern and stay 'note'.
const SF_EMAIL_SUBJECT_RE = /\bsent\b|^\s*(re|aw|antw|sv|vs|rv|fw|fwd)\s*:|\bre:|\bfw:|\bfwd:/i;
const SF_CALL_SUBJECT_RE  = /\bcall\b|voicemail|left\s+(a\s+)?(vm|message)/i;

/**
 * Derive the activity category for a Salesforce record. When the SF type maps
 * to a concrete channel (Call/Email/Meeting) that wins. When it collapses to
 * 'note' (a plain Task), infer the real channel from the subject so genuine
 * outreach logged as a Task advances the cadence — email markers
 * (sent/Re:/Fw:) first, then call markers (Call/voicemail), else 'note'.
 *
 * @param {string} type    SF type / TaskSubtype
 * @param {string} subject SF subject line
 * @returns {'call'|'email'|'meeting'|'note'}
 */
export function deriveSfCategory(type, subject) {
  const base = mapSfTypeToCategory(type);
  if (base !== 'note') return base;
  // Only infer outreach for generic Tasks / unknown activity types. An explicit
  // SF 'Note' object is a real note attachment, not a logged touch — leave it.
  if (String(type || '').toLowerCase() === 'note') return 'note';
  const s = String(subject || '');
  if (SF_EMAIL_SUBJECT_RE.test(s)) return 'email';
  if (SF_CALL_SUBJECT_RE.test(s))  return 'call';
  return 'note';
}

/**
 * Decide whether a mirrored email activity is an INBOUND REPLY from the
 * contact (R24 Unit 2). A reply is a high-signal touch that should advance the
 * cadence into active-engagement, not be counted as one of our outbound sends.
 *
 * Signals (any one):
 *   - an explicit inbound flag on the record (SF EmailMessage.Incoming, or a
 *     direction field the PA flow may add)
 *   - a subject line that begins with a reply prefix (RE:, AW:, etc.)
 *
 * Only meaningful for the 'email' category.
 */
export function isInboundReply(category, rec, subject) {
  if (category !== 'email') return false;
  const incoming = rec?.incoming ?? rec?.Incoming ?? rec?.is_incoming ?? null;
  if (incoming === true || String(incoming).toLowerCase() === 'true') return true;
  const dir = String(rec?.direction ?? rec?.Direction ?? '').toLowerCase();
  if (dir === 'inbound' || dir === 'incoming' || dir === 'received') return true;
  return /^\s*(re|aw|antw|sv|vs|rv)\s*:/i.test(String(subject || ''));
}

// NBT Phase 2 — pick the first non-empty value across a list of possible field
// names (canonical snake_case + raw Salesforce PascalCase).
function pickField(rec, ...keys) {
  for (const k of keys) {
    const v = rec?.[k];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

/**
 * Classify a Salesforce activity record as an Event (meeting) or a Task.
 * Salesforce Events and Tasks are distinct sObjects with different shapes; an
 * Event carries StartDateTime/EndDateTime/DurationInMinutes and NO Status /
 * IsClosed. The PA "Get records (Event)" flow can also stamp the object type
 * explicitly (REST `attributes.type`, or a flow-added discriminator).
 *
 * Order: explicit object-type stamp → a bare Type of 'Event'/'Task' → field
 * shape (Event-only fields present AND no Task-only fields). Defaults to 'task'
 * (the historical behavior; every existing canonical Task shape stays a task).
 *
 * NOTE: canonical Task records carry the activity CHANNEL in `type`
 * (Call/Email/Meeting) — that is NOT the object type, so only an explicit
 * `Type`/`type` of literally 'event'/'task' is treated as an object-type hint.
 *
 * @returns {'event'|'task'}
 */
export function sfRecordKind(rec) {
  const explicit = String(
    rec?.attributes?.type ?? rec?.sobject ?? rec?.sobject_type ??
    rec?.sobjectType ?? rec?.object_type ?? rec?.objectType ??
    rec?.object ?? rec?.sf_object ?? ''
  ).trim().toLowerCase();
  if (explicit === 'event') return 'event';
  if (explicit === 'task')  return 'task';

  const t = String(rec?.type ?? rec?.Type ?? '').trim().toLowerCase();
  if (t === 'event') return 'event';
  if (t === 'task')  return 'task';

  const hasEventFields =
    pickField(rec, 'StartDateTime', 'start_date_time', 'startDateTime',
                   'EndDateTime', 'end_date_time',
                   'DurationInMinutes', 'duration_in_minutes',
                   'EventSubtype', 'event_subtype') != null;
  const hasTaskFields =
    rec?.Status != null || rec?.status != null ||
    rec?.IsClosed != null || rec?.is_closed != null || rec?.isClosed != null ||
    rec?.TaskSubtype != null || rec?.task_subtype != null;
  if (hasEventFields && !hasTaskFields) return 'event';
  return 'task';
}

/**
 * Resolve a record's occurred_at. Events anchor on StartDateTime (falling back
 * to ActivityDate then CreatedDate); Tasks anchor on ActivityDate then
 * CreatedDate. An explicit canonical `occurred_at` always wins. Returns null
 * when nothing is present (the append helper then stamps now()).
 */
export function resolveSfOccurredAt(rec, kind = sfRecordKind(rec)) {
  if (kind === 'event') {
    return pickField(rec, 'occurred_at',
      'StartDateTime', 'start_date_time', 'startDateTime',
      'activity_date', 'ActivityDate', 'activityDate',
      'CreatedDate', 'created_date', 'created_at');
  }
  return pickField(rec, 'occurred_at',
    'activity_date', 'ActivityDate', 'activityDate',
    'CreatedDate', 'created_date', 'created_at');
}

// NBT Phase 2 — within a single POSTed batch, ≥ this many closed Tasks sharing
// an EXACT (LastModifiedById, LastModifiedDate) signature is the fingerprint of
// an admin bulk auto-completion (one save stamps every row identically). Those
// are flagged so a completion is never read as "successfully worked".
const BULK_COMPLETE_MIN = 5;

/**
 * Normalize a raw record (canonical OR Salesforce-native field names) into the
 * fields the ingest needs. One extraction point so the batch-level bulk
 * detection and the per-record loop read the same values.
 */
export function normalizeSfRecord(rec) {
  const kind   = sfRecordKind(rec);
  const rawType = rec?.type ?? rec?.TaskSubtype ?? rec?.EventSubtype ?? rec?.Type ?? null;
  const subject = rec?.subject ?? rec?.Subject ?? null;
  const isClosedRaw = rec?.is_closed ?? rec?.IsClosed ?? rec?.isClosed ?? null;
  const isClosed = isClosedRaw == null
    ? null
    : (isClosedRaw === true || String(isClosedRaw).toLowerCase() === 'true');
  // SF-CONTACT-RECONCILE — the WhoId contact + WhatId account identity fields the
  // PA flow may include (flattened `who_name`/`WhoName`, or nested `Who.Name`).
  // Absent ⇒ the mint / mismatch detection are no-ops (never fabricated).
  const who  = rec?.Who  || rec?.who  || null;
  const what = rec?.What || rec?.what || rec?.Account || null;
  return {
    rec,
    kind,
    sfId:     rec?.sf_id ?? rec?.Id ?? rec?.id ?? null,
    rawType,
    subject,
    descr:    rec?.description ?? rec?.Description ?? null,
    actDate:  rec?.activity_date ?? rec?.ActivityDate ?? rec?.activityDate ?? null,
    whoId:    rec?.who_id ?? rec?.WhoId ?? null,    // Contact
    whatId:   rec?.what_id ?? rec?.WhatId ?? null,  // Account / other
    // The WhoId Contact's identity (for the Unit-1 mint) + WhatId Account name
    // (for the Unit-3 email-domain-vs-account mismatch detector).
    whoName:  pickField(rec, 'who_name', 'WhoName', 'contact_name') ?? (who && (who.Name ?? who.name)) ?? null,
    whoEmail: pickField(rec, 'who_email', 'WhoEmail', 'contact_email') ?? (who && (who.Email ?? who.email)) ?? null,
    whoFirst: pickField(rec, 'who_first_name', 'WhoFirstName') ?? (who && (who.FirstName ?? who.firstName)) ?? null,
    whoLast:  pickField(rec, 'who_last_name', 'WhoLastName') ?? (who && (who.LastName ?? who.lastName)) ?? null,
    whoPhone: pickField(rec, 'who_phone', 'WhoPhone', 'contact_phone') ?? (who && (who.Phone ?? who.phone)) ?? null,
    whoTitle: pickField(rec, 'who_title', 'WhoTitle') ?? (who && (who.Title ?? who.title)) ?? null,
    whatName: pickField(rec, 'what_name', 'WhatName', 'account_name', 'AccountName') ?? (what && (what.Name ?? what.name)) ?? null,
    status:   rec?.status ?? rec?.Status ?? null,
    ownerId:   rec?.owner_id   ?? rec?.OwnerId ?? null,
    ownerName: rec?.owner_name ?? rec?.OwnerName ?? rec?.Owner?.Name ?? null,
    isClosed,
    completedAt: pickField(rec, 'completed_at', 'CompletedDateTime',
                                'completed_date_time', 'completedDateTime'),
    lastModifiedAt: pickField(rec, 'last_modified_at', 'LastModifiedDate',
                                   'lastModifiedDate'),
    lastModifiedById: pickField(rec, 'last_modified_by', 'last_modified_by_id',
                                     'LastModifiedById', 'lastModifiedById'),
    occurredAt: resolveSfOccurredAt(rec, kind),
    // Events are meetings — categorized directly so an Event titled "RE: ..."
    // is never run through the Task subject-inference and miscalled an email.
    category: kind === 'event' ? 'meeting' : deriveSfCategory(rawType, subject),
    bulkCompleted: false,
  };
}

/**
 * Tag items that look like an admin bulk auto-completion (Unit 1). Mutates
 * `items` in place, setting `bulkCompleted=true` on each member of any group of
 * ≥ BULK_COMPLETE_MIN closed Tasks sharing an exact (modifier, LastModifiedDate)
 * signature. Conservative: needs both a modifier id AND a modified timestamp.
 */
export function tagBulkCompleted(items, minGroup = BULK_COMPLETE_MIN) {
  const groups = new Map();
  for (const it of items) {
    if (it.isClosed !== true) continue;
    if (!it.lastModifiedAt || !it.lastModifiedById) continue;
    const key = `${it.lastModifiedById}|${it.lastModifiedAt}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const arr of groups.values()) {
    if (arr.length >= minGroup) for (const it of arr) it.bulkCompleted = true;
  }
  return items;
}

/**
 * Process a batch of SF activity records. Pure-ish: all I/O is injected via
 * `deps` so it can be unit-tested without a DB.
 *
 * @param {Array<object>} records
 * @param {object} ctx   — { workspaceId, actorId }
 * @param {object} deps  — { findEntityBySfId, appendActivityEvent }
 * @returns {Promise<{matched,skipped_no_entity,inserted,deduped,errors,total,results}>}
 */
export async function processSfActivityBatch(records, ctx, deps = {}) {
  const findEntity     = deps.findEntityBySfId || defaultFindEntityBySfId;
  const append         = deps.appendActivityEvent || defaultAppendActivityEvent;
  const advance        = deps.advanceCadence || defaultAdvanceCadence;
  const resolveCadence = deps.resolveCadenceForEntity || defaultResolveCadenceForEntity;
  const growCadence    = deps.growCadenceFromOutreach || defaultGrowCadenceFromOutreach;
  const resolveOrCreateSfContact = deps.resolveOrCreateSfContact || defaultResolveOrCreateSfContact;
  const openMismatch   = deps.openSfMismatchDecision || defaultOpenSfMismatchDecision;
  const enqueueResolve = deps.enqueueSfContactResolve || defaultEnqueueSfContactResolve;
  const { workspaceId, actorId } = ctx || {};

  const summary = {
    total: Array.isArray(records) ? records.length : 0,
    matched: 0,
    skipped_no_entity: 0,
    skipped_no_id: 0,
    inserted: 0,
    deduped: 0,
    errors: 0,
    replies_captured: 0,
    cadences_grown: 0,
    contacts_minted: 0,       // Unit 1 — WhoId contacts newly created as entities
    contacts_reconciled: 0,   // Unit 2 — WhoId contacts attached to an existing person by email
    mismatches_flagged: 0,    // Unit 3 — sf_contact_account_mismatch decisions opened
    contacts_queued: 0,       // SF-CONTACT-RECONCILE — unresolved WhoIds queued for the by-id resolver
    results: [],
  };
  // Unit 3 — emit at most one mismatch decision per entity per tick (the RPC is
  // idempotent on subject_ref regardless).
  const mismatchEmitted = new Set();
  // SF-CONTACT-RECONCILE Unit 1 — collect WhoIds the ingest could not resolve to
  // an LCC entity; flushed to sf_contact_resolve_queue after the loop.
  const toResolveWhoIds = new Set();

  if (!Array.isArray(records) || records.length === 0) return summary;

  // Accept EITHER the canonical shape ({sf_id, type, subject, ...}) OR the raw
  // Salesforce "Get records" field names ({Id, TaskSubtype, Subject, ...}) so
  // the PA flow can POST the SF output with no in-flow field mapping. Normalize
  // every record up front, then tag any admin bulk auto-completion across the
  // batch (Unit 1) before the per-record write loop.
  const items = records.map(normalizeSfRecord);
  tagBulkCompleted(items);

  for (const it of items) {
    const { rec, sfId, rawType, subject, descr, whoId, whatId, status } = it;

    if (!sfId) {
      summary.skipped_no_id += 1;
      summary.results.push({ sf_id: null, outcome: 'skipped_no_id' });
      continue;
    }

    // Resolve the LCC entity — Contact (who) first, then Account (what).
    let entity = null;
    let resolvedVia = null;
    try {
      if (whoId) {
        entity = await findEntity(workspaceId, 'Contact', whoId);
        if (entity) resolvedVia = 'contact';
      }
      if (!entity && whatId) {
        entity = await findEntity(workspaceId, 'Account', whatId);
        if (entity) resolvedVia = 'account';
      }
    } catch (err) {
      summary.errors += 1;
      summary.results.push({ sf_id: sfId, outcome: 'error', error: err?.message || String(err) });
      continue;
    }

    // SF-CONTACT-RECONCILE Unit 1/2 — the WhoId contact isn't yet an LCC entity,
    // but the feed carries its identity: MINT it (or ATTACH-by-email if it
    // already exists under CoStar/RCA — Unit 2). This is how a decision-maker on
    // an unmapped / misfiled SF account (Joseph Capra; Eric Dowling on "Arbor
    // Realty Trust") finally reaches LCC. Byte-identical no-op when the flow
    // omits the contact name/email — nothing is fabricated.
    if (!entity && whoId && MINT_SF_CONTACTS && (it.whoName || normalizeEmail(it.whoEmail))) {
      try {
        const minted = await resolveOrCreateSfContact({
          workspaceId, userId: actorId, whoId, accountId: whatId,
          name: it.whoName, email: it.whoEmail, first: it.whoFirst,
          last: it.whoLast, phone: it.whoPhone, title: it.whoTitle,
        });
        if (minted && minted.entityId) {
          entity = { entityId: minted.entityId };
          resolvedVia = minted.resolvedByEmail ? 'contact_reconciled_email'
            : (minted.createdEntity ? 'contact_minted' : 'contact');
          if (minted.createdEntity)   summary.contacts_minted += 1;
          if (minted.resolvedByEmail) summary.contacts_reconciled += 1;
        }
      } catch (_e) { /* best-effort — falls through to skipped_no_entity */ }
    }

    const entityId = entity?.entityId || null;
    if (!entityId) {
      // Never guess — record the skip so the feed is observable, but don't
      // manufacture an entity. SF-CONTACT-RECONCILE Unit 1: a WhoId we couldn't
      // resolve here (and isn't already an entity) goes to the by-id resolve
      // queue so the dedicated get-by-id worker can mint it later.
      if (whoId) toResolveWhoIds.add(whoId);
      summary.skipped_no_entity += 1;
      summary.results.push({ sf_id: sfId, outcome: 'skipped_no_entity', queued_who_id: !!whoId });
      continue;
    }

    summary.matched += 1;
    // SF-CONTACT-RECONCILE Unit 3 — an SF contact whose email-domain firm
    // contradicts its SF account is a Salesforce data-quality error. LCC FLAGS
    // it (a Decision-Center row) instead of inheriting the wrong account. Only
    // when the feed carries both the contact email and the account name.
    if (it.whatName && normalizeEmail(it.whoEmail) && !mismatchEmitted.has(entityId)) {
      const mm = sfContactAccountMismatch({ email: it.whoEmail, accountName: it.whatName });
      if (mm.mismatch) {
        mismatchEmitted.add(entityId);
        try {
          const flagged = await openMismatch({ workspaceId, entityId, detail: {
            contact_entity_id: entityId, sf_contact_id: whoId, sf_account_id: whatId,
            email_domain: mm.email_domain, account_name: mm.account_name,
            contact_name: it.whoName || null,
          } });
          if (flagged) summary.mismatches_flagged += 1;
        } catch (_e) { /* non-blocking */ }
      }
    }
    // OUTREACH #1 (RC1) — subject-aware so a plain SF Task that is really an
    // email/call advances the cadence instead of being a dead 'note'. Events
    // (Unit 2) are categorized 'meeting' directly inside normalizeSfRecord.
    const category = it.category;
    const replyTouch = isInboundReply(category, rec, subject);

    const metadata = {
      sf_id:     String(sfId),
      sf_kind:   it.kind,
      sf_type:   rawType,
      sf_status: status,
      // Completion is captured but SOFT (Unit 1): an admin bulk auto-completed
      // Scott's open Tasks, so IsClosed=true is NOT "successfully worked" and
      // nothing here infers "contacted/responded" from it.
      sf_is_closed:    it.isClosed,
      sf_completed_at: it.completedAt,
      who_id:    whoId,
      what_id:   whatId,
      activity_date: it.actDate,
      resolved_via: resolvedVia,
      owner_id:   it.ownerId,
      owner_name: it.ownerName,
    };
    if (it.lastModifiedAt)   metadata.sf_last_modified_at = it.lastModifiedAt;
    if (it.lastModifiedById) metadata.sf_last_modified_by = it.lastModifiedById;
    // Flag the admin bulk-completion fingerprint so the engine can discount it.
    if (it.bulkCompleted)    metadata.bulk_completed = true;
    // R24 Unit 2 — for an inbound reply, the JS advanceCadence path owns the
    // advance (sets emails_replied + the converted/pause branch), so tag the
    // event skip_cadence_advance='true' to keep the SQL trigger from also
    // advancing it (the R10 single-advance-owner doctrine).
    if (replyTouch) {
      metadata.is_reply = true;
      metadata.skip_cadence_advance = 'true';
    }

    let appendRes;
    try {
      appendRes = await append({
        workspaceId,
        actorId,
        category,
        title:       subject || `(SF ${category})`,
        body:        descr,
        entityId,
        sourceType:  'salesforce',
        externalId:  String(sfId),
        // Events anchor on StartDateTime, Tasks on ActivityDate/CreatedDate.
        occurredAt:  it.occurredAt,
        metadata,
      });
    } catch (err) {
      // appendActivityEvent never throws, but stay defensive.
      summary.errors += 1;
      summary.results.push({ sf_id: sfId, outcome: 'error', error: err?.message || String(err) });
      continue;
    }

    if (appendRes?.ok && appendRes.inserted) {
      summary.inserted += 1;
      // R24 Unit 2 — a freshly-inserted inbound reply advances the cadence
      // (emails_replied++, unopened reset, → converted). Only on `inserted` so
      // a re-POST of the same SF id (deduped) never double-counts. Best-effort:
      // a missing cadence or a failed advance never fails the mirror.
      let replyAdvanced = false;
      if (replyTouch) {
        try {
          const cad = await resolveCadence(entityId);
          if (cad?.id) {
            const adv = await advance(cad.id, { type: 'reply', direction: 'inbound', outcome: 'replied' });
            replyAdvanced = !!(adv && adv.ok);
            if (replyAdvanced) summary.replies_captured += 1;
          }
          // Slice 2 — feed the contact-selection pivot: a two-way reply locks the
          // owner's active contact (engaged → human takes over). Best-effort.
          const applyFeedback = deps.applyOwnerContactFeedback || defaultApplyOwnerContactFeedback;
          await applyFeedback(cad?.entity_id || entityId, 'two_way');
        } catch (err) {
          // non-blocking — the activity is recorded regardless
          replyAdvanced = false;
        }
      }
      // Phase 1 (2026-07-13) — GROW the cadence from real outreach (the
      // inversion, extended). When Scott logs SF/Outlook outreach on a real BD
      // target that has NO active cadence, seed one and advance it (the single
      // advance owner) so the cadence table grows from the people he actually
      // contacts. The grow gate is the LOOSER Phase-1 gate (SF identity OR >= 2
      // real outreach events, not the R63 value floor — repeated human outreach
      // IS the signal), it hops an asset touch to the OWNER, and it stamps the
      // person Scott emailed as the contact. All of that lives in the shared
      // growCadenceFromOutreach helper (reused by the Outlook + email_intake
      // writers too). Best-effort — never fails the mirror.
      else if (entityId && (category === 'email' || category === 'call' || category === 'meeting')) {
        try {
          const g = await growCadence({ entityId, category, domain: it.domain || null });
          if (g?.grown) summary.cadences_grown += 1;
        } catch (_e) { /* best-effort — the activity is recorded regardless */ }
      }
      summary.results.push({ sf_id: sfId, entity_id: entityId, outcome: 'inserted', reply_captured: replyAdvanced });
    } else if (appendRes?.ok) {
      summary.deduped += 1;
      summary.results.push({ sf_id: sfId, entity_id: entityId, outcome: 'deduped' });
    } else {
      summary.errors += 1;
      summary.results.push({ sf_id: sfId, entity_id: entityId, outcome: 'error', reason: appendRes?.reason || 'append_failed' });
    }
  }

  // SF-CONTACT-RECONCILE Unit 1 — flush the unresolved WhoIds to the resolve
  // queue in one bulk upsert (best-effort; never fails the mirror).
  if (toResolveWhoIds.size > 0) {
    try {
      const q = await enqueueResolve(Array.from(toResolveWhoIds), workspaceId);
      summary.contacts_queued = (q && q.queued) || 0;
    } catch (_e) { /* non-blocking */ }
  }

  return summary;
}

// ============================================================================
// HTTP handler
// ============================================================================

export async function handleSfActivityIngest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  const body = req.body || {};
  const records = Array.isArray(body) ? body
    : Array.isArray(body.records) ? body.records
    : Array.isArray(body.activities) ? body.activities
    : null;

  if (!records) {
    return res.status(400).json({ error: 'Body must be an array or { records: [...] }' });
  }
  if (records.length > MAX_BATCH) {
    return res.status(413).json({ error: `Batch too large (${records.length} > ${MAX_BATCH})` });
  }

  // activity_events.actor_id is NOT NULL → users(id); the SF record carries no
  // LCC user, so the authenticated caller is the actor for the mirror.
  const summary = await processSfActivityBatch(records, {
    workspaceId,
    actorId: user.id,
  });

  return res.status(200).json({ ok: true, ...summary });
}
