# B6d — grade the feed EXPECTATIONS against measured cadence, before the alert surface becomes noise

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6d` (new).
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I4/I11**.
**Closes:** the B6a → B6a-follow-up → B6b arc, honestly.

---

## 0. Why this is the right next step, and why it is small

B6a made producers visible, B6a-follow-up made them alertable, B6b restarted the one worth
restarting, and **B6b-lead deliberately refused the other.** That refusal is what makes this urgent:
**we decided not to restart `prospect_leads_ownership_change`, so its alert now describes a decision
and will sit open forever.**

⚠️ **An alert that describes a decision is the badge-that-is-noise failure — inside the alerting
system we just spent three prompts repairing.** The Consumption-Layer doctrine says every badge must
be actionable work. Four of these are not.

**This prompt changes no producer and writes no data. It grades EXPECTATIONS.**

---

## 1. Live state, measured 2026-08-29

**23 feeds tracked · 4 alerting · 19 ok.**

| feed | domain | SLA | age | verdict I expect |
|---|---|---:|---:|---|
| `prospect_leads_ownership_change` | gov | 45 | **151** | **RETIRE the expectation** — B6b-lead graded this lane and **deliberately did not restart it**; it has no human consumer (Class 26). An alert for a lane we chose to leave dead is pure noise. |
| `property_sale_events` | gov | 45 | **145** | **RE-SCOPE** — B6c established its bulk producer was retired **on purpose** and its only live producer is an **operator form with no cadence**. A 45-day SLA alerts whenever nobody types a sale for six weeks. |
| `medicare_clinics` | dia | 45 | **65** | **PROBABLY THE SLA IS WRONG** — CMS publishes on a slow cadence and `facility_patient_counts` is documented as ~annual. **Measure the actual inter-publication gap before calling this a defect.** |
| `sam_lease_opportunities` | gov | 14 | **33** | **RE-SCOPE** — SAM is documented at a **~10 lookups/day rate limit**; a 14-day SLA is not achievable by the pipeline we have. |

**⚠️ AND TWO MORE ARE ABOUT TO FIRE FOR NON-DEFECT REASONS — this is the part that makes it worth
doing now rather than after they alert:**

- **`opm_workforce` — age 120, SLA 120. It is exactly at the boundary and alerts tomorrow.** OPM
  workforce data is a slow federal publication; a 120-day expectation on it is a guess.
- **`gsa_leases_snapshot` — age 59, SLA 65. Six days out.** ⚠️ **And it will fire for a reason that
  is NOT a defect: the raw GSA feed is capped at 2026-07-01 because GSA has not published August**
  (pull ledger 2026-08-24, `consecutive_unchanged=3`). **A publisher that has not published is not a
  broken pipeline.**

**⚠️ The tell that these were never graded: `expected_max_age_days = 45` appears on 10 of 23 feeds** —
dia deeds, dia sales, gov sales, federal lease awards, change facts, dia loans, lease timeline, and
all three of the 45-day alerts above. **That is a default, not a measurement.**

---

## 2. What to do

**For every one of the 23 feeds — not just the six above — establish the expectation from the DATA:**

1. **Measure the actual inter-arrival distribution.** `max(gap)`, p90, median between distinct
   publication dates over the feed's life. **An SLA should sit above the p90 gap of a healthy
   period, not at a round number somebody liked.**
2. **Name the producer and its cadence class** — continuous (operator/sidebar), scheduled (cron),
   or **external publication** (GSA monthly, CMS ~annual, OPM slow, SAM rate-limited). ⚠️ **An
   external-publication feed's SLA is a property of the PUBLISHER, not of our pipeline**, and
   conflating those is what makes `gsa_leases_snapshot` about to alert.
3. **Decide per feed: keep · re-scope (new number, stated reason) · retire the expectation.**
4. **Retiring must be explicit and visible** — a feed we deliberately stopped watching must be
   *recorded as such*, not silently deleted from the registry. **Otherwise B6a's whole point (a
   skipped step must emit, not vanish) is undone at the expectation layer.**

---

## 3. ⚠️ Rules

**3a. An operator-driven surface cannot carry a calendar SLA.** `property_sale_events` only moves
when a person types a sale. **The right expectation for that class is not "N days since the last
row" — it is either no expectation, or one on the PRODUCER being reachable.** Say which.

**3b. Do not resolve an alert you have not fixed.** Retiring an expectation and resolving an alert
are different acts. **The alert should close because the expectation changed, and the change should
be legible** — a reader six months from now must be able to see *why* nobody watches this any more.

**3c. Do not weaken an SLA to silence a real defect.** Three of the four alerting feeds have a
non-defect explanation; **`medicare_clinics` does not yet — it is a hypothesis.** ⚠️ **Measure CMS's
actual cadence before widening it.** If the gap is genuinely ~annual, widen it; if CMS published in
July and we missed it, that is a real break and widening the SLA would bury it.

**3d. Positive-control the change.** After re-scoping, **confirm the surface still fires** — pick a
feed, simulate staleness past its new bound, prove the alert opens, restore. **An SLA set so wide
that nothing can ever trip it is the same failure as no monitor at all** (I11).

**3e. Report `alerts_open` before and after, and name every alert that closed and why.** ⚠️ **Read
the alert ledger, not the run log** — that is the lesson B6a-follow-up exists for.

---

## 4. Verification

- **Every one of the 23 feeds has a stated cadence class and a reasoned expectation.**
- **Open `feed_stale` alerts drop to only those describing REAL breaks**, each named.
- **`opm_workforce` and `gsa_leases_snapshot` do not fire spuriously** in the next 7 days.
- **The detector was seen firing after the change** (§3d) — not assumed.
- **Retirements are recorded, not deleted.**
- Guards mutation-verified RED, comments stripped before matching.

## 5. Deliverable

`docs/audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md`, plus the **BUILD-TURN-PROTOCOL closing
checklist**: `PLANNED-BACKLOG.md` (B6d, and close `B6b-lead`'s alert follow-on),
`data-coherence-invariants.md` **I4/I11** (the detector rows should record that expectations are now
measured rather than defaulted), and a STATUS entry.

⚠️ **If a feed's honest answer is "we have no basis for an expectation yet", say that and set none** —
a null expectation that is *recorded as deliberate* is better than a 45-day default that alerts on a
publisher's holiday. **The goal is an alert surface where every open row is worth reading.**
