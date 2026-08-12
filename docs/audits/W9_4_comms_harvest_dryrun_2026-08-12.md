# W9.4 — Comms-harvest arm dry-run + grounding (2026-08-12, Prompt 94)

**Status: BUILT (third arm of the W9.2 tick; flag `W9_2_REACHABILITY_HARVEST` stays OFF).
Grounded honestly: the arm is correct and complete, but INPUT-STARVED today — the yield
is gated on ONE upstream fix (preserve Outlook header display names at ingestion).**

W9.4 does NOT fork a new unit — it extends the live W9.2 reachability-harvest tick
(`/api/reachability-harvest-tick`), lane (`reachability_harvest_review`), fill-blanks
writer, cron (04:40 UTC) and flag with **correspondence (`activity_events`) as a third
input source**. One flag, three arms.

## The three comms sub-arms (all reuse the existing two-arm split)
1. **Header pairs → DETERMINISTIC arm.** `parseHeaderAddress` over `metadata.from/to`
   + mailbox-mirror `from_email/to_emails/cc_emails`. A display **name** bound to a valid,
   non-internal, non-generic **email/phone** matching a blank contact's normalized name →
   arithmetic fill (confidence 1.0), provenance `comms_observed`, source pointer = message id.
2. **Signature phones → LLM arm.** `extractSignaturePhones` over the body's signature
   region → assembled as evidence under the sender's header name; the SAME verbatim-quote
   validator keeps only a proposal whose quote contains BOTH the name and the phone/email.
3. **Create-contact → `target_kind='owner'`.** A thread participant (external email +
   name) attributable to an owner (ops entity → domain `true_owner` via
   `external_identities`) that has **zero** contact rows → a propose-CREATE-contact card.
   Minted ONLY via a human verdict, never auto (bulk-confirm excludes it).

## Live grounding (LCC Opps `xengecqvemvfknjvbvrq`, 2026-08-12)

Correspondence spine, harvestable slice (business-attributed, `visibility<>'private'`,
correspondence source_types):

| metric | value |
|---|---|
| correspondence rows (non-private, correspondence source_types) | **7,823** |
| business-attributed rows (deal/party/entity/linked anchor) | **7,751 (99%)** |
| rows whose header carries a DISPLAY NAME (`Name <email>`) | **0** |
| rows with a phone in the body (signature source) | **2,410** |
| distinct linked owner/entity ids | **309** |
| linked entities that map to a domain `true_owner` (via `external_identities`) | **0** |

### Honest read — input-starved today (surface, don't oversell)
- **Header-pair arm = 0 today.** Every stored header is a **bare email** — the Outlook
  ingestion (mailbox-mirror `from_email`/`to_emails`, the `handleOutlookMessage`/`_Sent`
  loggers) flattens Graph's `{name,address}` to the address only, so there is no display
  name to bind. The deterministic header arm is correct and fires the moment names are
  preserved; today it proposes 0.
- **Signature LLM arm = 0 keyable today.** 2,410 bodies carry a real phone (the best phone
  source in the system — e.g. broker signature blocks), but the arm keys the evidence to a
  blank contact by the **header display name**, which is absent (above). Without a cheap
  name key we will not fan every phone-bearing body across every blank contact (combinatorial
  blow-up), so the arm holds until the key exists.
- **Create-contact arm = 0 today.** The 309 linked entities on correspondence are **deals /
  properties / parties**, none of which resolve to a domain `true_owner` identity in
  `external_identities` — so no correspondence currently attributes to an *owner* with no
  contact. Correct guard (never guess an owner); 0 is honest.

### The single unlock (recommended next, one upstream change)
Preserve the **header display name** at Outlook ingestion — capture Graph's
`from.emailAddress.name` / `toRecipients[].emailAddress.name` alongside the address in the
mailbox-mirror store and the inbound/sent loggers (`metadata.from_name`/`to_names`, and a
`from_name`/`to_names` on the mirror row). That one field lights up **all three** comms
sub-arms at once (header pairs bind, signature phones key under the sender name, and richer
party attribution feeds create-contact). It is forward-only (does not backfill the 7,823
existing bare-header rows) and connector-adjacent (the W7.6 mailbox-mirror flow already has
the name in the Graph payload). Tracked as the W9.4 follow-on, NOT built in this prompt.

## What shipped (correct + tested, ready when the input lands)
- Planner helpers (pure, unit-tested): `parseHeaderAddress`, `isInternalEmail`,
  `isGenericInbox`, `commsRowHarvestable` (privacy-scope + attribution gate),
  `commsRowEntityAnchors`, `extractSignaturePhones` + `signatureRegion`,
  `buildCommsHeaderProposal`, `commsNewContactSubjectRef`, `HARVEST_SOURCE_COMMS`.
- Tick (`api/admin.js`): `harvestBuildCommsIndex` (ONE bounded, paged, privacy-scoped scan
  of `activity_events`), `harvestResolveOwnersWithoutContacts` (batched ops-entity →
  domain-owner → zero-contact resolution), comms-header deterministic + comms-signature LLM
  merged into `buildFreshHarvestItems`, and the create-contact (`target_kind='owner'`)
  producer + apply loop. Dry-run (`?score=1`) reports per-source counts
  (`comms_scan`, `comms_counts`, `create_contact_fresh`) + a sampled sheet.
- Verdict path (`api/admin.js`): `target_kind='owner'` confirm MINTS a domain contact
  (name+email+phone, `data_source='comms_observed'`), stamps provenance on name/email/phone,
  is idempotent (skips a dup email under the owner → conflict card), and is reversible via
  `reachability_harvest_apply_log` (reversal.record_id = the new contact_id).
- DC lane (`dc-lanes.js`): a create-contact card variant; the deterministic bulk-confirm
  excludes `target_kind='owner'` (a mint is always a per-card decision).
- Migration `20260827120000_lcc_w9_4_comms_harvest.sql` (applied live): 2 NAME-field
  `comms_observed@40` `field_source_priority` rows (create-contact provenance) so
  `v_field_provenance_unranked` stays 0 for the reachability fields; flag notes refreshed to
  describe all three arms. **No new table** — extends W9.2.
- Tests `test/reachability-harvest-planner.test.mjs` (34, all pass): header extraction,
  privacy-scope exclusion, phone regex + verbatim validator, create-contact-never-auto,
  arm routing, cursor walk + structural guards.

## Operator gate before the flag flip
The flag stays **OFF**. Because the arm is input-starved today, flipping now produces the
same result as W9.2 alone. Recommended order:
1. Land the header display-name ingestion capture (the unlock above).
2. Redeploy Railway → `GET /api/reachability-harvest-tick?score=1&n=10` and confirm
   `comms_counts` shows non-zero header/signature/create-contact yield with verbatim quotes
   and `scan_errors:[]`.
3. Review the sampled sheet, then flip `W9_2_REACHABILITY_HARVEST` → on — one flag now runs
   all three arms nightly at 04:40 UTC.
