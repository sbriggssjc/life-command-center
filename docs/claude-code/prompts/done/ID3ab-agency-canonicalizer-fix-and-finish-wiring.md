# ID3a-b — Fix the agency canonicalizer's contamination bug, then finish the wiring (with Scott's three readings settled)

**Repo: `life-command-center`.** Government DB. **Order matters: the regex fix lands before any registry row that
would let the contamination promote.** Everything else follows the ID2a/ID3a pattern already in place.

**Read first:** `docs/claude-code/STATUS.md` 2026-09-12 entries "ID3a measured before wiring" and "ID2a-cleanup +
ID3a reconciled" · `docs/os/PLANNED-BACKLOG.md` §P0d **ID3a**, **ID3a-b**, ID3i, ID4 ·
`supabase/migrations/.../gov_round_76bg_agency_canonicalizer.sql` (the `canonicalize_agency()` source, ~line 53) ·
the ID3a migrations (aliases, review, guards) · `docs/audits/ID4_IDENTITY_INTEGRITY_BASELINE_2026-09.md` (per-class
comparators, never one shared normalizer) · `CLAUDE.md` Core doctrines.

## Why this, why now (live, Cowork 2026-09-12)

ID3a wired the FK — `properties.agency_id` 0 → 7,369 of 20,509; `property_agencies` 0.12% → 90.3% — and shipped the
alias table, review lane and guards. **The contamination bug it found is still live:**
`canonicalize_agency('Navy Federal Credit Union')` returns `NAVY` today, and 145 credit-union rows carry it. They're
unlinked only because the registry has no `NAVY` row. Adding one — the obvious next step for a "registry gap" — would
promote a private bank to a federal agency on every one of those properties.

## 1. Fix the regex, then re-canonicalize (before anything else)

- `^navy` gains a word boundary (and sweep the whole function for the same shape: any bare prefix alternative that can
  swallow a longer private name — check `^va`, `^doc`, `^state`, `^army`, `^usa`).
- Re-canonicalize the 150 `NAVY` rows. The 145 Navy Federal Credit Union rows are **not a government tenant at all**:
  give them a null canonical and route them to review with a reason, or the non-government classification the gov lane
  already uses — say which, and don't invent a third.
- Add a test per fixed pattern using the real offending strings as fixtures.
- **Positive control:** `Department of the Navy` and `Navy Exchange` must still canonicalize to the Navy code;
  `Navy Federal Credit Union` must not.

## 2. Scott's readings — settled 2026-09-12, build to them

| String | Decision |
|---|---|
| `RICHMOND FIELD OFFICE (VA)` (73 rows) | **Virginia, not Veterans Affairs.** A trailing `(XX)` state suffix must never be read as an agency — make that a rule in the comparator, not a one-off fix, and check every other `(XX)`-suffixed string for the same misreading. |
| `DOC` (16 rows, incl. `DOC/P&PO`, `DOC&PS`) | **State Department of Corrections, not US Commerce.** Auto-link none; route all 16 to review. |
| `GSA - <AGENCY>` (~330 rows: SSA 150, USPS 92, FBI 48, VA 21, IRS 20) | **Single-tenant.** Scott: *"the tenant is the GSA but the user is whatever is second."* Keep one lease. Store the **using/occupying agency** alongside the lease-counterparty agency (GSA) — a second FK column, not a second lease, not a multi-tenant model. State which column each existing agency report groups on, and what changes for each. |

## 3. Registry gaps — only after §1

Add rows for the genuine federal agencies missing from the 65-row registry: NAVY, ARMY, DOC (as **US Commerce**, kept
distinct from the state-corrections reading above), LSC, DOL, USGS, NRC, NIH, NLRB, USAF, TREAS. Add the `ACE` alias to
the existing `USACE` row (that's 614 Tully Rd, ID3i's cross-lane twin). Each new row and alias carries provenance.

## 4. Finish the wiring

- The 1,732 rows canonicalized-but-unlinked, and the 8,838 with agency text but no canonical at all. Report the
  auto/review split before applying, as ID3a did.
- Re-run the parity view: agency counts before and after. **SSA is the one to watch** — its four spellings, plus the
  `GSA - Social Security Admin` rows once §2 gives them a using-agency, should converge on one number. Report it.
- Report final FK coverage on both columns and the review queue's composition (how much is genuinely unregistered vs
  waiting on a human).

## 5. What NOT to do

No county/city vocabulary (ID3e is next). No owner or broker identity. No cross-lane property linking beyond adding the
`ACE` alias. Don't auto-resolve anything the comparator can't settle — that's what the review lane is for.

## Guard + ship

Tests: the fixed regex with its real fixtures plus positive controls, `(XX)`-suffix handling, DOC routing to review,
the using-agency column, guard rejection, the backfill split. Full suite green. Branch → PR → CI → merge → redeploy BOTH
Railway services if anything under `api/` changed.

## Ship + record

Update `PLANNED-BACKLOG.md` §P0d (ID3a, ID3a-b, ID3i's `ACE` note), `docs/architecture/data-coherence-invariants.md`
(I13 detector status for the agency class — ID4's decision was to prove it here first), `STATUS.md`, `CURRENT-STATE.md`.
Report: the strings the regex fix moved, the parity table (SSA especially), coverage before/after, and the review queue.
