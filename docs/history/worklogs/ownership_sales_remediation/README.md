# ⚠️ ARCHIVED — May 2026 ownership & sales remediation campaign

**Archived 2026-08-28 from `docs/ownership_sales_remediation/`. HISTORICAL RECORD ONLY.**
**Nothing in this folder is a current work queue, and several files assert things that are now
false.** Every file's "Plan status / TODO" table reads like current state; it is not.

> **Before quoting ANY file here, read §1 and §2 below.**
> **Open items were extracted to `docs/os/PLANNED-BACKLOG.md` §P14 (rows M1–M11) on 2026-08-28.**
> Nothing was lost in the move — but nothing here is the place to look for what is still open.

---

## 1. Blanket corrections — these apply to EVERY file in this folder

| the files say | the truth since |
|---|---|
| **Vercel is production** (`vercel.json` rewrites, "set the env in Vercel", "Vercel cron", "12-function hobby-plan limit") | **Vercel was retired 2026-07-20.** Railway + `server.js` is the sole `/api/*` router; `vercel.json` no longer exists. ⚠️ **P194: the retired Vercel deployment STILL ANSWERS and still holds a service key** — any instruction here to configure env or routes there is a live foot-gun, not a dead reference. |
| **`gov.unified_contacts` is the live contacts store** | **FALSE since 2026-05-29.** `CONTACTS_HUB='ops'` — **LCC Opps is authoritative** (31,038 rows and growing); the gov copy is a **frozen pre-cutover snapshot**. Every hub row count in these files (13,600 / 29,634 / 29,639 / 29,481) is superseded. |
| **"Ownership history not in unison ✅ FIXED"**, **G13 "sales chain continuity ✅ resolved"** | **Producer-side only.** The consuming research lane recorded **0 completions for 69 days** and only reached 1,302 after the Aug 2026 A1→B1a arc. This is precisely the false-positive the Dead-End playbook (Class 2) now warns about. |
| ownership-store magnitudes | gov `ownership_history` **14,502 → 18,953** (the 2026-08-28 **B5** seller-exit feeder); gov deeds 5,572 → 5,804, of which only **876 carry a grantor**. Chain depth was later found **source-limited**, and the unlock was **`sales_transactions_seller_exit` — a feeder gov never had**, a mechanism no file here considers. |

## 2. ⚠️ Per-file warnings — the six that are actively misleading

| file | warning |
|---|---|
| **`2026-05-27_a9b_cutover_design.md`** | 🚨 **Its header says "Status: design / not executed". THAT IS FALSE — the cutover went live 2026-05-29.** A session reading this first concludes the Contacts backend is still gov. **Phases 6–7 remain open → M4.** |
| **`2026-05-29_a9b_cutover_runbook.md`** | 🚨 **The cutover is ALREADY EXECUTED. Do NOT run Step 0's "gov→hub delta re-sync, do not skip"** — it would import from the stale gov snapshot into the authoritative hub. |
| **`2026-05-27_a9a_session_status.md`** | 🚨 States the app is backed by **`gov.unified_contacts` "the live store"** — false since the cutover. All its hub counts are superseded. |
| **`2026-05-27_c5p2final_session_status.md`** (+ `_c5`, `_c5p2prep`) | ⚠️ **"C5 DONE" means the CONSTRAINT shipped, not that the overlaps were resolved.** **617 rows remain grandfathered out of `excl_oh_no_overlap`** and the review queue was never drained → **M1**. |
| **`2026-05-27_a7_session_status.md`** | ⚠️ Describes the A7 cron as running and the queue as draining. **It never ran** — cron 48 `lcc-sf-link-tick` is `active=false` **and posts to the retired `'vercel'` host**. The 30,711-row queue was never drained → backlog **C1a–C1e**. |
| **`2026-05-29_RE-AUDIT.md`** | ⚠️ Its G13 "resolved" verdict is producer-side only (see §1). Also carries the **engagement-score no-op** finding → **M6**. |

**Two further files carry standing open items** worth flagging: `2026-05-27_c8_session_status.md`
(**LoopNet PA Flow 3 has never been built — 0 leads have ever landed** → M8) and
`2026-05-29_post_audit_hardening.md` (the **17-field `field_source_priority` ladder list**, which
exists nowhere else → K3).

**Worth PRESERVING as decisions, not defects:** `2026-05-27_b3_investigation_session_status.md`
closes B3 as **N/A — do not re-attempt** (with 96 residual deed orphans named → M10), and
`2026-05-29_a8_closure.md` closes A8 as *"no payload cache exists, skip"*. Both are the kind of
"we looked, here is why not" record that stops a future session re-walking dead ground.

## 3. What the campaign was

A 32-item remediation against three symptoms Scott reported — duplicate sales rows, sales records
missing fields, ownership history "not in unison" — run **2026-05-23 → 2026-05-29** across dia, gov
and LCC Opps: **Week 0 foundations (F1–F4)** → **Track A** (one-shot cleanups A1–A9) → **Track B**
(continuous cron workers B1–B8) → **Track C** (writer/schema hardening C1–C9), closing with a
15-gap re-audit (G1–G15). Final claim: **29 done, 2 partial (C9, A9), 1 workstation handoff (C7).**

⚠️ **Note the letter collision.** This campaign's A/B/C tracks are **unrelated** to the Aug-2026
lettered prompts (A1–A5, B1–B6, C1–C2) in `docs/claude-code/prompts/`. *"B4"* here is a May sales
worker; *"B4"* there is the dia-vs-gov chain-depth question. **Always check the date.**

## 4. Where to look instead

| for | read |
|---|---|
| what is still open from this campaign | `docs/os/PLANNED-BACKLOG.md` **§P14, rows M1–M11** |
| current ownership-chain state | `docs/architecture/ownership-history-lane.md` |
| how sources connect (and must connect) | `docs/architecture/data-coherence-invariants.md` |
| current system state | `docs/os/CURRENT-STATE.md` |
| the original plan this executed | `docs/history/OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md` |
