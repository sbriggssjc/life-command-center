# ACI-phase1-2 — finish Tier 0, build the REIT/fund role taxonomy, and add the individual-owner control chain — side by side

**Read first, in order:** `docs/architecture/account-based-contact-intelligence.md` in full (§§1-8,
including the new §7 phased plan and §8 control-chain design — both added 2026-09-10) ·
`docs/architecture/tier0-owner-contact-system.md` (Tier 0's live objects, traps, decisions already
made — do not re-litigate anything in its §4) · `api/_shared/address-reverse.js` (the existing
residential-vs-agent-service classifier — read it, do not rewrite it) · `api/_shared/llc-research.js` ·
`docs/os/PLANNED-BACKLOG.md` §P3 rows `AC1d`, `AC1e`, `AC2`, `AC3`, `AC4`, `AC6`, `AC8`, `AC9`.

## Why these together, and why now

Scott's instruction (2026-09-10): build the individual-owner path (Tier 0 completion) and the
institutional REIT/fund path (bench ranking + role inference) **side by side, so nothing is missed
between them**, plus a third piece — a formal control-chain classifier for the "which member of this
LLC is actually in control" case, using only data already held (Scott's explicit choice: free/existing
data now, not gated on the paid APIs named in §8a — accept under-coverage on the LLC-member scenario
until that data is added later; do not silently invent data to compensate).

**Ship these as separable, independently-guarded units in one PR, exactly the ACI-phase0 pattern** —
do not combine migrations whose rollback paths differ, and name explicitly which units you completed
versus which you could not size or scope in this pass.

## Unit A — AC1d remaining pieces (Tier 0 completion, individual/small owners)

Still open from `AC1d`: (b) un-park signals wired from correspondence / SF campaign membership /
title / sponsor map — a parked card should self-unpark when new corroborating evidence lands, not
stay parked forever; (c) learning from `lcc_tier0_confirm_log` — a human **reject** on a domain should
demote that domain for OTHER owners sharing the weak token, not just the one card it was rejected on.
Read `tier0-owner-contact-system.md` §5 traps 2 and 4 before touching the exclusion/suppression logic
— both are prior footguns in exactly this area.

## Unit B — AC1e (SPE subsidiary inheritance)

Subsidiaries "should be connected to the true owner parent once we have a connected domain and
person" (Scott, from the lane). `lcc_buyer_parents` (25 curated parents) and `v_lcc_entity_tier0_parent`
(330 proposals) already exist; `entity_relationships` has no parent-type edge and 0 parent edges today.
Build the parent edge type + inheritance; the bulk attach must go through the existing JS verdict path
(never a new SQL writer skipping the shape gates); WHICH person stays a human decision where more than
one candidate exists (UIRC has 7). Re-measure the 19-of-107-cards figure before building — it is from
the original P193 audit and may have moved.

## Unit C — AC2/AC3 (the REIT/fund role taxonomy — Scott's institutional ask)

Build Tier 1 (bench ranking: score each candidate person on correspondence volume, recency, two-way
vs one-way, seniority signal, inferred function — keep a bench, `owner_contact_pivot.bench` column
already exists, never collapse to one winner) and Tier 2 (Ollama infers function/remit from subjects
+bodies where available, using the four-bucket taxonomy in §3a — acquisitions / disposition /
transaction-DD / broker — carrying confidence per P181, surface gated on it). The target is the
**acquisitions** contact specifically, not the highest-volume correspondent (the worked Easterly
example: Pulliam EVP-Acquisitions at 71-109 emails is the target; Shuler, a DD manager at 51, is not).
Value-gate by owner rent (P161/P180 doctrine — never per-task). Read §3b's correction before touching
Salesforce membership as a signal — `org_entity_id` was measured at 0 for all 41 high-value owners
tested; the working key is email domain, never company name.

⚠️ **Land AC6/AC8/AC9 first, or alongside, not after** — they are measured defects in the exact
correspondence signal Unit C depends on: AC6 (professional emails misfiled as "personal," corrupting
both the voice corpus and this engine's inputs), AC8 (`v_lcc_prospecting_edge_review` narrower than
its name, gives false negatives on broker tests), AC9 (7 competitor-broker edges on Easterly still
wear the wrong role, should have been caught by the P198 merge but weren't re-checked after). Re-measure
each before fixing — all three are named from an August audit.

## Unit D — the individual-owner control-chain classifier (new, §8 of the design doc)

⚠️ **§8's original framing (paid APIs required, build only against `true_owners.notice_address_1`) is
SUPERSEDED — read `public-records-source-lane.md` §7 FIRST, and the correction banner at the top of
§8, before starting this unit.** A companion prompt (`PR-scanner-writeback.md`) wires the extension's
existing county/recorder/SOS scanner into real structured captures (mailing address, deed grantor/
grantee, SOS officers/members) — if that prompt has already shipped, source this unit's `llc_member`
edges and address signals from ITS real data, not only `true_owners.notice_address_1`. If it has not
shipped yet, build Unit D exactly as scoped below against `notice_address_1` alone (still correct, just
narrower), and note in the response that it should be re-run against the richer source once available
— do not block this unit on the other one landing first, they are independently useful.

1. Size the population first: how many recorded-owner LLCs classified `one_off_owner` (C13b/C13c) have
   *any* signal available — a `true_owners.notice_address_1` that survives `address-reverse.js`'s
   residential-vs-agent-service classifier, an incidental member name surfaced in correspondence/
   Salesforce/deed text, OR (if `PR-scanner-writeback` has shipped) a real SOS/recorder capture? State
   the real number before building anything.
2. If the population justifies it: add the `llc_member`/`llc_manager` `entity_relationships` edge
   type (none exists today — confirmed live). Only a human-verdicted or corroborated-from-existing-text
   member claim may write this edge; never a silent auto-mint from an unverified name match.
3. Wire `address-reverse.js`'s existing classifier against whatever real address source is available
   for this population, as a real signal with its own confidence weight — do not blend it into Tier 0's
   email-domain confidence tiers, which measure something different.
4. If step 1's population is too small to be worth a lane of its own, say so plainly, record the
   measurement in the backlog, and do NOT build a lane for a population you cannot show exists —
   that is worse than doing nothing (a UI surface with no real rows is exactly the P194/dormant-flag
   class this repo has paid for before).

## Guard + ship

Each unit gets its own guard, mutation-verified, in the style of the ACI-phase0 arc — RED on the old
behavior, green after. Keep units separably revertible; do not combine migrations across units.
Confidence must travel with every escalation (P181) — a low-confidence guess and a corroborated match
must not render identically on any card.

## Ship + record

Branch `build/aci-phase1-2`. STATUS.md entry naming what shipped in each of the four units and, for
Unit D, the actual sized population (this is the real finding worth recording — whether the
control-chain logic has anything to run on yet at all). `PLANNED-BACKLOG.md` rows `AC1d`, `AC1e`,
`AC2`, `AC3`, `AC6`, `AC8`, `AC9` — mark ✅ only for what is deployed and guarded; mark a unit 🟡 and
say exactly what's missing if it's partial. `account-based-contact-intelligence.md` §7c/§8 — update
with what shipped and Unit D's population finding.
