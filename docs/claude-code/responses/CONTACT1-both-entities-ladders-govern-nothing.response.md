# CONTACT1 — entities.email/phone have TWO authority ladders and neither has governed anything (2026-09-03, diagnosis only)

**No code shipped.** This is a measurement/diagnosis prompt (subsumed backlog **PR5c-enforce** and
**PR10**). Report only.

## The writer census — the real finding, bigger than the two-ladder question

`bridge-handlers-salesforce.js::handleSalesforceContactUpsert` — the function PR5c-entities-b
instrumented with provenance recording — **has never run.** `enrichment_jobs` has zero rows of
type `salesforce.contact.upsert` ever. The file's own header claims *"the highest-traffic writer
of entities.email/phone: 10,086 lifetime, 336 in 30 days"* — that population is real, but it is the
output of a **different, unrecorded writer**, misattributed.

Traced via `external_identities.metadata->>'synced_via'` on the last 30 days of `salesforce/Contact`
mints (336 total):
- **195** stamped `salesforce-sync.v1` → `api/_shared/salesforce-sync.js::writeEntitySalesforceLink`,
  called from `syncSalesforceForEntity` (cron 165 `lcc-sf-contact-resolve`, every 30 min).
- **141** stamped `null` — not traced further, but confirmed NOT `bridge-handlers-salesforce.js`
  (its stamp `phase1.bridge-handlers-salesforce` appears **0** times).
- The entity itself (carrying the email at creation) is minted by `sf-list-import.js` calling
  `ensureEntityLink` (`entity-link.js`) **directly**, bypassing
  `bridge-handlers-salesforce.js::insertEntity` entirely.

**None of `ensureEntityLink`, `salesforce-sync.js`, or `sf-list-import.js` calls
`recordFieldWrites`/`shouldWriteField` anywhere** (grepped, zero hits). The ladder PR5c-entities-b
wired up is attached to a **dead function**; the two real live writers of `entities.email/phone`
from Salesforce data are still completely invisible to both ladders.

Confirmed live: deploy is current (`git merge-base --is-ancestor` the PR5c-entities-b commit
against the live `/version` sha → yes); `field_provenance` for `target_table='entities'` is still
only the 4 `domain_owner_contact`/phone rows — zero salesforce rows, zero
`provenance_write_failed` alerts (the dead code path never even attempts a write to fail).

## The two-ladder question

- **Ladder A** (`field_provenance` via `lcc_merge_field`): 10 rungs on `entities.email/phone`, all
  `enforce_mode='record_only'`. Rows ever written: **4** (phone/`domain_owner_contact`, from one
  manual `owner-contact-propagate` tick on 2026-09-03). **email has never been recorded once.**
- **Ladder B** (`metadata.field_sources`, read by `planContactFieldPromotion`): exists on **exactly
  1 entity** in the whole table (phone/salesforce).
- Both ladders are empty **because nothing that actually writes these columns consults either
  one** — not because there's no history to grade yet, but because the wiring landed on unused
  code.
- **`SF_CONTACT_WRITEBACK` is off, `off_since` NULL.** Reading the handler: it pushes
  LCC-resolved contacts OUTBOUND to Salesforce — the direction `CLAUDE.md` explicitly forbids
  (*"Salesforce is minimum-necessary and NOT cleaned by LCC... never writes back to clean SF"*).
  The flag being off reads as standing doctrine, not a pending rollout.
- **`owner-contact-propagate` has no cron** — confirmed absent from `cron.job` (11 other
  contact-family jobs exist; this isn't one of them). Its one live run today (4 provenance rows, 4
  phones filled, 31 reviews queued from 25 owners scanned) was manual. Unscheduled, not broken.
- **`sf-list-import.js`'s CREATE lane is live and quiet, not dead**: 142 `salesforce/Contact` mints
  in 14 days (~10/day), roughly matching earlier predictions — fine, just unrecorded.

## PR10 recommendation

`field_provenance` should own the decision; `metadata.field_sources` should retire to a private
per-writer cache (or be deleted). It is fleet-wide, queryable, has a registry with real rungs, and
its `shouldWriteField` gate is what `planContactFieldPromotion` itself reads back next run.
`metadata.field_sources` is a second, undiscoverable copy of the same judgement with no registry,
no cross-writer visibility, and (per PR5c-entities' own lesson) a lie in it self-perpetuates
because the writer trusts its own stamp. **But this recommendation is currently moot** — before it
matters, the real writers need to be pointed at `field_provenance` at all.

## Numeric unblock condition for PR5c-enforce

Grade `enforce_mode` only once `field_provenance` for `(target_table='entities', field_name IN
('email','phone'))` exceeds **~50 rows spanning ≥2 distinct sources** with real write/skip/conflict
decisions — today it's 4 rows, 1 source, all `write`. Until then there is no disagreement history
to grade a warn/strict flip against.

## What outranks this — filed as new backlog

**The dead-code misattribution is the headline.** PR5c-entities-b shipped, merged, deployed, and is
provably exercising zero real traffic while its own commit header asserts a 10,086-row population
it never touches. This is a `docs/architecture/field-provenance-ladder.md` correction in its own
right, independent of the ladder-ownership question this prompt asked. Filed as **CONTACT1a**: repoint
`ensureEntityLink` / `salesforce-sync.js` to call `recordFieldWrites` (or relocate the
PR5c-entities-b provenance block to where the traffic actually is) — not built here; it touches the
live person-entity mint path (`ensureEntityLink`) far beyond Salesforce, so scoping it is its own
prompt.

## What was NOT done (by design)

No `enforce_mode` flip. `SF_CONTACT_WRITEBACK` not enabled. No `field_provenance` backfill. No third
ladder added. No code changed.
