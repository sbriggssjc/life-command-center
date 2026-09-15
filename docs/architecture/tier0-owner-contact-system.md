# Tier 0 owner-contact system — the canonical reference

> **START HERE for anything about matching a person to an owner, the Decision Center Tier 0 lane,
> the sponsor map, or owner-entity merges.** This is the one door into an arc that otherwise spans
> **thirteen** audit documents (P186–P198). Live state, the objects that exist, the decisions already made, and
> the traps already paid for.
>
> **Nothing here replaces the per-round audits — they are the evidence and they stay.** This page
> tells you which one to open. Last measured **2026-08-27 22:25 UTC**; §2's headline numbers
> re-measured live and §5/§6 corrected **2026-09-12 (Cowork)** — a real bug was found keeping
> `TIER0_AUTO_ATTACH` silently off for 16 days despite the registry saying `on`.
>
> ✅ **2026-09-14 (Cowork): the 09-12 fix VERIFIED live, closing the one thing §6 explicitly said
> was never actually done.** `lcc_tier0_auto_attach_run_log` shows `attached=0` on 09-12 06:55
> (fix landed mid-day, after that run), then **`attached=9` on 09-13 06:55** — the first tier0_auto
> writes ever (`lcc_tier0_confirm_log.actor` was NULL/system, verdict `attach`, 9 rows, none before
> 09-13). 09-14 06:55 correctly shows `auto_candidates=0` — the easy pool cleared. Owner-to-person
> linkage re-measured the same day: **13.5% (1,377 of 10,187)**, essentially unchanged in ratio from
> the 08-27 audit's 13% (847/6,480) even after the fix started writing — both the linked count and
> the universe grew (universe growth partly explained by OWN-T0b/c's still-open 1,183
> `duplicate_entity` residue inflating the owner count with un-merged duplicates). The fix works;
> the gap it closes per day (9) is tiny next to the gap's size.
>
> 📇 **Topic index for the whole ownership→contact chain (~20 files, and two that are named
> misleadingly): [`connectivity-and-open-threads.md`](connectivity-and-open-threads.md) §0.**
> That page is the LIVING DOC for the chain end to end; this one owns its slice.
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

## 2. Live state — 2026-08-27 22:25 UTC

