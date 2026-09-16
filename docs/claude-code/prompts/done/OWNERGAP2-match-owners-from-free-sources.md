# OWNERGAP2 — resolve owner-unknown properties from free public sources, one jurisdiction adapter at a time

**Repo: life-command-center** (writes Dialysis_DB `zqzrriwuavgrquhisnoa`). **This is the first BUILD in the owner
arc** — everything before it was measurement. Scope it small: **two adapters, a provenance contract, and a
measured result.** Not a national pipeline.

**Read first:** `docs/audits/OWNERGAP1_FABRICATED_OWNER_AND_UNRECOVERABLE_GAP_2026-09-14.md` **§§6–9** (the
sampling and both match tests — this prompt is their consequence) · `docs/os/PLANNED-BACKLOG.md` `OWNERGAP1*`,
`OWNERGAP2`, `PDR2*`, `PR-scanner-5` · `api/admin.js::handleRecorderPortal` (~18748) ·
`api/_shared/public-records-writeback.js` · `api/_handlers/owner-reconcile.js` · `CLAUDE.md` **never fabricate**,
**B4/B5**, **P131**, **P180**, **Class 11**.

---

## 0. What is already true — do not re-litigate, do verify

- **4,021 dia properties (34% of the book) have no owner.** PDR2 stopped the operator standing in for one; the gap
  was revealed, not created.
- **The owner is NOT in any table we hold.** Measured: 24,365 of 25,331 tax payloads carry a null/empty
  `mailing_owner`; `deed_records` has zero overlap; 0 parcel joins with an owner. **Do not build a parser for data
  that is not there.**
- **Free public sources DO have it.** Philadelphia **~68%** (open SQL API), Harris **86%** (public search).
- ✅ **The destination table already exists and is already working:** `recorded_owners` holds **7,487** rows with
  `name, normalized_name, normalized_address, source, entity_type, registered_agent_*, filing_*`, and
  **5,467 of 11,815 properties already carry a `recorded_owner_id`**. **Build no new table.** Add adapters and
  fill the gap.
- ✅ A fabrication guard already fires on `recorded_owners.name`
  (`trg_dia_ownergap1_recorded_owner_name_guard`). **Verify it still fires before and after your change.**

## 1. 🚨 The provenance contract — this is the whole prompt

OWNERGAP1 exists because a model was asked to recall a public record and invented `XYZ Dialysis Centers LLC`
across 119 counties. **Therefore, non-negotiably:**

- **Every owner written MUST cite the source row it came from** — jurisdiction, the source's own record
  identifier (OPA account number, HCAD account number), and the query that found it. Put it in
  `recorded_owners.source` (and `notes` if it needs more). **A row that cannot cite its source does not get
  written.**
- **No model may produce an owner name.** A name is copied from a fetched record or it does not exist. A local
  model may ONLY normalise and match strings already fetched (`OWNERGAP1-ollama`) — and even then the written
  value is the **source's** string, not the model's rendering of it.
- **A miss stays a miss.** Unresolved properties keep `recorded_owner_id IS NULL` and are reported. **"Owner
  unknown" is the correct answer when the owner is unknown** (P180). Never fall back to the operator — that is
  PDR2, undone.

## 2. Two adapters, and only two

**(a) Philadelphia — `phl.carto.com/api/v2/sql`, table `opa_properties_public`.** Free, public, documented, no
key. Returns `location`, `owner_1`, `owner_2`. **25 properties.**

**(b) Harris — HCAD.** Verified working by address without an APN. 🔑 **Harris types every account `Personal` vs
`Commercial`: the tenant's equipment is the Personal account, the real property owner is the Commercial one. Key
on that account type** — do not re-derive operator-vs-owner from name text, which is the mistake PDR2 fixed.
**50 properties.** ⚠️ Establish first whether HCAD offers a bulk/API path; if it is UI-only, say so and scope (b)
to whatever is reachable without automating a bot-protected page. **Cook-style CAPTCHA pages are out of scope —
do not attempt to bypass one.**

