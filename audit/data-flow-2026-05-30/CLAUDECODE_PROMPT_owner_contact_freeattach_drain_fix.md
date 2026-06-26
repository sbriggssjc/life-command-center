# Claude Code (life-command-center) — fix the owner-contact-enrich FREE-attach drain (88 named decision-makers stuck)

## Why (grounded live on LCC Opps `xengecqvemvfknjvbvrq`, 2026-06-26)

The owner-contact-enrich worker is supposed to attach an already-identified named
decision-maker to a worklist owner with NO external dependency (branch (a)
`attachPersonToOwner`). It isn't happening:

- `owner_contact_pivot`: **172 rows. 88 are `status='active', enrichment_action IS
  NULL`** — i.e. the attach-person / manager-drill class, with a real named pick
  already on the row (`active_contact_name` = "LOMANGINO CHARLES" / MGR, "Anil
  Goel" / economic_owner_contact, "WILD CHRISTOPHER" / MGR, "HALBERSTEIN DANIEL",
  "POPACK MOSHE", "Mike Hooper", …; `active_authority_level` 2–3). The other 84
  carry an external `enrichment_action` (36 sos / 42 address / 6 public_ir) — NOT
  this round.
- **Only 2 of the 88 have `active_contact_entity_id` set** (and that pair traces
  to the reverted Slice-3 live test — so effectively **0 real attaches**).
- The cron `lcc-owner-contact-enrich` (jobid 139, `25 5 * * *`) is **active and
  has succeeded daily** since the 06-20 pivot seeding (last 2026-06-26 05:25,
  status succeeded), posting `/api/owner-contact-enrich-tick?limit=25`. Seven
  successful ticks, ~0 attaches.

These 88 are all `updated_at=2026-06-20` (the oldest), and the batch selector
orders `updated_at.asc` — so they are FIRST in line every tick, yet never drain.

## Root-cause hypothesis (confirm, then fix)

In `processOwnerEnrichmentRow` (`api/_handlers/owner-contact-enrich.js:121-125`),
branch (a) runs `attachPersonToOwner(...)` and **returns its result immediately**,
whatever it is:
```js
if (row.active_contact_name && looksPerson(row.active_contact_name)) {
  const r = await attachPersonToOwner(row, row.active_contact_name, row.active_contact_role, deps, 'contact_selection');
  return { entity_id: row.entity_id, ...r };   // returns even on guard_rejected / error
}
```
If `attachPersonToOwner` is NOT producing `outcome:'attached'` (e.g. a guard
rejection inside `ensureEntityLink`, a failed `linkPersonToEntity`, a failed
`owner_contact_pivot` PATCH of `active_contact_entity_id`, or a silent throw),
the pivot is left unchanged — `active_contact_entity_id` still null, `updated_at`
unchanged — so the SAME oldest 25 churn every tick and the rest are never reached.
That matches the live evidence exactly (0 progress, oldest rows stuck).

**Investigate `attachPersonToOwner` end-to-end against these real rows** and find
why it doesn't land:
1. Does `looksLikePersonName` PASS for these names? Several are "LASTNAME
   FIRSTNAME" all-caps ("LOMANGINO CHARLES", "KOROL ELENA"), some carry a trailing
   initial or suffix ("MOTISI MEEGAN T", "Henry John A IV"). If `looksPerson`
   REJECTS them, branch (a) is skipped AND branch (b) only runs at
   `authority_level<=2` — the `level=3` economic-owner picks (Anil Goel, Mike
   Hooper, …) would then fall all the way to the external chain and (with no
   adapter) the manual worklist, never attaching a perfectly good person name.
   That's a misclassification bug: a real person name in "LAST FIRST" / with a
   middle initial should attach, not route to SOS.
2. If `looksPerson` PASSES, trace `attachPersonToOwner`: `ensureEntityLink`
   (does a guard — junk / implausible-person / federal — reject the all-caps or
   middle-initial form?), `linkPersonToEntity`, `stampContactOnActiveCadence`,
   and the `owner_contact_pivot` PATCH that sets `active_contact_entity_id`. Find
   which step fails and why it fails silently (returns non-`attached` without
   surfacing).
3. Confirm whether the cron's `limit=25` batch is genuinely re-processing the
   same stuck 25 each tick (because failures don't advance `updated_at`), starving
   the rest — if so, the fix below also unblocks the tail.

## The fix (minimal, evidence-driven — implement what the diagnosis shows)

Likely a combination; do what the diagnosis supports:
- **Name handling:** make the attach path accept legitimate human names in
  "LAST FIRST", all-caps, and middle-initial/suffix forms — normalize to
  "First Last" before the `looksLikePersonName` gate and before minting the
  person entity (so "LOMANGINO CHARLES" → "Charles Lomangino", "MOTISI MEEGAN T"
  → "Meegan T Motisi"). A real decision-maker name must not be rejected as
  non-person or misrouted to SOS because of casing/word-order.
- **Don't silently churn:** when branch (a)'s `attachPersonToOwner` does NOT
  attach (genuine guard rejection), the row must not be left identical to re-churn
  forever — either fall through to branch (b)/(c) appropriately, or record the
  failure reason and advance `updated_at` / set an `enrichment_action` so the
  batch moves on and the tail drains. Keep it honest (never fabricate a contact),
  but a real rejection should change state, not loop.
- **Surface the outcome:** the tick summary already returns
  attached/drillthrough/skipped — make a non-attaching branch-(a) row report WHY
  (guard_rejected reason / link_failed / patch_failed) so the next audit isn't
  blind.

## Verify

- `node --check api/_handlers/owner-contact-enrich.js`; `ls api/*.js | wc -l` = 12;
  suite green.
- Add/extend `test/owner-contact-enrich.test.js`: a "LAST FIRST" all-caps name
  and a middle-initial name both classify as `attach_person` and attach (person
  minted as "First Last", `active_contact_entity_id` set); a genuine guard
  rejection advances state instead of returning an unchanged row.
- **Live proof after deploy:** run the worker (a capped `POST
  /api/owner-contact-enrich-tick?limit=25`, or wait for the cron) and confirm the
  88 free-attach pivots start draining — `active_contact_entity_id` populates,
  those owners drop off `v_owner_contact_worklist`, and the count of
  `enrichment_action IS NULL AND active_contact_entity_id IS NULL` falls toward 0
  across successive ticks. Cowork will verify the live drain.

## Boundaries

- life-command-center; feature branch per CLAUDE.md; no new api/*.js (stays 12);
  no migration (pivot columns exist). Reversible (each attach = a person entity +
  a relationship + the pivot pointer).
- Scope: the FREE attach/manager-drill class (the 88). Do NOT build the external
  SOS/address adapters here — that's a separate, larger piece (the 78 contactless
  owners), tracked separately.

## Bottom line

88 high-value owners already have a named decision-maker identified and need zero
external lookup — but the worker's branch-(a) attach isn't landing (likely a
LAST-FIRST/all-caps/middle-initial name-handling rejection that also starves the
batch by never advancing the stuck rows). Fix the name handling + the silent-churn
so the free attaches drain, connecting those owners with no scraper and no cost.