| | |
|---|---|
| candidate pairs | **735** (was 742 earlier 09-14, 758 on 09-12, 684 on 08-27) — 9-13 auto-attach batch (-16) then the N3c bank/trustee exclusion (-7) |
| lane cards shown to the operator | **70** (was 72 earlier 09-14, 83 on 09-12, 91 on 08-27) |
| parked, not shown | 141 as of 08-27 — not re-measured this pass |
| human attaches recorded | **27**, unchanged since 08-27 (all human attaches predate the fix; see `tier0_auto` writes below for the newer channel) |
| owner merges logged (all reversible) | **176** (was 66 on 08-27) — real growth, unrelated to auto-attach |
| `tier0_auto` writes | ✅ **9 — the fix VERIFIED live 2026-09-14 (Cowork)**, all dated 09-13 06:55 (the first ever; see §5 trap 14 / §6). 09-14's run correctly found 0 new auto candidates — the easy pool cleared, not a regression. |
| curated sponsor entries | 8 as of 08-27 — not re-measured this pass |
| `TIER0_AUTO_ATTACH` | ✅ **`on` since 2026-08-28.** ⚠️ **THE GATE IS THE `feature_flags_registry` TABLE, NOT A RAILWAY ENV VAR** — `tier0-auto-attach-tick.js:208` calls `flagEnabled(await fetchFeatureFlag(FLAG))`. Setting the env var on 08-27 had **no effect**: cron 241 logged `flag_enabled=false, planned=9, attached=0` on both 08-27 and 08-28 |
| merge-detector blind groups remaining | **64** (176 entities) |
| `canonical_name` drift / invisible to `ensureEntityLink` | **0 / 0** — N15c+N15e complete, all 62,368 keyed |

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
| **Banks and CMBS trustees excluded from prospecting** | Scott 2026-09-14 | Same category as public bodies/universities, `lcc_owner_name_is_bank_or_trustee`. Explicitly revisitable if lender prospecting via Northmarq debt-side coordination is decided later |
| **A confirm lane, not an unattended promoter** | measured | link precision ~91% only above ~$16M, ~60–70% in the $2M SPE band |
| **DST / Trust / LLC variants of one sponsor stay ONE entity — the TRUE OWNER** | Scott 2026-08-27 | Answers N15b §6 decision 1. `Rainier Rockford DST Trust` = `Rainier Rockford Llc`; `SE VALPO LLC` = `Se Valpo Dst`; `Chiapelone` = `Chiapelone Trust`. **So `lcc_owner_domain_core`'s `trust\|dst\|reit` strip is CORRECT and is the adopted rule** — what N15b listed as its "named residue" is the desired behaviour. ⚠️ **The aspirational future (individual investors as direct owners, and knowing they hold fractional positions in a DST/TIC/JV on similar deals) is a SEPARATE model and must NOT be built by splitting this dedup key** — see backlog **N17** |

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
13. **⚠️ A FLAG CAN LIVE IN TWO PLACES AND ONLY ONE OF THEM IS THE GATE.** `TIER0_AUTO_ATTACH` was
    set as a **Railway env var** and had no effect for two days: the handler calls
    `flagEnabled(await fetchFeatureFlag(FLAG))` — it reads the **`feature_flags_registry` TABLE**.
    Cron 241 reported `succeeded` both mornings while its own run log said
    `flag_enabled=false, auto_candidates=9, planned=9, attached=0`. **A green cron proves the POST,
    not the write** — and `net._http_response` prunes to ~6 hours, so the handler's OWN run log is
    the only durable record. ⚠️ **The docs made it worse:** this page said *"registry flips to `on`
    only after a tick reports writes > 0"*, which for a registry-gated flag is a **deadlock** — the
    tick can never write until the registry says on. *(2026-08-28)*
12. **`lcc_name_has_spe_marker` is named backwards** — it detects a PORTFOLIO/sponsor marker
    and returns **FALSE for every name containing the literal string "SPE"**. Read the
    function, never its name. *(P198)*
14. **⚠️ A shared helper's signature drifted at exactly one call site, and nobody wrote a guard
    for it.** `flagEnabled(envName, flagRow)` takes TWO arguments; `tier0-auto-attach-tick.js:208`
    called `flagEnabled(await fetchFeatureFlag(FLAG))` — ONE. The fetch result landed in the
    `envName` slot (`process.env[rowObject]` never matches an ON/OFF string) and `flagRow` was
    `undefined`, so the function fell through to its own hardcoded `false` on every call —
    **regardless of what `feature_flags_registry.state` said.** Confirmed live 2026-09-12: the
    tick's own run log shows `flag_enabled=false, skipped_reason='flag_off'` on **all 17 runs from
    2026-08-27 through 2026-09-12**, even though the registry has read `state='on'` since
    2026-08-28 21:51 UTC. Every OTHER caller of `flagEnabled` in this repo (7 of them) passes both
    arguments correctly — this was the one drifted copy. **Fixed 2026-09-12 (Cowork):** the call
    now reads `flagEnabled(FLAG, await fetchFeatureFlag(FLAG))`, matching every sibling tick;
    guard `test/tier0-auto-attach-flag-arity.test.mjs` source-checks the call shape so this exact
    drift can't silently reappear. *(Cowork, 2026-09-12)*

## 6. Open — and what is merely PENDING vs genuinely open

