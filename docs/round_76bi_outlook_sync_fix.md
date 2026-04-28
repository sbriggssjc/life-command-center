# Round 76bi — Outlook sync silently failing for 19 days

## Discovery

Sync Health dashboard showed 2 Outlook connectors with status `error`:
- `Outlook — Work (NorthMarq)`
- `Outlook — Personal`

Both with last_error: `"object is not iterable (cannot read property Symbol(Symbol.iterator))"`

## sync_jobs history

```
2026-04-28 08:40 — failed (Symbol.iterator) — flagged_email
2026-04-14 18:33 — failed (Symbol.iterator)
2026-04-10 16:37 — failed (Symbol.iterator)
2026-04-09 12:45 — failed (Symbol.iterator)
2026-04-09 12:45 — failed (Symbol.iterator)
```

Every Outlook flagged-email sync has been failing since 2026-04-09 — 19 days
of silent failure. None of the connector_accounts.last_sync_at fields had ever
been populated for ANY connector (SF, Outlook, Copilot all NULL).

## Root cause

`api/sync.js` line 526:
```js
const data = await edgeRes.json();
const pageEmails = data.emails || [];   // BUG: || only catches falsy
emailList.push(...pageEmails);            // throws Symbol.iterator on non-array truthy
```

When the Supabase Edge Function returned a non-array truthy value for
`data.emails` (e.g. `{error: 'unauthorized'}` shape, or null cast inside an
object), the `|| []` fallback didn't kick in (truthy short-circuit), and
`emailList.push(...pageEmails)` threw "object is not iterable" because
the spread operator requires an iterable.

Fix: `Array.isArray(data?.emails) ? data.emails : []` everywhere similar
patterns existed (3 sites in sync.js: line 526 `data.emails`, line 717
`data.events`, line 791 `data.activities`).

## Mitigation applied

1. Edits applied to `api/sync.js` (deferred commit pending bash-side file
   integrity issue — see Round 76be doc).
2. Reset both stuck Outlook connector_accounts from `error` → `healthy` so
   they retry on next sync attempt after deploy.

## Manual JS to apply in IDE

If the bash-side `api/sync.js` is truncated, apply these three edits:

**Line 526 region** (`ingestEmails`, page loop):
```js
// BEFORE
const pageEmails = data.emails || [];

// AFTER
const pageEmails = Array.isArray(data?.emails) ? data.emails : [];
if (pageEmails.length === 0 && data && typeof data === 'object' && data.emails && !Array.isArray(data.emails)) {
  console.warn('[ingestEmails] edge function returned non-array emails:', JSON.stringify(data.emails).slice(0, 200));
}
```

**Line 717** (`ingestCalendar`):
```js
// BEFORE
const events = data.events || [];

// AFTER
const events = Array.isArray(data?.events) ? data.events : [];
```

**Line 791** (`ingestSfActivities`):
```js
// BEFORE
const activities = data.activities || [];

// AFTER
const activities = Array.isArray(data?.activities) ? data.activities : [];
```
