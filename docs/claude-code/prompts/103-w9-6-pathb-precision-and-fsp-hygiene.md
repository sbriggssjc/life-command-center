# Prompt 103 — W9.6 Path-B precision pass (gate the flip) + `folder_feed_lease` fsp hygiene

Grounding (read first): `docs/audits/W9_6_comms_owner_attribution_dryrun_2026-08-13.md` (the **Cowork
review finding** box at top — this prompt implements exactly that), `api/_shared/comms-owner-attribution.js`,
the migration `supabase/migrations/20260829120000_lcc_w9_6_comms_owner_attribution.sql` (the Path-A/Path-B
RPCs `lcc_w9_6_path_a_candidates` / `lcc_w9_6_path_b_candidates`), the Producer/Consumer + honest-counts
doctrine (CLAUDE.md), the `field_source_priority` / `v_field_provenance_unranked` drift rules.

This is a **precision hardening + a tiny provenance-registration**, not a new unit. Deterministic-first,
additive, reversible. Two independent parts; ship both in one PR.

---

## Part A — W9.6 Path-B precision (THE FLIP GATE)

**Why:** the live dry-run (Cowork, 2026-08-13) showed Path A (`property_bridge`, 3) is clean and
flip-ready, but **Path B (`person_match`, 40 = 24 relationship + 16 active_contact) carries ~9 noise
rows (~23%)**, and the two loudest by correspondence-row volume are the worst:
- **Internal team as owner-contact:** Scott Briggs (**828** rows) and Toby Scrivner (**128**) proposed
  against **"Stan Johnson Co"** via a loose `relationship` tie. Never attribute NorthMarq / Stan-Johnson
  deal-team correspondents to an owner.
- **Brokerage-as-owner target:** Avison Young, Newmark, Kidder Mathews, Transwestern, Coldwell Banker
  are mis-modeled as `true_owner`, so a broker at that firm is attributed to it (Kidder even shows a
  name/email mismatch `Matthew Dodson` ↔ `David.gellner@kidder.com`).

A human-gated lane whose loudest cards are a broker's own 828 emails mis-filed to his old firm trains the
operator to ignore the lane — the exact anti-pattern the doctrine forbids. Nothing auto-writes today, but
the lane is below the flip bar.

**Do (deterministic guards in the planner + the Path-B RPC; no LLM):**

1. **Exclude internal-team correspondents.** A single own-firm domain allowlist (`northmarq.com`,
   `stanjohnsonco.com`, plus any teammate list already in the repo — grep for an existing internal/own-domain
   constant before adding a new one; reuse it). A correspondent whose email is on that list is NEVER an
   owner-attribution subject → dropped, counted `internal_team_skipped`.
2. **Guard brokerage/advisor entities out of the TARGET set.** An owner-attribution target must be a genuine
   owner LLC, not a brokerage/advisor. Prefer an existing signal if one exists (entity_type / role / a
   brokerage flag / the SF-account-as-org-edge modeling) — grep first; do NOT invent a new hardcoded name
   list if the graph already carries the distinction. If no structured signal exists, add a conservative
   deterministic brokerage-name guard (a small, documented stoplist of the majors + a `brokerage`/`realty
   advisors`/`commercial®` token check) and **log it as a KNOWN upstream data-modeling issue** (these
   entities should not be `true_owner` at all — flag for a future ORE cleanup unit; do not fix ownership
   modeling here). Dropped rows counted `brokerage_target_skipped`.
3. **Tighten the tie.** Keep `tie_kind='active_contact'` (via `owner_contact_pivot` — the trustworthy tie).
   For `tie_kind='relationship'`, restrict to ownership-role relationships only (`metadata->>'role'` in the
   owner/ownership set — reuse the existing role vocabulary; grep `entity_relationships` role usage) OR drop
   `relationship` entirely if the role signal is too thin to trust — **report the count each choice keeps**
   so Scott can see the tradeoff in the dry-run, and pick the tighter one that still yields real owners
   (e.g. Boyd Watterson `jcapra@boydwatterson.com`, Kingsbarn `jpori@kingsbarn.com` must survive).

**Keep** the house discipline: unambiguous-only, verbatim correspondent evidence, value-ranked, per-reason
drop counts in the tick output, loud `scan_errors`, proposal-only (human verdict unchanged), reversible.
The Path-A path is unchanged.

**Acceptance (Part A):**
- Re-run `?score=1&n=20` (or the RPCs directly): Path B no longer contains any internal-team correspondent
  or brokerage-target row; the drop counters (`internal_team_skipped` / `brokerage_target_skipped` /
  `loose_tie_skipped`) are surfaced and non-zero; real owner contacts (Boyd Watterson, Kingsbarn, Easterly,
  Realty Income, etc.) survive. Honest count of what remains.
- Update the dry-run doc: replace the review-finding box with the post-fix Path-B counts; note Path A was
  always clean.
- Tests extended in `test/comms-owner-attribution.test.mjs`: internal-team drop, brokerage-target drop,
  tie-tightening, and that a genuine owner-LLC active_contact still passes.
- **Then it's flip-ready:** Cowork re-reviews the tightened `?score=1` after the Railway redeploy and flips
  `W9_6_COMMS_OWNER_ATTRIBUTION`.

---

## Part B — register `folder_feed_lease` provenance (quick hygiene)

**Why (grounded live 2026-08-13):** last night the lease folder-feed wrote 5 `dia.leases` responsibility
fields — `guaranty_scope`, `hvac_responsibility`, `parking_responsibility`, `structure_responsibility`,
`roof_responsibility` — with source `folder_feed_lease`, but there are **no `field_source_priority` rows**
for that (source, table, field), so `v_field_provenance_unranked` flags them (drift 34→39). Per the
standing rule ("whenever you add a new writer/source to a curated field, register a `field_source_priority`
row"), register them.

**Do:** a small additive migration inserting `field_source_priority` rows for `folder_feed_lease` on those
5 `dia.leases` fields (and any other `folder_feed_lease`-touched lease field the drift view shows — query
`v_field_provenance_unranked` for the full current set first, don't assume just these 5). Pick a priority
that reflects its trust vs the neighbors already ranked on those fields: it is a **lease-document extraction
from the filed lease PDF**, so rank it alongside `om_extraction`/lease-doc sources (more authoritative than
a CoStar sidebar aggregate, less than a `manual`/`recorded` source) — mirror whatever the existing
responsibility-field ladder uses; if unsure, `record_only` mode so it observes without enforcing. Reversible.

**Acceptance (Part B):** `v_field_provenance_unranked` no longer lists `folder_feed_lease` rows (drift
returns toward the ~34 baseline); the fsp rows are visible; `record_only` (or the matched enforce_mode).

---

Commit with the repo Co-Authored-By + Claude-Session trailer. One PR. Report the tightened Path-B counts
and the post-fix drift number.