**✅ Actually resolved 2026-09-12 (was wrongly marked resolved on 2026-08-28):**
- ~~**`TIER0_AUTO_ATTACH`** … registry flips to `on` only after a tick reports `writes > 0`.~~
  The 2026-08-28 entry below this line correctly diagnosed the DEADLOCK (registry IS the gate,
  not the Railway env var) and flipped the registry `on` — **but the "next 06:55 run is the real
  test" verification was never actually done.** It stayed broken for a SECOND, different reason:
  see §5 trap 14 — a call-site arity bug meant the tick could never see the registry as `on` no
  matter what the row said. **Both bugs are now fixed** (registry flip 08-28 + call-site fix
  09-12). ✅ **VERIFIED 2026-09-14 (Cowork)** — read `lcc_tier0_auto_attach_run_log` directly rather
  than trusting the cron's green status: 09-13 06:55 shows `flag_enabled=true, auto_candidates=9,
  planned=9, attached=9` — the first non-zero `attached` in the log's history. `lcc_tier0_confirm_log`
  confirms it independently: 9 rows with `actor` NULL (system) and `verdict='attach'`, all dated
  09-13, none before. 09-14 06:55 shows `auto_candidates=0` (pool cleared), which is the expected
  steady state, not a regression.
  **2026-08-28 entry, kept verbatim for the record:** *"RESOLVED 2026-08-28 — and that policy was
  a DEADLOCK I wrote. The handler gates on the `feature_flags_registry` table (`fetchFeatureFlag`),
  not the Railway env var Scott set, so 'flip the registry only after a tick writes' could never be
  satisfied: the registry IS the gate. Two runs proved it — 08-27 and 08-28 both logged
  `flag_enabled=false`, `auto_candidates=9`, `planned=9`, `attached=0`. The tick found and planned
  every card and was refused by the flag. Registry flipped to `on` 2026-08-28; the next 06:55 run
  is the real test (expect `active_source='tier0_auto'` 0 → 9)."*
  **Durable lesson: a green cron proves the POST, not the write — read the handler's OWN run log**
  (`lcc_tier0_auto_attach_run_log`), because `net._http_response` prunes to ~6 hours and
  `cron.job_run_details` only ever says the POST succeeded.
- **Sidebar `_provider` stamp rate** — 0%, but the newest row predates the extension reload. One
  CoStar capture settles it.

✅ **N3c decided and shipped 2026-09-14 (Scott + Cowork):** banks and CMBS trustees excluded from
prospecting permanently for now, as their own category (same mechanism as public bodies and
universities) -- `lcc_owner_name_is_bank_or_trustee`, wired into `lcc_owner_name_is_not_prospected`
so it reaches all seven consuming views. Sized before shipping: 11 owner names match live (10 national
banks + 1 JPMorgan CMBS trust), 0 false positives against individual/family trustees, 0 credit unions
swept in (deliberately -- they can be legitimate owner-occupant prospects). Truist and the 15
candidates named in the original sizing are no longer live in the open lane (population moved since);
what's excluded now is Wells Fargo Bank NA ($3,622,447 rent) and the JP Morgan CMBS trust ($2,377,718
rent), verified gone from `v_lcc_tier0_owner_contact_lane_open`. **Explicitly revisitable** — Scott's
words: "that might be a decision we reevaluate in the future if we decide to start prospecting
lenders directly and work some coordinated capacity with the Northmarq debt side... for now, nothing
though." Migration: `supabase/migrations/20261102150000_lcc_own_t0_bank_cmbs_trustee_exclusion.sql`.

⚠️ **`fcp`/`tmg` sponsor-domain proposals are now STALE, re-checked 2026-09-14** — both have
disappeared entirely from `v_lcc_tier0_sponsor_map_proposals` live (were present when this page was
last measured 08-27/08-28). Whatever candidates generated them were resolved, merged, or reclassified
since. Not re-raising a decision that no longer has a live population behind it; if the underlying
owners resurface, re-measure before asking again.

✅ **N15 decided and shipped 2026-09-15 (Scott + Cowork):** the 1,475 Salesforce-campaign orphans got `unified_contacts` hub rows -- Scott's call, campaign membership is evidence of a real vetted relationship even where LCC hasn't mapped the connection yet. Minted via `lcc_n15_mint_sf_campaign_hub_rows`, reusing this section's own `lcc_tier0_company_confirms_domain` anti-fabrication gate (§P197) so `company_name` is written only when domain-corroborated (228 of 1,475, 15%) -- the rest correctly render with no company rather than a guessed one. Reversible, logged to `lcc_n15_sf_campaign_hub_mint_log`. Full detail: `docs/os/PLANNED-BACKLOG.md`'s N15 row.

**✅ Done 2026-08-27 16:28 UTC (P198 §5):** Scott approved and all three merges landed — Easterly,
Cambridge, Gardner. Six cards became three; **Easterly is now ONE card at $114,864,150 / 89 assets /
7 eligible people**, the combined pre-merge total exactly. Lane `ask` 87 → 84. All reversible.

**✅ Done 2026-08-27 17:05 UTC (N3h):** the 9 further duplicates on those same three firms are
merged, all reversible. **Gardner Tanenbaum Holdings: relationships 270 → 512 (+242)** — its
transaction history had been split across two live entities, so the survivor was reporting half its
own deal history (P177). `auto_mergeable` 3,043 → 3,040, exactly the three groups resolved.
⚠️ **All nine losers carried $0 current rent** — no rent-ranked surface would ever have shown this;
it was found by chasing a guard counter that moved by 2.

**👤 Needs Scott (N15c — TWO decisions left; the token rule is settled, built AND LIVE):**
`entities.canonical_name` now has **one writer**. The adopted rule is the `lcc_owner_domain_core`
token stoplist **joined with spaces** (never bare-concatenated — that collides `Gate Way` with
`Gateway`, 115 false collisions measured). ✅ **(1) The 537 stale rows are DONE** — Scott approved recomputing; batch `n15e_go` applied
2026-08-27, drift **537 → 0**. 👤 **(2) Still open: whether the column becomes an enforced UNIQUE
key.** ⚠️ **The input to that decision moved: 3,930 was PRE-N15c and is now 6,608** — collapsing
keys is exactly what creates collisions (3,930 → 6,584 after N15c → 6,608 after N15e).
⚠️ **`v_lcc_merge_candidates` does NOT read this column** — the rewrite cannot move `auto_mergeable`,
and it did not (3,040 → 3,040). Full build: `docs/audits/N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md`.
⏳ **N15d — the Class-8 recurrence check is due 2026-08-28** and is the only thing that proves the
PRODUCER is fixed rather than its output backfilled: new key-disagreement duplicates must read **0**
against the pre-fix ~4/day.

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
| **P198** | the prefix-8 arm is load-bearing (refuted a tightening); co-proposal at 7%; **12 owner merges — 3 approved pairs + N3h's 9, which reunited Gardner's split deal history (270 → 512 relationships)** |
| **N15b → N15c** | **the producer behind all of the above.** N15b measured; **N15c BUILT it (2026-08-27)** — `lcc_entity_name_tokens` is the one token rule, `lcc_entity_canonical_key` (space join) is the key, `lcc_owner_domain_core` refactored onto it and **proven byte-identical over 103,710 values**. A `BEFORE INSERT OR UPDATE OF name` trigger is the sole writer. ⚠️ **The census was wrong twice — there are TEN writers**, and one more normalization hid in a dead ternary fallback; that is why the fix is at the DB, not in grep. ✅ **TRIGGER APPLIED + BACKFILL RUN 2026-08-27 20:05 UTC** (batch `n15c_go`), after live `/version` was confirmed at `d8fcfbfef94a` — the N15c merge commit — and the dual-read verified in the source at that sha. 15,402 rewritten, 537 held, empty-string keys 114 → 0. Invisible entities **10,336 → 537** (the held rows). `auto_mergeable` unmoved at 3,040 |
| **A1–A4b, A2a, A2b** | the ownership-lane arc — sibling workstream, same entity graph: [`ownership-history-lane.md`](ownership-history-lane.md) |

**Design intent:** `account-based-contact-intelligence.md` (who to pursue) ·
`contact-reconciliation-outbound.md` (getting the record back out).
**Failure classes:** `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` — Classes 9, 11, 13, 14, 16 all have
Tier 0 instances.
