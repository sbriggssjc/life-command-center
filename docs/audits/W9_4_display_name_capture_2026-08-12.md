# W9.4 unlock — Outlook display-name capture (2026-08-12, Prompt 96)

**Status: SHIPPED (code).** The single upstream fix that lights up all three W9.4
comms sub-arms (header pairs, signature attribution, create-contact). Forward-only
— no backfill of the 7,751 existing bare-header rows. Flag `W9_2_REACHABILITY_HARVEST`
stays OFF until accrual is verified (see the gate below).

## Root cause (grounded in Prompt 94's dry-run)

Of 7,751 business-attributed correspondence rows, **0 carried a header display
name**. The Outlook ingestion loggers FLATTENED Graph's `{ name, address }`
recipient objects to the bare email string, so `activity_events.metadata.from`/`to`
held only addresses. The harvest header-pair arm keys on the display name → 0
proposals. ~~`email_bodies.from_name` was already stored, but the canonical
`activity_events` spine (what `harvestBuildCommsIndex` reads) was not.~~

> **CORRECTION (2026-08-13, prompt 101 grounding):** the claim above is FALSE —
> `email_bodies.from_name` is NULL on ALL 23,071 rows; no structured historical
> display name exists in email_bodies OR the activity_events spine. The real
> structured name store is **`unified_contacts`** (17,527 named). Prompt 101's
> accelerator reconstructs each row's display name by looking up the emails
> already on the row in `unified_contacts` (Prompt-93 reconstruction pattern),
> provenance-marked `source:'unified_contacts'`. Do NOT rely on email_bodies for
> names.

## The flattening points (all four correspondence writers) — now fixed

| Writer | Source type | Path | Fix |
|---|---|---|---|
| `handleOutlookSent` | `outlook_sent` | `api/intake.js` | `metadata.from_name` + `metadata.to_names[]` |
| `handleOutlookMessage` → `logInboundCorrespondenceDualAnchor` | `outlook_inbound` | `api/intake.js` + `api/_shared/intake-correspondence.js` | `emailContext.from_name`/`to_names` → `metadata.from_name`/`to_names` |
| `handleOutlookMessageExtract` | `outlook` | `api/_shared/bridge-handlers-outlook.js` | `metadata.from_name` + `metadata.to_names[]` (already had the Graph shape) |
| `intake-tagged-comm` | `outlook_tagged` | `api/_handlers/intake-tagged-comm.js` | `metadata.from_name` + `metadata.to_names[]` |

Shared parser: `api/_shared/outlook-recipients.js` (`parseAddress` / `parseAddressList`) —
accepts the Graph object array, an array of strings, and `';'`/`','`-delimited
`Name <email>` strings; preserves the name, dedups by email, never fabricates an
address. Additive to `metadata` jsonb (no schema change, fill-blanks: a field is
only present when the payload actually carried a name).

Reader: `harvestBuildCommsIndex` (`api/admin.js`) now extracts `structuredPairs`
from `metadata.from_name` (+ `from`/`from_email`) and `metadata.to_names[]` and
binds each name↔email directly — the cleanest header-pair source when present.
Bare-email rows behave exactly as before (0 names → falls to the create-contact
participant path).

## What is code-only vs. what needs a Power Automate flow change

- **FROM display name — code-only, live now.** The sender name is already in the
  payload (`normalizeSender`/Graph `emailAddress.name`); the loggers simply
  discarded it. Fixed with no flow change. New sent + bridge + Graph-shaped
  inbound mail carries `from_name` immediately.
- **TO/CC display names — needs a PA flow change for the string-based paths.** The
  flagged-inbound / sent flows post `To`/`Cc` as a bare semicolon-separated email
  string (no names), so `to_names` stays empty until the flow includes names. The
  code already ACCEPTS the richer shape; it just needs the flow to send it. The
  bridge path (`handleOutlookMessageExtract`) already receives the full Graph
  `toRecipients` array with names — no change there.

