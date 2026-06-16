# Claude Code — R28: reconcile the Inbox to the intake pipeline + activate captured contacts

## Why (grounded live on LCC Opps, 2026-06-15)
The Inbox is a capture/notification surface that only flows IN — it never reconciles to
the pipeline that actually processes its items, and the "activate" terminal is unused.
- `inbox_items`: **1,604 `new`** (= the Today "Inbox New" / drives the flagged count),
  accumulating continuously **2026-04-06 → 06-15**, against **`promoted` = 1 ever**.
  (Disposition IS happening — triaged 4,651 / dismissed 1,980 / archived 3,433 — so it's
  worked, but the "promote into the BD spine" terminal is essentially never used.)
- The `new` pile: **602 flagged_email + 465 email_om + 116 sidebar/folder/copilot OM
  (1,183 OM-type) + 421 new_contact_qualify**.
- The OM extraction pipeline is **healthy and independent**: `staged_intake_items` took
  **877 email intakes in the last 7 days**, finalizing normally (3,387 email + 449
  copilot finalized; `matched` is a clean <24h transient). The OM inbox rows carry **no
  link** to their `staged_intake_item` and have **no mechanism to clear** when the intake
  finalizes — so they pile up forever and inflate the count (same trust-eroding class as
  the R25 sync-error widget: an inflated number that buries the genuinely-actionable
  items).
- The 421 `new_contact_qualify` = **347 persons (212 with email) + 74 orgs (46
  junk-flagged)**, ALL relationship-linked to the entity graph — i.e. real CoStar-captured
  contacts parked, never activated. Meanwhile **190 active cadences still have no
  contact** (R16/R20 left a cold tail). So these captured emailable persons are a direct
  **contact SOURCE for the outreach engine**, not just hygiene.

## Unit 1 — reconcile OM/email inbox notifications to the intake pipeline
Make "Inbox New" reflect genuinely-pending work, two parts:

**(a) Forward linkage + auto-resolve (the durable fix).**
- Where the OM/flagged inbox notification is created (the `stageOmIntake` path in
  `api/_shared/intake-om-pipeline.js` plus the flagged_email / sidebar / folder-feed
  creators), stamp the **`staged_intake_items` id** onto the inbox row
  (`inbox_items.metadata.intake_id`, or a nullable `intake_id` column — additive).
- Auto-resolve: when the linked intake reaches a TERMINAL state
  (`finalized`/`discarded`), flip the inbox notification to `archived` (or a new
  `resolved` status) — via a trigger on `staged_intake_items` status change, or a small
  reconcile cron. So an OM notification clears the moment its document is processed; the
  inbox shows only what still needs a human.
- Keep it a notification, not a second pipeline: do NOT re-process the OM from the inbox
  (the auto-pipeline owns extraction). The inbox row is just a status mirror.

**(b) Backfill the existing 1,183 OM-type `new` rows.**
- Reconcile-by-`file_name` to a terminal intake clears ~144 (verified). For the rest:
  **age-based archive** — OM/flagged notifications older than 30 days are stale by
  construction (the auto-pipeline has long since processed that document); bulk-flip them
  to `archived` with a source tag (`auto_archived_stale_notification`), reversible.
- Net: "Inbox New" drops from 1,604 toward the genuinely-pending remainder (recent
  unprocessed + the contact-qualify set).

**(c) Count honesty.** The Today "Inbox New" / flagged widgets should count only
non-resolved actionable rows (exclude the auto-archived notifications) — same principle
as the R25 sync-error fix.

## Unit 2 — turn `new_contact_qualify` into a value-ranked worklist that feeds outreach
The 421 captured contacts are connected to the graph but never activated. Surface them as
a bounded worklist (like a Decision Center lane), NOT a 421-deep inbox pile:
- **Source view**: `new_contact_qualify` inbox items, **exclude `junk_name_flagged`**
  (57: 11 person + 46 org — these route to the existing junk lane), **persons-with-email
  first** (212), ranked by the value of the entity they're related to (reuse the existing
  `rank_annual_rent` / connected-value machinery via the contact's `owns`/`associated_with`
  edge to an owner/property).
- **"Qualify" action** (the activate terminal): link the captured person to its
  owner/parent entity as a usable contact (`associated_with`, dupe-guarded — reuse the
  R16 `contact-attach.js` helpers) AND, when that owner has an active contactless cadence,
  offer to **stamp it as the cadence's prospecting contact** (the R20 self/stamp path) —
  directly feeding the 190 cadences that lack a contact. At minimum, qualifying sets the
  inbox row to a terminal status so it leaves the pile.
- This connects captured CoStar contacts → qualify → owner cadence → outreach, closing a
  real flow gap (and giving the now-ready outreach engine more reachable targets).

## Guards / house rules
- Additive, reversible (status changes + a source tag; no hard deletes — the disk-safe
  LCC Opps rule). Auto-archive is a status flip, fully reversible.
- Reuse existing machinery: `contact-attach.js` (R16) for linking/stamping; the
  rank/connected-value views (R17) for ordering; the junk guard (`isJunkEntityName`).
- ≤12 `api/*.js` (resolver/worklist in an existing handler/_shared; no new function
  file). `node --check`; suite green. Cross-table reads stay on the existing
  domainQuery/anon-view paths.
- **Auth blast radius**: `inbox_items` is on LCC Opps (auth DB) — the trigger/cron is a
  bounded status-update on a non-auth table; verify no long locks, and that the reconcile
  cron is gentle (the artifact-offload connection-exhaustion lesson — small batch, modest
  cadence).

## Acceptance / verify live
- After backfill: "Inbox New" drops from 1,604 to the genuinely-pending remainder; a
  newly-finalized intake auto-resolves its inbox notification within one cron tick (or
  immediately via trigger).
- The contact-qualify worklist shows the ~212 emailable persons value-ranked, junk
  excluded; qualifying one links it to its owner and (where applicable) stamps a
  contactless cadence — and the row leaves the pile.
- Today widget counts agree with the bounded actionable source.

## Bottom line
The intake EXTRACTION is healthy; the INBOX around it is an un-reconciled notification
pile that overstates work and parks real captured contacts. R28 closes the loop (notifications
auto-clear when their intake finalizes) and turns 212 captured contacts into a
value-ranked feed for the outreach engine that's now ready but contact-starved.
