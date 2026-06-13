# Claude Code — R15 Phase 2: CRE owner backfill (the cross-asset-class overlap payoff)

## Why (grounded live 2026-06-12)
R15 Phase 1 shipped and is verified live: out-of-domain docs now register into
`lcc_cre_properties` instead of parking (first row: Vervent / Portland, OR + doc).
But properties registered via the **light-attach path** carry `owner_entity_id =
NULL` — by design, that path resolves by path anchor and does no extraction. The
OWNER is the whole point of the registry (it's what makes a CRE owner a first-class
BD entity and reveals cross-asset-class overlap), so Phase 2 backfills it.

**Where the owner actually lives (grounded):** the CRE/out-of-domain universe is
dominated by **master sheets, which are xlsx** (master: 185 xlsx / 10 pdf; comp:
131 xlsx), not OM PDFs. So owner backfill CANNOT just reuse the OM PDF/AI extractor
— it needs to read the Briggs master-sheet xlsx. BOVs (49 pdf / 41 docx) and the
occasional OM are the PDF fallback. There is currently no xlsx *reader* in the
intake path (`exceljs` is a dependency but used only on the export side —
`cm-excel-export.js`); the OM extractor handles PDF/text only.

## Build — Unit 1: a CRE owner extractor (xlsx-first, PDF fallback)
New helper (e.g. `api/_shared/cre-owner-extract.js`, no new `api/*.js`) that, given
a CRE property's best owner-bearing doc, returns a candidate owner name:
- **Master sheet / comp (xlsx)** → read with `exceljs` (already a dep). The Briggs
  master sheet is a labeled key/value layout, not a fixed cell map, and the label
  varies (`Owner`, `True Owner`, `Recorded Owner`, `Seller`, `Landlord`,
  `Ownership`). Do a **label scan**: walk the cells, find a cell whose trimmed text
  matches one of those labels (case-insensitive, exact-ish), and take the adjacent
  value (right cell, else the cell below). Prefer `True Owner` > `Recorded Owner` >
  `Owner` > `Landlord` > `Seller` when multiple are present. Robust to format drift
  — never hardcode `B7`.
- **BOV / OM (pdf/docx)** → fall back to the existing AI extractor
  (`intake-extractor` / `runEnrichOnlyPromotion`'s snapshot owner) for the owner
  field only.
- Fetch bytes via the existing SharePoint Get flow (`SHAREPOINT_FETCH_URL`) using
  the doc's `source_url` — same read-back the OM extractor uses. No re-upload.
- Pick the doc to read per property: prefer master sheet (richest, structured) >
  BOV > OM > others. One doc per property is enough for the owner.

## Unit 2 — mint + link the owner, reusing the guarded path
Feed the extracted name through the SAME owner-minting the in-domain path uses:
`ensureEntityLink` with `domain='cre'`, behind the shared junk / implausible-person
/ federal anti-pattern guards (so garbage cells never become an entity). On a clean
name → create/resolve the entity, set `lcc_cre_properties.owner_entity_id`, write
`field_provenance` (`source='folder_feed_cre'`, the field already registered). On no
clean owner → leave NULL (re-attempt later); NEVER invent an owner. This mirrors
the Phase-1 doctrine exactly.

## Unit 3 — the backfill worker + gentle cron
- Worker: `?route` sub-route (no new `api/*.js`) — GET dry-run / POST drain. Pulls
  N `lcc_cre_properties WHERE owner_entity_id IS NULL` that have at least one
  attached doc, runs Unit 1+2, bounded by a per-tick count + time budget (the
  artifact-offload lesson). Idempotent: a property that resolves an owner drops out
  of the queue; one that can't stays NULL for a later human/Phase-3 pass.
- Cron: gentle cadence (e.g. `*/15`), idempotent unschedule-then-schedule, applied
  AFTER the Railway deploy (endpoint-before-cron, the standing rule). No-op safe
  when there's nothing to backfill.
- Going forward, NEW light-attach registrations get their owner on the next cron
  tick — so the registry self-heals; Phase 1's light path stays owner-light and
  Phase 2 fills in behind it.

## Unit 4 — the overlap payoff (read-only view, the verification)
The reason we built this. A view `v_lcc_cre_cross_asset_owners` that surfaces owners
who appear BOTH as `lcc_cre_properties.owner_entity_id` AND as a dia/gov owner
(via the existing entity graph / portfolio facts) — i.e. a Vervent/Top Golf owner
who also holds dialysis or government assets. Columns: entity, CRE property count,
dia/gov portfolio count + rent, total relationship footprint. This is the unified
cross-asset-class portfolio picture that justified the registry — and the live
answer to the owner-overlap question I couldn't pre-compute (the owners didn't
exist until now).

## Don't break / boundaries
- dia + gov pipelines UNCHANGED. This only reads CRE docs + writes CRE owners.
- Still NO scoring/underwriting — Phase 2 adds the OWNER, nothing else.
- The xlsx reader is read-only on bytes fetched via the existing Get flow; it never
  writes back to SharePoint.
- Reuse `ensureEntityLink` + the shared guards — do not fork owner-minting.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Unit tests: the label-scan owner
reader on a synthetic master-sheet workbook (`True Owner` adjacent-cell, label-
below fallback, priority order, junk cell → no owner); the backfill worker
(NULL-owner property + master doc → owner minted + linked; no clean owner → stays
NULL, never invented; dia/gov untouched). The overlap view returns the expected
shape on seeded data.

## After deploy (Cowork verifies live)
- Run the backfill drain; `lcc_cre_properties.owner_entity_id` populates from the
  master sheets; owners appear as `domain='cre'` entities.
- `v_lcc_cre_cross_asset_owners` returns the first real cross-asset-class owners —
  the overlap number, finally evidenced.
- Spot-check one: a CRE owner that also owns dia/gov shows a unified footprint.

## Phase 3 (deferred, not this prompt)
A CRE portfolio sync so those cross-asset-class owners surface a UNIFIED portfolio
in the priority queue / cadence (right now a bare CRE owner appears only in
relationship bands); the CRE context-packet variant for MCP/agents.
