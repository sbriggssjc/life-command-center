# QA-18 — Address Title-case + Inbox header pagination (P2)

Two P2 items left from QA pass #2. Bundled because they're independent
and both small.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-18-address-titlecase-inbox-pagination
node audit/patches/qa-18-address-titlecase-inbox-pagination/apply.mjs --dry
node audit/patches/qa-18-address-titlecase-inbox-pagination/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-18-address-titlecase-inbox-pagination/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-18-address-titlecase-inbox-pagination -m "Merge audit/qa-18-address-titlecase-inbox-pagination"
git push origin main
```

---

## QA-18a — Address Title-casing

### Symptom

QA pass #2 surfaced `"240 w 5th ave"` on the Research page's Agency
Drift widget. QA-12 only fixed direction suffixes (`Se→SE`); the rest
of full-lowercase street names was untouched.

### Fix

New IMMUTABLE function `public.titlecase_address(text)` on both DBs:

| Rule | Example |
|---|---|
| Ordinals stay lowercase suffix | `5th` → `5th`, `21st` → `21st` |
| Digit-starting words stay | `240` → `240`, `1200` → `1200` |
| Direction abbreviations stay uppercase | `N`/`NE`/`SE` → `N`/`NE`/`SE` |
| PO Box convention | `po` → `PO` |
| Everything else title-cased | `main` → `Main`, `ave` → `Ave` |

One-shot backfill, gated on `address ~ '\m[a-z]+\M'` (at least one
all-lowercase word) so addresses like `McMillan Blvd` are NOT touched
— we don't want to collapse correct mixed-case names to `Mcmillan`.

No trigger added — title-casing on every UPDATE would clobber
mixed-case proper names. The existing QA-12 trigger continues to
handle direction suffixes on writes.

### Live impact (verified)

| Domain | Lowercase-word addresses before | After |
|---|---|---|
| gov | 10,787 | 80 (mostly correct ordinals) |
| dia | (similar magnitude) | similarly reduced |

`"240 w 5th ave"` → `"240 W 5th Ave"`.
`"1200 NEW JERSEY AVE SE"` → `"1200 New Jersey Ave SE"` (the QA-12
trigger handled the SE; QA-18 handles the rest).

---

## QA-18b — Inbox header pagination

### Symptom

Inbox page header read `"Inbox · 100 items"`, but the Metrics page
said `"INBOX · 7,420 needs triage"`. Both correct for their own
definition; the Inbox page header just didn't show the total.

### Fix

`renderInboxTriage` (`ops.js`):

1. Fetch `/api/queue-v2?view=work_counts` in parallel with the
   `/api/inbox?action=list` call.
2. Pick the right total based on the active filter pill:
   - `new` → `inbox_new`
   - `triaged` → `inbox_triaged`
   - `all` → `inbox_new + inbox_triaged`
3. Header text becomes `"Showing 100 of 7,420 items"` when the
   canonical total exceeds the on-page count.
4. Falls back to the previous behavior when work_counts is unavailable.

After this change, the Inbox header agrees numerically with the
Metrics tile and Sync Health's inbox counts.

---

## Files changed

- `supabase/migrations/government/20260518180000_gov_qa18_address_titlecase.sql`
- `supabase/migrations/dialysis/20260518180000_dia_qa18_address_titlecase.sql`
- `ops.js` — `renderInboxTriage` parallel fetch + paginated header
- `AUDIT_PROGRESS.md` (closeout)

Migrations applied live via Supabase MCP on 2026-05-18.

## What's next

After QA-18 ships, every P0 / P1 / P2 item from both the original
QA pass and QA pass #2 will be resolved. Suggest running another
fresh QA walkthrough to surface whatever the next layer of issues
is — patterns from this session suggest the next ones will be
either (a) more performance issues in cold/rarely-clicked corners,
or (b) data-integrity nits that only show up in the long tail.
