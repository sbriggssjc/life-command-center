# Contact Reconciliation (WebEx ↔ Outlook ↔ LCC) — the identity spine

_2026-07-30. One person = one LCC entity, resolvable by BOTH email (Outlook/correspondence) and phone (WebEx),
linked to the deal(s) they're a party to. This is §4 of `unified-intelligence-layer.md` — the prerequisite that
lets "an outbound call to number X" and "an email to contact X" close the SAME to-do, and that sharpens the
sent-email deal attribution the 2026-07-30 backfill surfaced. Extends existing infra; forks nothing._

## Why (the concrete gap the backfill exposed)
The Sent-Items backfill attributed 30/42 sends to entities — but several landed on the **person** (Nick Taylor,
Edwin Ryu…) instead of the **asset/deal**, because the matcher takes the most-recent entity mentioning the
recipient. And a WebEx call (phone only) can't attribute at all yet, because no phone→entity link exists. Both are
the same missing primitive: **a resolved identity keyed on email AND phone that also knows the person's deals.**

## Build on (don't fork)
- **`external_identities`** (LCC Opps) — the canonical link table (`source_system`, `source_type`, `external_id` →
  `entity_id`), guarded by `canonicalIdentitySystem()` + `chk_external_identities_source_system`. Today it carries
  domain assets, owners, CMS, and vendor channels (costar/salesforce/email_intake…).
- **`api/_shared/entity-link.js`** — `ensureEntityLink` (the R4-A choke point: junk/federal guards + email-resolution
  tier + SF-account-as-org edge). The single place a link is created — reuse it.
- **`owner_contact_pivot`**, `lcc_institution_contacts`, `unified_contacts` — existing contact stores.
- **`deal-email-matcher.js`** — attributes email→deal by tenant+city; reuse for contact→deal.
- **ORE / `lcc_merge_entity`** — the authority-weighted reconcile + the single backref-mover for merging duplicate
  person entities (the RCG-dedup pattern, applied to people).

## The model
Two new identity channels on the SAME entity, plus a resolver:
- `source_system='outlook'`, `source_type='email'`, `external_id=<lowercased email>` → person entity.
- `source_system='webex'`,  `source_type='phone'`, `external_id=<E.164 phone>`   → person entity.
Both must funnel through `canonicalIdentitySystem()` (register `outlook`/`webex`) and pass the CHECK — **register
the new source_systems first** (the "never introduce a new spelling" invariant), or the writer 500s.

`lcc_resolve_contact(p_email text, p_phone text)` → `{ entity_id, name, confidence, deals[] }`:
1. Exact hit on `external_identities` (email or normalized phone) → the entity.
2. Else match by normalized email/phone/name across person entities; if a single high-confidence match, **link**
   (write the missing identity) and return it; if multiple, return candidates (resolve-or-refuse — never blind-merge).
3. `deals[]` = the asset/deal entities this person is a party to (via `entity_relationships` deal_party edges +
   correspondence), so callers can attach to the deal, not just the person.

## Build steps (order)
1. **Register `outlook` + `webex` source_systems** in `canonicalIdentitySystem()` + extend the CHECK constraint
   (additive migration, provenance-safe).
2. **Phone/email normalizers** — E.164 for phone; lowercase-trim for email (pure, unit-tested).
3. **Backfill `external_identities('outlook','email')`** from existing correspondence: every distinct correspondent
   email already resolved to a person entity → write the link (fill-blanks, dedup). Immediately sharpens attribution.
4. **`lcc_resolve_contact(email, phone)`** RPC (above) — the single resolver every surface calls.
5. **Sharpen `handleOutlookSent` attribution** — resolve the recipient → prefer the **deal/asset** entity from
   `deals[]`; attach the touch to BOTH the contact and the deal (or the deal when present). Fixes the backfill finding.
6. **WebEx contact import** → `external_identities('webex','phone')`, matched to person entities by email/name overlap
   (surface ambiguity to a review lane; never guess). Enables call attribution + call-based auto-retire (§3).