## 3. The three miss causes — handle the two that are cheap, file the third

Measured, with live examples:

1. **Address ranges** (Philadelphia): `4126 Walnut St` ↔ `4126-38 WALNUT ST`, `1300 W. Lehigh Ave` ↔
   `1300-24 W LEHIGH AVE`. **Handle it** — house-number-prefix + street match, then confirm the street matches.
2. **Street aliases** (Harris): `4427 Cypress Creek Pkwy` is Houston's renamed **FM 1960**, so the portal returns
   the wrong street entirely. **Handle it with a small, explicit, data-driven alias list** — never by loosening
   the match until something returns.
3. **Multi-parcel sites**: `3300 Henry Ave` returns **six** owning LPs (Falls Center). **Do NOT guess which.**
   Leave unresolved, flag `needs_parcel_discriminator`, and report the count. This is a real gap (P131), not a
   matching failure.

## 4. 🚨 Ambiguity rules — where a wrong owner gets minted

- **More than one Commercial/owner candidate → write nothing**, flag, report. (§3.3.)
- **A fuzzy match that is not exact on house number AND street → write nothing.** Report near-misses so the alias
  list can grow from evidence.
- **The matched owner name is an operator** (`is_operator_not_owner`, or it matches the property's own tenant) →
  **write nothing and flag loudly.** That is either a genuine operator-owned property or a bad match, and both
  need a human.

## 5. The gate — measured, and both-sided

1. Per adapter: properties attempted, **resolved**, **unresolved-by-cause** (range / alias / multi-parcel /
   no-record / ambiguous). Beside my measurements (Philadelphia ~68%, Harris 86%) — **disagreement is a finding,
   report it.**
2. **Spot-check 5 written owners by hand against the live source** and paste both sides. A match rate is not
   proof the right name landed on the right property.
3. **Every written row cites its source** — paste three `recorded_owners.source` values verbatim.
4. **Positive control both ways:** the fabrication guard still nulls a seeded `XYZ`-shaped name, **and** a real
   owner writes through untouched.
5. `properties.recorded_owner_id` count before/after, and **confirmation that no `true_owner_id` was touched.**
6. Re-run `get_property_context` on one newly-resolved property and paste the `ownership` block — it must now
   name the owner, with the operator still correctly flagged (PDR2's invariant).

## 6. What NOT to do

- Don't build a national pipeline, a scheduler, or a `county_authorities` table. **Two adapters.**
- Don't touch `true_owner_id`, `true_owners`, or PDR2's guard.
- Don't automate a CAPTCHA-gated or bot-protected portal, and don't work around one.
- Don't write an owner for a multi-parcel site, an ambiguous match, or anything you cannot cite.
- Don't let any model generate, "clean up", or "improve" a name. Copy the source string.

## Guard + ship

Tests: the range matcher (including a case it must REFUSE), the alias list, the ambiguity refusals from §4 as real
assertions, and the provenance requirement (a write without a source must fail). Full suite green.

⚠️ **Doc guards, four of them.** `status-line-budget` (budget **3,000**, archive to `docs/history/` **before** you
push, 200+ lines of headroom — this file grows on `main` while your branch is open). `status-header-integrity`
(H1 on line 1). ⚠️ **New entries go BELOW the `---` that follows the Open-threads table, not directly under the
convention comment** — that is a separate assertion in `status-line-budget` and it has already caught one session.
`backlog-id-uniqueness` + `backlog-table-shape` — re-run **after** merging `main`. Branch → PR → CI → merge →
redeploy **both** Railway services, then confirm `/version` matches `main`.

## Ship + record

Update `PLANNED-BACKLOG.md` (`OWNERGAP2`, and `OWNERGAP1-decision` with the real resolved count),
`docs/audits/OWNERGAP1_...md` (a §10 with the build's measured result), `CURRENT-STATE.md`, `STATUS.md`. Report
all six gate items, and state plainly **how many of the 4,021 now have an owner** — that number is the point of
the whole arc.

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
