# QA-21 — Clamp negative "Xd ago" on Contacts page (P2)

**Severity: P2.** Twelve+ contacts on the Contacts page showed e.g.
`"-123d ago"`, `"-189d ago"`, `"-4d ago"` for last-activity timestamps.
Caused by sync glitches (Salesforce bridge writing a future
`modified_date`, etc.). Confusing for the operator and looks like a
display bug even though the underlying data is at fault.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-21-contacts-negative-date-clamp
node audit/patches/qa-21-contacts-negative-date-clamp/apply.mjs --dry
node audit/patches/qa-21-contacts-negative-date-clamp/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-21-contacts-negative-date-clamp/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-21-contacts-negative-date-clamp -m "Merge audit/qa-21-contacts-negative-date-clamp"
git push origin main
```

## Root cause

`contacts-ui.js` `relativeDate(dateStr)`:

```js
const days = Math.floor((now - d) / (1000 * 60 * 60 * 24));
if (days === 0) return 'Today';
if (days === 1) return 'Yesterday';
if (days < 7) return days + 'd ago';   // ← catches days = -123
…
```

When `d` is in the future, `days` is negative. The first three branches
return correctly for 0 and 1, but `-123 < 7` is true, so the function
returns `"-123d ago"`.

## Fix

One-line guard at the top:

```js
if (days < 0) return 'Recent';
```

`'Recent'` matches the cadence/freshness vocabulary the rest of the app
uses for time-window-undefined activity (and pairs nicely with the
"Just now" used by `_lccFmtFreshness` and `freshnessLabel` which already
handle negatives correctly because they check `< 60000` / `< 5` minutes
before any subsequent branches).

## Other freshness helpers — already correct

- `formatDate` (app.js line 781) — handles `diff < 0` with `"In Xd"`
- `_lccFmtFreshness` (app.js line 1616) — first branch catches negatives via `< 60000`
- `relDate` (ops.js line 187) — designed for due-dates, handles both directions
- `freshnessLabel` (ops.js line 171) — first branch catches negatives via `< 5` minutes

Only `relativeDate` in `contacts-ui.js` had the bug.

## What we did NOT fix here

The underlying data — 12 contacts on the visible Contacts page have a
future `modified_at` / `last_activity_date` value. That's a sync-side
bug worth investigating (likely Salesforce bridge writing
`fields_changed_at` with a future timestamp, or a timezone mismatch
between the source system and our store). Captured as a follow-up:

- **QA-22 (deferred):** investigate the upstream that's writing future
  timestamps to contact records, add ingest-side guard.

## Files changed

- `contacts-ui.js` — `relativeDate` clamps negative days to `'Recent'`
- `AUDIT_PROGRESS.md` (closeout)