7. **Dedup fragmented person entities** (RCG/Frank pattern) via `lcc_merge_entity`, provenance-tagged, reversible.

## Invariants
- **Register the source_system spelling** before writing (canonical scheme; CHECK-enforced).
- **Resolve-or-refuse** on ambiguity; **fill-blanks**, **provenance-tagged**, **confidence-scored**, **reversible**;
  duplicate-merge only through `lcc_merge_entity` (the single backref-mover). Never a blind merge.
- One resolver in the engine → every surface (sent-email, WebEx, dossier, cadence) resolves identity identically.

## First implementable slice
Steps 1–3 + 5: register the source_systems, backfill `outlook` email identities from correspondence, ship the
resolver, and point `handleOutlookSent` at it to prefer the deal. That alone fixes the attribution finding and lays
the phone-ready identity table for the WebEx layer — no WebEx dependency to start.

## Progress (2026-07-30)
- **`lcc_resolve_contact(email, phone)` — built + live.** Resolves the person entity (`entities.email` →
  `external_identities` outlook → phone) AND the deal(s) via a **city bridge** — real deal-assets
  (`bd_opportunities`) whose city appears in an activity title mentioning the email (the same bridge
  `lcc_offer_context` uses). Verified: `frankm@rcgventures.com` → `primary_deal` = Snellville ✓.
- **`handleOutlookSent` now prefers `primary_deal`** (asset/deal over person), falling back to the most-recent
  correspondent. `node --check`-clean. **Deploy to activate.**
- **KEY FINDING — the deeper fix:** correspondence is NOT linked to asset entities; both `lcc_offer_context` and
  this resolver lean on the **city bridge** (title match), which is fuzzy and can't attribute a same-city
  same-brand ambiguity. The clean fix is linking **correspondence → deal at INGEST** via `deal-email-matcher.js`
  (tenant+city attribution → set `activity_events.entity_id` to the asset). Once correspondence carries the asset
  `entity_id`, the resolver's deal lookup becomes a direct graph read, not a heuristic. **This is the next
  connectivity item** (and it retro-sharpens offer-context, the dossier, and the sent-email attribution at once).
- **Existing 42 backfilled sent rows** were attributed the old (person-preferring) way and are dedup-locked, so a
  re-run won't re-point them — re-attribute via a one-time `UPDATE ... SET entity_id = lcc_resolve_contact(...)`
  over `source_type='outlook_sent'` rows (reversible).
- **Remaining in slice:** person-entity resolution when the email isn't on a person entity (e.g. Frank Meyrath has
  none) — backfill `external_identities('outlook','email')` or set `entities.email`. WebEx phone side (register
  `webex` source_system + import) is the following slice.
- **Dual-anchor backfill (2026-07-30):** the 42 existing `outlook_sent` rows re-stamped **non-destructively** —
  `metadata.deal_entity_id` (OPEN deal) on **25**, `metadata.party_entity_id` on **9**, across **4** deals;
  `entity_id` untouched (reversible via `metadata.dual_anchor_backfilled`). Honors relationship-primary: no
  single-deal overwrite. **Next 3 threads to finish the linkage:** (a) projections (`lcc_offer_context`,
  deal-dossier) should PREFER `metadata.deal_entity_id` over the fuzzy city bridge; (b) the LIVE inbound path
  (`handleOutlookMessage`/`stageOmIntake`) stamps the same dual anchor at ingest; (c) **party backfill**
  (email→person entity, name+email match → fill `entities.email`/`external_identities('outlook')`) to lift party
  coverage past 9/27 — the piece that makes the relationship dossier real.

## Thread (c) BUILT — SF-sourced party backfill (2026-07-30)

