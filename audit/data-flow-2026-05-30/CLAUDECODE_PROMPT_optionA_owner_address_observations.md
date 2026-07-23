# Claude Code (LCC) — Option A: capture & store ALL owner addresses (append-only), surface them, + record the unverified CoStar recorded↔true link

Build 2 (the reconcile engine + address dimension) is live but starved: owner-address coverage
in LCC is ~0 (gov `recorded_owners.mailing_address` 18/16,901; LCC `entities.address`
43/38,004), and the address dimension can only see `entities.address`. Two root causes, both
addressed here:

1. **The capture COLLAPSES.** The CoStar payload carries several owner-address surfaces, but the
   pipeline reduces them to ONE. `selectAuthoritativeOwner(metadata)` picks a single owner and
   `ensureRecordedOwner(name, address, contact)` writes ONE address (dia `recorded_owners.address`
   / gov `contact_info` jsonb). Every other observed address is discarded.
2. **The domain address string is invisible to LCC.** The owner-facts mirror is names-only
   (`has_reg_address` boolean, the Slice-1 PII posture), so the 302+ owners whose registered
   address exists in the domain can never be reconciled.

Scott's doctrine (2026-07-22): *"Grab and store ALL different addresses and reconcile or make
connections later. The CoStar recorded↔true-owner association is another datapoint to collect
and verify — never ingest as truth; CoStar mis-identifies constantly."*

---

## Unit 0 — inventory the exact payload FIRST (determines server-only vs extension work)

Before building, enumerate every address-bearing surface the sidebar payload (`metadata`)
actually carries today, from the extension code + `sidebar-pipeline.js`. Confirmed present:
`metadata.contacts` (Contacts tab), `metadata.sales_history[].{buyer,seller} contacts`,
the owner panel (`selectAuthoritativeOwner`), `parcel_number`. **Verify and complete this list** —
in particular whether the **Public Records tab** owner address and the **Sales-comp contact
page** address arrive distinctly, or are missing from the payload. Report the inventory.

