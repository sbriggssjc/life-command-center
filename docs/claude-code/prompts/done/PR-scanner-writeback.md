# PR-scanner-writeback — finish wiring the county/recorder/SOS scanner into real captures, and surface netronline routing

**Read first:** `docs/architecture/public-records-source-lane.md` §7 (this prompt IS that section's
plan, in full) and §2/§2a (the fabrication finding — why the model-leg tax/parcel data must never be
treated as real, and why this scanner's OUTPUT must be clearly marked as a different, real source) ·
`docs/architecture/account-based-contact-intelligence.md` §8 (the control-chain design this feeds) ·
`extension/content/public-records.js` (the scanner — read it, do not rewrite the parsers, they already
work and one has a paid-for bug fix in it) · `api/_handlers/sidebar-pipeline.js::upsertPublicRecords`
(the real, working writer — reuse it, do not build a parallel one) · `extension/sidepanel.js` around
the "Scan This Page" / save-org handlers (~line 4001) · `api/_shared/county-portal-resolver.js`.

## Why this, why now

Scott's own manual research workflow (netronline → county assessor → recorder of deeds → Secretary of
State → cross-reference) is exactly what `extension/content/public-records.js` already scans for on
every one of those site types — assessor, recorder, and SOS parsers all exist, including a CA
bizfile-specific parser with a real bug fix already paid for. **The gap is not the scanner. It's that
the sidepanel's save path for a scanned public-records/SOS capture discards everything except `name`
and a description string** — `mailing_address`, `registered_agent`, `officers`, `grantor`/`grantee`,
`tax_amount`, the whole structured payload, captured and thrown away at save time. CoStar's equivalent
path (`upsertPublicRecords`) already proves the real writer works; this prompt finishes the same wire
for county/recorder/SOS captures.

## 1. Route the scanner's captured payload through real structured writers

For an `assessor`-classified scan: route through the existing `upsertPublicRecords` (the same writer
PR2 already proved live for CoStar's parcel stats) so `mailing_address`, `owner_name`, `assessed_value`,
`tax_amount`, and the rest land in `parcel_records`/`tax_records` with real field-provenance rungs —
**tag the `source` distinctly from both `costar_sidebar` and the GPT-4o model leg** (§2/§2a) so a
downstream consumer can always tell a real county-site capture apart from either. Do not touch the
GPT-4o leg or its rungs in this prompt — out of scope, a separate retirement decision per PR11.

For a `recorder`-classified scan: `deed_records` already has the right columns
(`grantor`/`grantee`/`grantor_address`/`grantee_address`/`recording_date`/`document_number`) — build
the equivalent writer if `upsertPublicRecords` doesn't already cover this table, reusing its
provenance/reversibility pattern rather than inventing a new one.

For an `sos`-classified scan (including the CA bizfile-specific parse): this is new — no existing
writer targets SOS officer/member data. Build one that writes the `llc_member`/`llc_manager`
`entity_relationships` edge type `account-based-contact-intelligence.md` §8 already specifies (add the
edge type if it doesn't exist), from `officers`/`registered_agent`/`principal_address`. Apply
`address-reverse.js`'s existing residential-vs-agent-service classifier to `agent_address` /
`principal_address` before treating either as a residence — do not re-derive that logic, the module
already handles the CSC/CT-Corporation/law-firm/PO-box exclusion correctly.

**Every write here is a human-triggered capture** (the sidepanel's existing "Scan This Page" / "Save"
flow) — this prompt is finishing that save path, not building an autonomous crawler. Nothing here
should poll or fetch government sites on its own; scope is strictly "make the existing manual-capture
button actually persist what the scanner already found."

## 2. Surface `county-portal-resolver.js` in the sidepanel

Given a property (or its county/state), show the assessor/recorder URLs `county_authority_cache`
already carries (926 counties, netronline-sourced) as a "go here next" panel or button — the
automatable equivalent of Scott opening netronline.com by hand. This is currently imported only by
`api/admin.js`; expose a route the sidepanel can call. Read-only, no new data acquisition — this is
surfacing data the lane already has.

## 3. Extend `research_workbench` with a research_type for this gap, don't build a parallel queue

Scott wants a priority/merit-weighted "what to research next" queue, living and re-run over time. Read
`docs/architecture/research-workbench.md` (UX-T1b) before building anything — it already ranks and
surfaces this SHAPE of work. Add a `research_type` (e.g. `county_records_needed` or fold into
`establish_ownership_history`'s existing split if it fits better — decide and say which, with the
measurement that justifies it) rather than a new standalone surface. Value-gate by owner rent per the
existing P161/P180 doctrine.

## 4. Size the Salesforce write-back — investigate, do not build blind

Scott's workflow ends with a new contact getting an "NM Type" opportunity and group/list membership in
Salesforce, then entering the 7-touch cadence. `sf-list-import.js` reads list membership FROM
Salesforce; **measure whether anything in this repo already WRITES a new opportunity or list membership
TO Salesforce** before assuming this is a small addition — `ownership-truth-pipeline-state.md` names
Stage 5 (LCC pushed back out) as "the thinnest stage... aspirational more than built," so treat that as
the prior, not a fresh guess. If nothing exists, size it and file it as its own backlog row rather than
building it inside this prompt — this alone could be a full unit of work depending on what SF's API
actually allows for opportunity/campaign-membership creation from this app's connected-app permissions
(read `SALESFORCE_LCC_INGESTION_PLAN.md` / the C1 audit on Connected App rights before assuming write
access exists at all).

## Guard + ship

Each writer (assessor, recorder, SOS) gets its own guard, mutation-verified — a synthetic scan payload
for each site type should land in the right table with the right fields, and the residential-vs-
agent-service exclusion should be positively tested (a CSC address must never become an `llc_member`'s
residence). Reversible, logged, same discipline as every writer this session has shipped.

## Ship + record

Branch `build/pr-scanner-writeback`. STATUS.md entry naming which of Units 1-4 shipped and which (if
any) were sized-not-built (§4 in particular may land as a measurement + backlog row rather than code).
`docs/architecture/public-records-source-lane.md` §7 and `account-based-contact-intelligence.md` §8 —
update with what actually shipped. `PLANNED-BACKLOG.md` — new rows under §P3/PR for whatever is built
or sized.