**The clean-source decision.** Correspondence carries no sender NAMES (the historical `outlook` rows store only
`from_email`/`to_emails`/`cc_emails`; the `outlook_sent` rows store `from`/`to`). So a person entity can't be
minted from the mail itself without fuzzy body-name extraction — which would seed junk. The authoritative
email↔name↔account source is **Salesforce**. The backfill therefore resolves each unresolved correspondent
**email** against SF and links the person through the SAME machinery the WhoId resolver uses — no new fuzzy path.

**Honest scope (measured 2026-07-30, OPS `xengecqvemvfknjvbvrq`).** Over 6,455 historical `outlook` + 43
`outlook_sent` rows: **2,560 distinct external correspondents** (excluding `@northmarq.com` colleagues, Scott's
own personal address, and system noise; personal domains like gmail/yahoo/rr.com are KEPT — heavy-volume sellers
use them). Only **334 resolve** to an entity today (`entities.email`); **2,226 are unresolved**. The head is
Zipfian and is exactly the durable BD graph: DaVita real-estate contacts (Holdsworth 711, Moore 649, Pagnano
414), cooperating brokers (CBRE, Cushman, Kidder, Adler, ValueNet), title (First American), and counsel. **294**
correspondents have ≥10 touches; **458** have ≥5.

**How it's keyed (self-clearing, no queue table).** `lcc_unresolved_correspondents(p_limit, p_min_touches,
p_nomatch_cap, p_error_cap)` (OPS) materializes the correspondent universe, LEFT JOINs `entities.email` (already
resolved) and `correspondent_backfill_log` (terminal outcomes), and returns the ranked workable head
(highest-touch first). An email leaves the set the instant an entity carries it OR the log records a terminal
outcome — nothing to keep in sync. **Reversible:** delete a `correspondent_backfill_log` row to re-queue an email.

**The worker.** `api/_handlers/correspondent-party-backfill.js` — `GET` = dry-run (ranked head, no SF calls),
`POST` = drain (bounded by `limit` + `SF_RESOLVE_BUDGET_MS` wall-clock). Per email:
`findSalesforceContactByEmail(email)` → on a hit, `defaultResolveOrCreateSfContact({whoId: SF Contact Id, name,
email, accountId, …})` — which routes through `ensureEntityLink`'s **R39 email tier** (ATTACH-by-email to an
existing CoStar/RCA/SF person = one entity, never a duplicate) and the junk/implausible-person **name guards**
(garbage is rejected, never minted). SF account↔email-domain mismatches are surfaced to the Decision Center
(best-effort, never inherited). Feature-gated on `SF_LOOKUP_WEBHOOK_URL` — no-ops honestly (`byemail_configured:
false`) when unset. **Never writes back to Salesforce** (LCC-writes-back doctrine off); the only SF touch is the
read-only email lookup.

**Routing.** `GET|POST /api/correspondent-party-backfill-tick` (server.js → operations.js `_route`, guarded by
`test/operations-subroutes.test.mjs`, positioned before the bridge action router). Sibling to
`/api/sf-contact-resolve-tick` (WhoId-keyed) — the two drains cover the same identity spine from both ends.

**Runtime constraint (why the drain runs after deploy).** `findSalesforceContactByEmail` executes **server-side**
on the Railway engine (holds `SF_LOOKUP_WEBHOOK_URL`); it is NOT callable from a DB/MCP session. So the DB
enumeration + worker + routes were built here, and the SF-dependent drain runs once deployed — same operator loop
as every other tick worker.

**Drain procedure (after redeploy).**
1. Dry-run: `GET /api/correspondent-party-backfill-tick?min_touches=10` — confirm the ranked head + counts, no writes.
2. Drain the high-value head: `POST /api/correspondent-party-backfill-tick?limit=25&min_touches=10`, repeat until
   `workable_returned` drops (each tick is bounded; `no_match` is negative-cached so re-ticks don't re-hammer SF).
3. Lower `min_touches` (5 → 2 → 1) to widen coverage down the long tail as the head clears.
4. Spot-check: a resolved correspondent (e.g. `susan.holdsworth@davita.com`) should now carry `entities.email`,
   so a fresh sent/inbound email from them stamps `party_entity_id` — closing the loop the dual-anchor backfill left open.

**Status:** RPC + `correspondent_backfill_log` applied live (OPS); worker + routes in the working tree,
`node --check`-clean, imports resolve, subroute guard 4/4 green. **Deploy to activate**, then run the drain.

### Deliverable — SF-contact-gap worklist (`backfill-artifacts/`)

The `no_match` set is not failure noise — it is a **Salesforce coverage gap**. Delivered `TeamBriggs_Salesforce_Contact_Gaps.xlsx`
(saved under `docs/architecture/backfill-artifacts/`, with `build_worklist.py` + `README.md` for regeneration): 295
no-match correspondents classified by domain into business types (title/escrow, cooperating broker, buyer/capital,
legal, lender, consultant, government, client/operator) vs personal/noise, ranked by touch volume. Workflow: add
the high-value business contacts to SF → delete their `correspondent_backfill_log` row (re-queues) → re-drain →
they link to their full email history.

**OPEN — business/personal/overlap classification remediation (Scott, 2026-07-30).** The current split is a crude
**domain heuristic** and Scott flagged it explicitly: the personal/noise bucket contains real business contacts
(a client or broker who corresponds from gmail/yahoo lands in "Personal"), and some parties **genuinely overlap**
(both a personal relationship and a BD counterparty). Domain alone cannot separate these. The remediation signal is
**behavioral, not lexical**: a personal-domain address that (a) appears in threads whose subject/body names a
property/deal, (b) co-occurs with known business contacts, (c) matches a Salesforce **Lead** (not just Contact),
or (d) sends during business context → promote to business (or tag `overlap`). Design intent: replace the
single-label domain CASE with a **scored, multi-signal classifier** writing a `party_kind` = business | personal |
overlap (with provenance), so the worklist and the packet layer both respect the relationship's true nature. This
is its own thread — do NOT let the crude domain buckets harden into truth. Until built, treat the worklist's
Personal tab as "likely personal, verify" not "excluded."

### BUILT — behavioral party-kind classifier (2026-07-30)

The remediation above is now built. `correspondent_kind` (OPS) + `lcc_recompute_correspondent_kind()` classify
every external correspondent as **business | overlap | personal | noise** from BEHAVIOR, not domain. The domain is
a weak prior; the strong, precise signal is **distinct CRE-deal-keyword threads**: the count of DISTINCT email
subjects (normalized of re/fw prefixes) matching an institutional-CRE vocabulary (LOI, offer, PSA, escrow, cap
rate, NNN, listing, BOV, tenant, DaVita, dialysis, GSA, net lease, 1031, estoppel, guarantee, build-to-suit,
investment grade, underwrite, lease). Verdict: non-personal domain → **business**; personal domain with ≥3
*distinct* deal threads → **overlap** (verify); personal domain below that → **personal**; automated/newsletter
→ **noise**. Signals (`deal_msgs`, `distinct_deal_subjects`, `touches`) are stored per row (provenance);
recompute truncates + rebuilds (reversible, re-runnable as mail grows).

**Why co-occurrence was rejected.** The first attempt scored "shares a thread with a business domain," which
misfired badly: Scott runs **personal real-estate deals** (e.g. subject "101 DALMATIAN") that pull in KW, Stan
Johnson, and a title company, so a family member on that thread looked "business." And Scott emails family from
his Northmarq address, so "co-occurs with Northmarq" is meaningless. Distinct-CRE-thread count is the signal that
separates a real BD contact (many institutional deal threads) from a personal RE thread (one) or a family blast
(zero).

**Validation (2026-07-30).** Classified 2,875 correspondents → 2,397 business / 436 personal / 32 noise / 10
overlap. Spot-checks held: `susan.holdsworth@davita.com` = business (66 distinct deal threads),
`chad.stark@cbre.com` = business (5); the family/blast members `bigdogtroop149@gmail.com`,
`ellentbriggs@yahoo.com`, `jeremyfulda@gmail.com` = personal (0 deal threads, correctly NOT promoted despite the
"101 DALMATIAN" CRE co-participants); overlaps surfaced real personal-domain principals with deal history
(`jzweiback@gmail.com` 5, `chou.patricia@gmail.com` 5, `olaassem@aol.com`, `sunit1027@hotmail.com`,
`tomnikolich@yahoo.com`, `julie.f.gillespie@gmail.com` 11 — the last likely Scott's personal RE, which is exactly
why overlap = "verify," not "business").

**Worklist v2** (`backfill-artifacts/`, `build_worklist_v2.py`) is regenerated by `party_kind`, not domain: the
no-match set reclassifies to **215 business + 5 overlap actionable, 63 personal + 11 noise excluded** (294 rows;
one no-match address fell outside the classified universe). Overlaps float to the top of the Add-to-Salesforce
tab in peach with a per-row note ("N distinct deal threads — confirm client/BD vs personal RE") and a Deal-Threads
column so Scott sees the evidence. The blast/family clusters that polluted v1's Personal tab now correctly carry
0 deal threads.

**Reuse.** `correspondent_kind.party_kind` is the canonical business/personal/overlap verdict for the packet
layer too — a projection can filter to business+overlap parties, and the overlap set is the human-review queue.
**Tuning knob:** the overlap threshold is `distinct_deal_subjects >= 3` inside `lcc_recompute_correspondent_kind()`
— lower it to widen the verify net. Recompute after any new correspondence ingest.

**Human overrides (durable).** `correspondent_kind_override` (email → party_kind + note) is consulted at the END
of the recompute, so a manual verdict SURVIVES the truncate+rebuild (recompute would otherwise wipe it). Scott's
first verdicts (2026-07-30): the 5 no-match overlaps — julie.f.gillespie, curtisblasingame, tomnikolich,
michaelmadden4444, nadeem.shoukry — confirmed **business**. (Overlap dropped 10→5 globally, 5→0 in the worklist.)

**Vendor sub-tier (BUILT 2026-07-30).** A 5th kind, `vendor`: a business-DOMAIN facilities/service provider
(paint, pest, HVAC, janitorial, roofing, waste — a CONSERVATIVE curated pattern) is not a BD counterparty, so it
drops out of the add-to-SF worklist + BD cadence while staying distinct from personal/noise. **Detection is
curated, NOT behavioral** — the calibration finding was decisive: `distinct_deal_subjects = 0` is NOT a vendor
signal (CBRE 151 contacts / Colliers / Stan Johnson / JLL / Cushman brokers all legitimately show 0 because
individual brokers rarely hit the deal-keyword regex), so a behavioral gate would demote real brokers. Result: 4
vendors caught (spectrumpaint, tulsapaintco, rentokil-terminix ×2), **zero brokers demoted**; travel/loyalty
MARKETING blasts (Marriott, Southwest) folded into `noise` (+3). Worklist v2 excludes vendor+noise+personal.

**Still crude / next refinements (documented, not silently assumed solved):** (a) a Salesforce **Lead** match
would be a strong business signal but isn't wired (the no-match set is by definition absent from SF Contacts;
Leads are a separate object — a future `find_lead_by_email` op); (b) the CRE keyword + vendor pattern lists are
hand-curated — worth revisiting as new deal/vendor vocabulary appears; (c) ambiguous domains left as `business`
on purpose (e.g. `sarhanhotelgroup` could be a hotel-owning principal, `verizon.net` a client's ISP address) —
the override is the correction path, not a broader auto-rule.

## Multi-channel auto-resolve BUILT — a call (not just a send) closes a to-do (2026-07-30)

The capture layer was complete (email in/out + calls all on the dual-anchor spine); this closes the
Producer/Consumer loop from that capture — real activity, any channel, auto-retires the to-do it satisfies
(doctrine: close the loop from activity, not a separate manual queue). `lcc_autoresolve_offer_review` only closed
`offer_review` on a send; generalized to **`lcc_autoresolve_todos(p_entity_id, p_activity_id, p_party_entity_id,
p_channel, p_direction)`** (OPS, live):
- **offer_review** — an outbound submission to the DEAL completes it (unchanged semantics).
- **follow_up** ("reach out to new contact / party") — an OUTBOUND touch of ANY channel (email sent OR call
  placed) to the PARTY *or* the DEAL completes it. Resolves `open`+`in_progress`; leaves waiting/completed/
  cancelled. The dual anchor is what makes this work: the activity carries both its deal and its party, so a
  deal-tagged send/call also clears a party-level follow_up.
- **Guardrails:** only `p_direction='outbound'` auto-resolves (an inbound reply / received call never closes a
  "you reach out" to-do — returns `not_outbound`); high-confidence only; provenance-stamped
  (`auto_resolved`, reason `offer_submission_sent`|`outreach_touch`, channel, `reversible:true`); honest per-type
  counts returned. `lcc_autoresolve_offer_review` kept as a thin **delegating wrapper** so the deployed caller
  never breaks.

Wiring: `handleOutlookSent` now calls `lcc_autoresolve_todos` with the party + `email`/`outbound` (so a send also
clears party follow_ups, not just the deal's offer_review); `logCallDualAnchor` calls it for OUTBOUND calls with
`call`/`outbound`. Both stay gated on `!backfill` / fresh-insert so replayed history never mass-closes to-dos.

**Verified:** DB smoke (non-match → 0 closed; inbound → `not_outbound`, real to-dos untouched); `call-dual-anchor`
test asserts an outbound call invokes `lcc_autoresolve_todos` and a received call does NOT (17/17 suite green);
`node --check` clean. **Deploy to activate** (DB fn live now; JS ships on the redeploy). Current to-do taxonomy is
thin (`offer_review`, `follow_up`) — as new `action_type`s appear, add their outbound-satisfied premise here.

## WebEx call layer BUILT — calls join the dual-anchor spine (2026-07-30)

WebEx call history was ingested (`contacts-handler.js::ingestWebexCalls` → `/telephony/calls/history`) but only
fed **`unified_contacts`** (engagement scoring, GOV db) — calls never reached the **OPS `activity_events` spine**,
so they were invisible to the deal dossier, offer-context, and cadence, and the relationship graph knew emails but
not calls. Worse, `lcc_resolve_contact`'s phone tier queries `external_identities.source_system='webex'`, but the
CHECK constraint forbade `webex`, so that tier was **inert** (no webex rows could ever exist).

Built:
- **`external_identities` CHECK widened** (live) to allow the phone/identity systems the unified-contacts pipeline
  already uses: `webex, teams, iphone, icloud, manual, sms`. The resolver's `webex` phone tier is now live; phone
  identities can persist and resolution sharpens as they accrue (until then it falls back to `entities.phone`).
- **`logCallDualAnchor`** (`api/_shared/intake-correspondence.js`) — the telephony mirror of the email loggers.
  Resolves the caller's PARTY + OPEN deal **by phone** (+ email if known) via `lcc_resolve_contact` and appends a
  `call` activity (`source_type='webex_call'`) stamped with `metadata.party_entity_id` + `deal_entity_id`
  (`entity_id` = the open deal, nullable → rides the party). Direction inferred (placed→outbound / received→inbound);
  deterministic dedup `external_id` = `webex:<last10>:<time>` (WebEx call history has no stable call id). Relationship-
  primary, fire-and-forget, deduped on `(workspace, source_type, external_id)`.
- **Wired into `ingestWebexCalls`** — each ingested call now ALSO lands on the spine (fire-and-forget; never blocks
  the `unified_contacts` engagement update). So a call from a known party attaches to its relationship + open deal
  exactly like an email; from an unknown number it logs the raw call and back-fills its anchors once the party
  enters the graph.
- **Verified:** `test/call-dual-anchor.test.mjs` (4/4) + full correspondence/inbound suite (16/16 green);
  `node --check` + import clean on both files. **Deploy to activate** (DB CHECK is live now; the JS ships on the
  Railway redeploy). The ingest stays gated on the WebEx OAuth token (`WEBEX_ACCESS_TOKEN`/refresh) — unset → the
  whole path no-ops honestly (503 on the action), so the spine-logging inherits that gate.

**Now the spine is multi-channel:** outbound email, inbound email, AND calls all stamp the same dual anchor at
ingest — the relationship-primary, deal-subfilter model the whole thread has been building. Follow-ups: (a) mint a
`webex` phone identity on a resolved call so future calls from that number resolve without re-deriving; (b) SMS/
Teams calls reuse `logCallDualAnchor` with `source_system` set accordingly; (c) generalize
`lcc_autoresolve_offer_review` → `lcc_autoresolve_todos` so a call (not just a send) can auto-resolve a to-do.

## Thread (a) BUILT — projections prefer the deal anchor over the city bridge (2026-07-30)

With mail now carrying `metadata.deal_entity_id` (backfill + thread b), the projections stop leaning on the fuzzy
city bridge:

- **`lcc_offer_context` (OPS)** — correspondence was gathered by `entity_id = deal` **OR `title ilike '%city%'`**
  (the city bridge over-matched unrelated same-city deals). Now: precise anchor first — `entity_id = v_eid OR
  metadata->>'deal_entity_id' = v_eid` — and correspondents are extracted from BOTH the body regex AND the
  dual-anchor metadata (inbound `from`, outbound `to[]`), so stamped mail surfaces even when the address isn't in
  the body snippet. The **city bridge is now a FALLBACK**, used only when the deal has zero anchored mail (older
  pre-stamp deals). Response carries `corr_source: deal_anchor | city_bridge_fallback` for observability.
  Verified on "DaVita Dialysis - The Villages": `corr_source=deal_anchor`, 5 correspondents, all the actual deal
  team (First American title rep on "1050 Old Camp Rd", the appraiser, the OM sender) — no fuzzy city noise.
- **Deal dossier (`mcp/deal-dossier-tools.js::readDossier`)** — read `entity_id` ONLY, which MISSED anchored
  mail: the dual-anchor backfill preserved original `entity_id` and stamped the deal in `metadata.deal_entity_id`,
  so only 1 of 16 anchored rows carried `entity_id = deal`. Now reads BOTH anchors (two simple PostgREST filters
  merged + deduped in JS — avoiding an `or()` with a JSON accessor, which is version-sensitive). Verified: The
  Villages dossier goes from **46 → 61** correspondence rows (the 15 metadata-only stamped rows now surface).
  `node --check` + import clean. **Deploy to activate** (DB fn is live immediately; the dossier JS ships on the
  Railway redeploy).

## Thread (b) BUILT — live inbound dual-anchor stamp (2026-07-30)

The outbound path (`handleOutlookSent`) already stamps the dual anchor; the **inbound** path did not, so new mail
didn't self-resolve to the relationship without a re-drain. Now it does. `logInboundCorrespondenceDualAnchor`
(`api/_shared/intake-correspondence.js`) is the inbound mirror: on every flagged inbound email
(`handleOutlookMessage`), it resolves the **sender's** PARTY (durable BD unit) + OPEN deal (active sub-context) via
`lcc_resolve_contact` and logs an `outlook_inbound` `activity_events` row stamped with `metadata.party_entity_id`
+ `deal_entity_id` (and `entity_id` = the open deal, nullable → attention rides the party). Fire-and-forget +
deduped on `(workspace, source_type='outlook_inbound', internet_message_id)`, so PA's 3–6 replays are a no-op and
it never blocks OM intake. This closes the loop the earlier `logEmailIntakeCorrespondence` left open — that one
only fired on a confident property/OM match, so ordinary inbound BD mail (a broker reply, a seller note) was never
logged or party-stamped; now it always is.

- **Wiring:** `intake.js` imports the helper and calls it right after `emailContext` is built, before the inbox
  dedup/OM-staging logic.
- **Verified:** `test/inbound-dual-anchor.test.mjs` (5/5) — external stamps dual anchor; internal/no-id skipped;
  resolver-miss and resolver-throw still log the raw touch with null anchors (re-drainable). `node --check`-clean.
- **Deploy to activate.** Once live, a flagged inbound email from a resolved party self-stamps; from an
  as-yet-unresolved party it logs the raw touch and back-fills its anchors the moment the party enters the graph
  (via the SF-sourced backfill above), with no re-processing of the email.
- **Effect on the model:** inbound + outbound now both carry the dual anchor at ingest — the relationship-primary,
  deal-subfilter spine stays current going forward without backfills. Remaining forward threads: (a) projections
  (`lcc_offer_context`, deal-dossier) should PREFER `metadata.deal_entity_id` over the fuzzy city bridge;
  (b) the party/personal classifier above; (c) WebEx call layer (register `webex` source_system).

### Live drain results (2026-07-30, deploy `ba725dbf14b1`)

Drained the entire **≥5-touch** band (head + 5–9 band) via `POST /api/correspondent-party-backfill-tick`.
Runtime note: `findSalesforceContactByEmail` runs server-side, so the drain was triggered from the cloud session
against the live engine using the `X-LCC-Key` header (base `tranquil-delight-production-633f`). `no_match` cap
lowered from 2→1 mid-run (a `no_match` is definitive — a transient SF failure returns `error`, not `no_match` —
so a single pass suffices; halves tail cost).

- **163 resolved** to `person` entities (144 carry the email directly; ~19 are alias/secondary addresses of an
  already-linked person — see alias note below). Verified real: Deana Moore & Michelle Pagnano (DaVita), Nick
  Cartus (ValueNet), Trent Jemmett (CBRE), Scott Briggs (Stan Johnson), etc. Attach-by-email reused existing
  CoStar/RCA/SF entities (no duplicates).
- **295 no_match**, **0 errors**. Both ≥5 bands now at **0 remaining**.

**FINDING — the `no_match` set is a Salesforce coverage gap, not noise.** A large share of Scott's most active
counterparties are absent from SF **by that email**: `susan.holdsworth@davita.com` (711 touches), many
`@firstam.com` (First American title), `@cbre.com` / `@stanjohnsonco.com` cooperating brokers, `@foley.com` /
`@ltglegal.com` / `@buchalter.com` counsel, and government tenant/buyer contacts (`@gsa.gov`, `@ssa.gov`,
`@boydwatterson.com`, `@easterlyreit.com`). The rest is genuine noise (newsletters, docusign, personal/family
mail) and correctly stays unmatched. Because LCC has no SF admin and never writes back to SF, the clean action
is: add the high-value ones to Salesforce, then **delete their `correspondent_backfill_log` row to re-queue** and
re-drain. (A future option: mint a provisional person entity from correspondence for no_match *business* domains,
but the historical `outlook` rows carry no display name — name source would still need to come from SF or the OM.)

**Alias gap (the ~19).** When two correspondent emails map to the same SF contact, the person entity carries the
SF *primary* email; the alias resolves (logged, entity linked) but `entities.email` holds the primary, so a future
mail from the alias won't stamp `party_entity_id` by email. Follow-up: write resolved aliases as
`external_identities('outlook','email')` on the linked entity so alias mail also resolves. Low volume; deferred.

**Long tail (min_touches 1–4, ~2,100 mostly one-off/no_match) NOT yet drained** — deliberately paused to protect
the Power Automate daily request quota (a 2,000-lookup burst could throttle Scott's other flows). It is durable
and self-caching, so it can run incrementally over days: `POST …?limit=20&min_touches=1` repeated, or lower the
band as the head clears. Awaiting Scott's go-ahead.