- Surfaces already in the payload → captured server-side (this round).
- Surfaces the extension does NOT yet send (e.g. Public Records owner address if absent) → note
  them as a **deferred extension-capture task**; do not block this round on browser work. Scott
  flagged the extension as the harder, later surface (it's Build 3 territory).

## Unit 1 — an append-only owner-address OBSERVATIONS store (the raw material)

New LCC table `lcc_owner_address_observations` (or extend an existing observation store if a
clean one exists — check first, don't fork): one row per **(owner identity, address, source
surface, captured_at)**, append-only, source- and provenance-tagged. Never overwrite; never
collapse. Columns at least: owner key (domain recorded_owner id and/or LCC entity id, whichever
is resolvable at capture), raw address, normalized address (via the EXISTING `lcc_normalize_address`),
`source_surface` (`costar_contacts` / `costar_public_records` / `costar_owner_panel` /
`sales_comp_contact` / `deed_grantee` / `deed_grantor` / `sos_registry` / `salesforce` /
`assessor_parcel`), `address_kind` (`notice` / `mailing` / `registered_agent` / `principal` /
`situs`), confidence, captured_at, source_url/context. Dedupe key = (owner, normalized address,
source_surface) so the same address from the same surface isn't duplicated, but the SAME owner's
DIFFERENT addresses across surfaces all coexist. Drop the table → zero trace.

This is the store Scott wants: every distinct address for an owner, from every surface, kept.

## Unit 2 — stop collapsing: write EVERY observed address to the store

In `sidebar-pipeline.js`, alongside the existing single-owner `ensureRecordedOwner` write (leave
it — it's the curated single value), ALSO emit an observation row for **each** address-bearing
surface in the payload: the owner panel, each Contacts-tab contact that resolves to the recorded
owner, each sales_history buyer/seller that resolves to the owner, and (already flowing) the deed
grantee/grantor addresses from ORE Phase 1C. Best-effort, never blocks the capture. The existing
guards apply (junk/broker/federal name filters — don't attach an address to a garbage owner).

## Unit 3 — surface the DOMAIN address string into LCC (the mirror extension — the 302 unlock)

Extend the owner-facts / owner-contact-signals mirror to carry the **address STRING** (not just
`has_reg_address`) from the domain `recorded_owners.address` / `mailing_address` /
`registered_agent_address` into LCC, and feed those into the observations store (source_surface
`recorded_owner_domain`). This is the gov/dia-blessed change Build 2 flagged. **PII posture note:**
this deliberately surfaces an owner notice-address string into LCC (one workspace, service-role
only) — that is Scott's approved decision (2026-07-22). Add the address columns to the anon
mirror view the LCC pull reads (extend the view, do NOT loosen RLS on the underlying PII table —
the same pattern the existing `v_*_portfolio` mirror views use). As Build 1's deed drain fills
`recorded_owners.mailing_address`, these flow automatically.

## Unit 4 — record the CoStar recorded↔true-owner link as an UNVERIFIED datapoint

CoStar asserts a recorded-owner → true-owner association; the pipeline currently forms it with
implicit trust (`Create new true_owner from recorded_owner data`). Capture it instead as an
**observation to verify, never as truth**:

- Record the asserted association (recorded owner, asserted true owner, `source='costar'`,
  `verified=false`, captured_at) in an append-only signal store — a new
  `lcc_owner_link_observations` or the existing evidence/signal machinery (check first).
- **Do NOT write `properties.true_owner_id` from the CoStar assertion.** It feeds the reconcile
  engine as a LOW-authority signal (below the deed/SOS/domain sources — CoStar aggregator
  quality, mirror the `costar_sidebar` priority already in `field_source_priority`) and surfaces
  in the review lane for confirmation. A CoStar link that AGREES with a deed/domain-derived link
  is corroboration; one that DISAGREES is a review flag, never a silent overwrite.
- Where the existing pipeline already auto-creates a true_owner from CoStar data, gate that
  behind the same "unverified until corroborated" posture — surface it, don't trust it.

## Feed Build 2

All four units feed the `v_lcc_owner_address_dimension` + `lcc_owner_address_reconcile_sweep`
already built. Confirm the dimension reads the new observations store (extend the view) so a
newly-observed shared address across surfaces reconciles owners continuously. The reconcile
threshold is unchanged — a bare shared address is reviewed, never silently merged.

## Boundaries

Append-only / never-overwrite / never-collapse for observations · the existing single curated
`recorded_owners` write is untouched · reuse `lcc_normalize_address`, `lcc_reconcile_owner`, the
signal-authority weights, `field_source_priority` — do not fork · CoStar recorded↔true link is
NEVER written to `true_owner_id` (unverified datapoint only) · Unit 3 extends the anon mirror
view, never loosens RLS on PII tables · dia/gov: Unit 3 adds address columns to the anon mirror
view only (no writes to domain PII rows) · reversible · no new `api/*.js` if avoidable.

## Verify

1. `npm run check:boot`, full suite.
2. Unit 0 inventory reported (which surfaces are in the payload; which need deferred extension work).
3. Unit 2: a synthetic CoStar capture with DIFFERENT addresses on the owner panel vs a Contacts-tab
   entry vs a sales-comp contact → confirm ALL THREE land as distinct observation rows (not
   collapsed), and the curated single `recorded_owners` write is unchanged.
4. Unit 3: confirm the mirror carries a real `recorded_owners.mailing_address` string into LCC for
   a spot-check owner, and it appears in the address dimension. Report the coverage climb.
5. Unit 4: a synthetic CoStar recorded↔true assertion → recorded as `verified=false`, `true_owner_id`
   NOT written, surfaced in the review lane. A synthetic AGREEING deed link → corroboration; a
   DISAGREEING one → review flag.
6. Reconcile sweep picks up a new cross-surface shared address; queue-refresh stays low seconds.

## Context

Option A of the capture+reconcile plan (`OWNER_CONTACT_CAPTURE_RECONCILE_DESIGN.md`). Build 1
(deed byte-capture) is live + draining. Build 2 (reconcile engine + dimension) is live. This
unlocks Build 2's real value: the 302 domain-address owners + every multi-surface CoStar address.
Option B (the SOS human-in-the-loop sidebar) follows and feeds the SAME observations store. The
SOS automated path is dead from CI — do not revisit.
