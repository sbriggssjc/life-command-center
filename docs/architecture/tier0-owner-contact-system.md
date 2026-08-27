# Tier 0 owner-contact system — the canonical reference

> **START HERE for anything about matching a person to an owner, the Decision Center Tier 0 lane,
> the sponsor map, or owner-entity merges.** This is the one door into an arc that otherwise spans
> **twelve** audit documents. Live state, the objects that exist, the decisions already made, and
> the traps already paid for.
>
> **Nothing here replaces the per-round audits — they are the evidence and they stay.** This page
> tells you which one to open. Last measured **2026-08-27 16:30 UTC**.
>
> 🔗 **Sibling subsystem, same entity graph:**
> [`ownership-history-lane.md`](ownership-history-lane.md) — the `establish_ownership_history`
> lane (A1–A4b). **The two share `lcc_merge_entity`, `lcc_owner_sponsor_domain` and the owner
> entities themselves**, so a merge confirmed here changes the chains there. Read that page before
> touching ownership history; read this one before touching entity identity or person↔owner links.

---

## 1. What it does, in one paragraph

Owners are companies; the people who run them are in `entities` but usually not linked to the
owner. Tier 0 proposes `(owner, person)` pairs by matching the person's **email domain** against
the owner's name, classifies each proposal by how strongly the domain identifies the owner, hides
the ones nobody could act on, and asks Scott about the rest. A confirmed answer writes the owner's
active contact and a person→owner edge. **The account is the pursuit; who to call there is a
separate, standing decision** (`account-based-contact-intelligence.md`).

## 2. Live state — 2026-08-27 16:30 UTC

| | |
|---|---|
| candidate pairs | **684** |
| lane cards shown to the operator | **93** (ask 84 + auto 9) |
| parked, not shown | **137** |
| human attaches recorded | **27** |
| owner merges logged (all reversible) | **35** |
| `tier0_auto` writes | **0** — see §6, this is a pending verification, not a failure |
| curated sponsor entries | **8** |
| `TIER0_AUTO_ATTACH` | **`off` in the registry** — it describes the RUNTIME, not the intent |
| merge-detector blind groups remaining | **64** (176 entities) |

## 3. The objects

**Views** — `v_lcc_tier0_owner_contact_candidates` (the pair engine) →
`v_lcc_tier0_owner_contact_lane` (aggregated to cards) →
`v_lcc_tier0_owner_contact_lane_triage` (adds `match_strength` + `decidability`) →
`v_lcc_tier0_owner_contact_lane_open` (**what the UI reads**: ask + auto only).
Also `v_lcc_tier0_park_watch`, `v_lcc_tier0_sponsor_map_proposals`, `v_lcc_tier0_sponsor_rollup`,
`v_lcc_merge_candidates_normalizer_blind`, `v_lcc_entity_merge_reversibility`.

**Tables** — `lcc_owner_sponsor_domain` (curated, human-confirmed, `confirmed_by` required),
`lcc_tier0_confirm_log` (verdict ledger, reversal), `lcc_entity_merge_log` (merge ledger).

**Functions** — `lcc_owner_domain_core` (**order-preserving**), `lcc_owner_name_is_not_prospected`
(= public body OR university), `lcc_owner_name_is_university`, `lcc_tier0_employer_on_file`,
`lcc_merge_entity` / `lcc_unmerge_entity`.

**Route / flag / cron** — `GET|POST /api/tier0-auto-attach-tick`, flag `TIER0_AUTO_ATTACH`,
cron **241 at 06:55 UTC**. The GET is an ungated dry run and writes nothing.

**UI** — `#/decisions` → lane **"Tier 0 — confirm the owner's firm domain"**.

## 4. Decisions already made — do not re-litigate

| decision | who | detail |
|---|---|---|
| **Municipalities and public bodies are never prospected** | Scott 2026-08-26 | ownership reconciliation is unaffected |
| **ALL universities are out of scope** | Scott 2026-08-26 | explicit, cost stated: GWU $23.8M + Georgetown $8.0M |
| **Corroboration ≠ correspondence** | Scott 2026-08-26 | any evidence of "the right source or connection or prospect historically" |
| **Only the strongest candidates are shown** | Scott 2026-08-26 | 255 → 96 cards |
| **Sponsor map: 8 confirmed** | Scott 2026-08-26/27 | ngp, uirc, hpi, jbg, gardner, salus, oxford, savlan. **fcp and tmg deliberately held** |
| **Rejected sponsors** | Scott 2026-08-27 | `royal` (common word), `maple` (the Mapletree place-word trap) |
| **A confirm lane, not an unattended promoter** | measured | link precision ~91% only above ~$16M, ~60–70% in the $2M SPE band |

## 5. ⚠️ Traps paid for — each cost a real cycle

1. **`lcc_owner_strict_core` SORTS its tokens.** `'Boyd Watterson Asset Management, LLC'` →
   `assetboydmanagementwatterson`, which does not contain `boydwatterson`. Use
   `lcc_owner_domain_core` for domain matching. *(P187)*
2. **Evidence attests the PERSON, not the LINK.** Salesforce membership, an SF contact, Outlook and
   correspondence all answer *"is this person real?"*. Only the employer matching the **owner**
   answers *"do they work here?"*. **Gary George at `georgesinc.com` — a poultry company — carries
   three of four for George Washington University.** *(P188)*
3. **A gate that filters a join is part of that join.** P187's fan-out gate re-created the exact
   cross product P186 removed: `Rows Removed by Join Filter: 6,222,095`. *(P196)*