### Power Automate flow change (exact steps for Scott)

For the **flagged-email inbound** flow and the **Sent-Items** flow that POST to
`/api/intake?_route=outlook-message` and `?_route=outlook-sent`:

1. Open the flow → the action that POSTs to LCC (the "HTTP" / "Post to LCC" step).
2. In the JSON **Body**, keep the existing fields. Change the recipient fields so
   they carry names, using the trigger's rich recipient collection:
   - If your trigger exposes **`To recipients`** as a collection with
     `Name`/`Address` (e.g. "When a new email arrives (V3)" → dynamic content
     `To`), add a **Select** action (Data Operations → Select):
     - **From:** `triggerOutputs()?['body/toRecipients']` (or the To collection).
     - **Map** (switch to text mode) to:
       `concat(item()?['emailAddress']?['name'], ' <', item()?['emailAddress']?['address'], '>')`
     - Then add a **Join** action (Data Operations → Join) on that Select output
       with separator `; ` → produces `Jane Roe <jane@x.com>; Bob Smith <bob@y.com>`.
   - Put the Join output into the body's **`to_recipients`** field (and repeat a
     Select+Join for **`cc_recipients`**).
3. Leave `from` as-is if the flow already sends the Graph `from` object; otherwise
   set `from` to `concat(triggerOutputs()?['body/from/emailAddress/name'], ' <', triggerOutputs()?['body/from/emailAddress/address'], '>')`.
4. Save. No other body field changes. The LCC endpoint parses both the old
   bare-email string and the new `Name <email>` string — safe to deploy either
   order.

> If a trigger only exposes recipients as a plain string of addresses, that flow
> simply keeps yielding no `to_names` (harmless); only the FROM name will land
> until the trigger/flow is upgraded to the V3 recipient collection.

## Second starvation finding (Prompt 94, item 4) — probed, reported, NOT scoped here

*"0 correspondence entities map to a `true_owner`."* This is a **separate linkage
gap**, not the missing-name issue:

- Correspondence is stamped with the **deal / party / property** entity the
  resolver found (`metadata.party_entity_id` / `deal_entity_id`, or `entity_id`).
  Those are person/deal/asset entities.
- The create-contact arm resolves an ops entity → domain `true_owner` via
  `external_identities` (`source_type='true_owner'`). None of the 309 linked
  correspondence entities carry a `true_owner` external identity, because a
  correspondent (a broker, a buyer, a seller contact) is a **party**, not the
  **owning LLC entity**. The owner entity is reached through the property→owner
  graph, not through who emailed.
- Preserving display names does **not** change this — it is orthogonal. Closing it
  would require either (a) attributing owner-linked mail through the
  property→`true_owner` join when a correspondent resolves to an owned asset, or
  (b) minting owner contacts from the ORE owner graph. Both are their own unit;
  flagged here for a follow-on, deliberately not built in Prompt 96.

## Operator gate before flipping the flag

Unchanged from Prompt 94, now unblocked:

1. Redeploy Railway (this code) + apply the PA flow change above.
2. After a few days' accrual: `GET /api/reachability-harvest-tick?score=1&n=10`
   → confirm `comms_counts.header_name_pairs` (and signature/create-contact) is
   non-zero with verbatim quotes and `scan_errors:[]`.
3. Review the sampled sheet → flip `W9_2_REACHABILITY_HARVEST` → on.

## Tests

`test/outlook-recipients.test.mjs` (15): Graph-shaped payload preserves names,
RFC/delimited string parsing, comma-in-quoted-name safety, dedup, internal-email
drop, the reader's `structuredPairs` extraction (inbound + mailbox-mirror shapes),
bare-email-only rows yield zero pairs (privacy/behavior unchanged), and a
cross-check that the parser agrees with the harvest planner's `parseHeaderAddress`
on shared string forms. `test/reachability-harvest-planner.test.mjs` (50) still
green.
