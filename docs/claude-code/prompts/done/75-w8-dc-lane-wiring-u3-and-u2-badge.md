# Prompt 75 — W8 DC frontend wiring: U3 lane missing + owner_reconcile badge undercount

**Grounding (live, 2026-08-07):** Scott can't find the U2/U3 cards in the Decision Center.
Cowork verified against origin/main `ops.js` + `api/admin.js`:

1. **U3 lane can't render.** `w8_u3_link_review` is in `_DC_FEDERATED` (ops.js ~1871) but has NO
   entry in the DC lane list (~1945–1972 — `junk_entity_review` is there at 1957, U3 is not), no
   meta entry (~2586 block), and no card-render branch (~3029 area handles junk only). PR #1609's
   frontend touch was incomplete vs U1's three touches. 2 open proposals exist in
   `v_w8_u3_link_review_open` right now — including the FIRST chain `link_proposal` — invisible.
2. **U2 cards land in `owner_reconcile` but the lane badge undercounts.** Backend fold is correct
   (admin.js 4496 reads `v_w8_u2_dup_pair_open`; count add-on at 4522), but the DC page's
   `subN`/`dc[s.dt]` badge source (open lcc_decisions by type) doesn't include the folded U2 rows —
   38 proposed pairs currently show as a 0-badge lane. Also NOT in `/api/review-counts` (that
   endpoint has a separate fixed lane list — decide whether W8 lanes belong there too, or document
   why not).

## Do

1. **ops.js — complete U3's wiring, mirroring `junk_entity_review`'s three touches:** lane-list
   entry (`{ dt: 'w8_u3_link_review', label: 'Ownership links — Ollama proposals', open:
   renderFederatedLane(...) }`), meta title/intro block, and the card-render branch: show gap +
   property (chain) or person/email (different_people), proposed link + role, confidence, the
   VERBATIM evidence quote + source, buttons Confirm / Reject (+ whatever the verdict branch
   supports). Match the junk lane's markup patterns.
2. **Badge correctness (honest counts doctrine):** make the `owner_reconcile` badge include the
   folded U2 open-pair count, and the `w8_u3_link_review` badge read `v_w8_u3_link_review_open` —
   wherever `dc[s.dt]` is populated (the DC counts fetch), add the two add-on counts server-side so
   every badge is real work. A 0-badge lane holding 38 cards violates the honest-counts rule.
3. **Optional but preferred:** add both W8 lanes to `/api/review-counts` so the overview widget
   agrees with the DC page.
4. **Tests:** structural guards — every `_DC_FEDERATED` member MUST have a lane-list entry + meta +
   render branch (this exact gap class, pinned so a future lane can't ship half-wired); badge
   add-on count test.

## Acceptance

- Hard-refreshed DC shows the U3 lane with badge 2 (current open) and renders both cards with
  verbatim quotes; Confirm/Reject work end-to-end (decision lands 'decided'/'skipped' per 74).
- owner_reconcile badge reflects the 38 folded pairs; opening it shows the pair cards.

Commit with the repo Co-Authored-By + Claude-Session trailer.