4. **A write whose scope is wider than its question.** Cards are `(owner, domain)`; the exclusion
   was `(owner)`, so one attach closed an owner's other cards — suppressing Easterly's Pulliam card
   behind a zero-evidence attach. *(P191, playbook Class 14)*
5. **A new enum value satisfies every `<>` written against the old one.** Adding `tier0_auto`
   silently re-broke #4. *(P194)*
6. **Dormancy measured on the WRAPPER, not the FUNCTION.** `lcc_apply_fuzzy_merges` has 0 callers;
   `lcc_merge_entity` has nine and merged 285 entities in 30 days. *(P196, playbook Class 16)*
7. **ALL-CAPS is not an acronym signal** — 27.6% of owner names are entirely uppercase, so the rule
   produced `BOYD DEL RIO GSA LLC → dell.com`. A curated map replaced it. *(P187)*
8. **Precision is a curve; always quote the rent band.** *(P188)*
9. **Read the right JSON key.** `contact_company` vs `company` produced a confident "100% missing
   employer" that was 74.8% present. **Two measurements disagreeing is the signal.** *(P197 prep)*
10. **A reversal path never RUN is a claim, not a capability** — P195's failed on
    `428C9 is_current is GENERATED ALWAYS`; P196's on a trigger that skips duplicate edges. *(P195/P196)*
11. **⚠️ Before DEMOTING a rule, measure what depends on it.** The prefix-8 arm of
    `ev_company_matches_owner` looked like a leak producing two generic-stem cards; it is the
    **only** link evidence on **28 of 87 ask cards / $146.9M**, and the un-park mechanism for
    **25 of 32 `weak_partial`** cards. Tightening it would have parked Easterly ($85.0M) to
    remove ~$5.6M of wrong. A rule's false positives are visible; what it holds up is not.
    **Do not tighten this comparator.** *(P198 — P179 Class 2 read backwards)*
12. **`lcc_name_has_spe_marker` is named backwards** — it detects a PORTFOLIO/sponsor marker
    and returns **FALSE for every name containing the literal string "SPE"**. Read the
    function, never its name. *(P198)*

## 6. Open — and what is merely PENDING vs genuinely open

**⏳ Pending verification, not failure:**
- **`TIER0_AUTO_ATTACH`** is set in Railway and redeployed, but cron 241 last ran **06:55 UTC before
  the redeploy** and reported `flag_off`. **The next 06:55 run is the first honest test** — expect
  `active_source='tier0_auto'` 0 → 9. Do not diagnose before it. Registry flips to `on` only after
  a tick reports `writes > 0`.
- **Sidebar `_provider` stamp rate** — 0%, but the newest row predates the extension reload. One
  CoStar capture settles it.

**👤 Needs Scott:** `fcp→fcpdc.com` and `tmg→tmgdc.com`; **N3c** bank/trustee scope (Truist $6.2M /
15 candidates, Wells Fargo, the JP Morgan CMBS trust); **N15** whether the 1,475 Salesforce-campaign
orphans get hub rows.

**✅ Done 2026-08-27 16:28 UTC (P198 §5):** Scott approved and all three merges landed — Easterly,
Cambridge, Gardner. Six cards became three; **Easterly is now ONE card at $114,864,150 / 89 assets /
7 eligible people**, the combined pre-merge total exactly. Lane `ask` 87 → 84. All reversible.

**👤 Needs Scott (new, N3h):** the same three firms carry **9 MORE duplicate entities**, all at $0
current rent so invisible to every rent-ranked surface. **Gardner is the one that matters — its
deal history is split, with 240 relationships on a live entity separate from the one holding its 13
assets** (the P177 failure). Not merged, because an approval of three named pairs is not extended
by inference. ⚠️ Gardner's `min_loser_sim` is 0.667, so read it; Easterly/Cambridge are 1.000.

**🔴 Build:** N14 the 92 orphans blocking parked cards; N10 the 4 held generic-name groups (~$0,
a name-repair job).

**🚫 Closed, do not re-raise:** tightening `ev_company_matches_owner` for the two generic-stem
cards (`innovati`, `corporat`) — **measured and refuted, trap 11 above.** The five false
positives are a stated residue and a one-second reject each, because the card carries the
employer and the match key. Co-proposal as a general merge rule — **7% precision**, worse than
the domain-keyed fix P189 already rejected at 25%.

## 7. The audit trail — open these for detail, in order

| round | what it settled |
|---|---|
| **P186** | view 58.7s → 0.25s; public bodies out of scope; the bench read |
| **P187** | `lcc_owner_domain_core`; the acronym arm measured and rejected |
| **P188** | the confirm lane; evidence attests the person, not the link |
| **P189** | merge detector blind to 1,089 orgs; the domain-keyed fix rejected at 25% |
| **P191/P192** | per-(owner,domain) closure; decidability triage 255 → 109 |
| **P194** | auto-attach tick; the `<>`-exclusion trap |
| **P195** | 66 entities merged, $102.2M consolidated |
| **P196** | merge made reversible; park reasons |
| **P197** | the employer resolver; `no_employer_on_file` 68 → 54 |
| **P198** | the prefix-8 arm is load-bearing (refuted a tightening); co-proposal at 7%; 3 merge decisions |
| **A1–A4, A2a** | the ownership-lane arc (a sibling workstream, same entity graph) |

**Design intent:** `account-based-contact-intelligence.md` (who to pursue) ·
`contact-reconciliation-outbound.md` (getting the record back out).
**Failure classes:** `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` — Classes 9, 11, 13, 14, 16 all have
Tier 0 instances.
