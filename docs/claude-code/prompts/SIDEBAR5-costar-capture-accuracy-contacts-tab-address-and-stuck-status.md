# SIDEBAR5 — CoStar capture accuracy: the Contacts-tab address became the property; the panel's "still processing" never clears; header junk still sent as tenants

Backlog: `SIDEBAR5`. Source: Scott, 2026-09-23, with 2 screenshots of CoStar #1014478 and the side panel. Measured by Cowork, 2026-09-23.

## 1. The wrong address was captured (a data-accuracy defect)

- Scott saved CoStar property **#1014478**. Its page header reads **"2600 Central Fwy N - Wichita Falls Shopping Center"**, Wichita Falls TX 76306 (Storefront Retail, 22,130 SF GLA, built 2001, multi-tenant). He saved it from the **Contacts** tab (`/detail/lookup/1014478/contacts`).
- The capture recorded **`4005 Call Field Rd, Suite 100, Wichita Falls, TX 76308`**. That is the **Primary Leasing Company** block on that tab: Truity Capital, 4005 Call Field Rd, Suite 100. It is not the property.
- Downstream it went to:
  - LCC entity `2f90e232-6c7c-41f2-8b4b-6cb8e7fc7e81`, named with that address;
  - a **new gov property 41083** (`4005 call field rd`, agency "Wichita Falls VA Clinic", `agency_canonical=VA`, `government_type` null), minted 2026-09-23 17:47 UTC.
- It is the same class as GOV-AVAIL1 (a broker/firm contact block taken as the subject address), but in the **extension's CoStar parse** (`extension/content/costar.js`, `parseAddress` ~1073 and its callers), not the OM extractor.
- Gov also already holds **31048** `2600 Central E Fwy` (agency VA) and **31796** `2600 central e freeway` (U.S. Department of Veterans Affairs). They are twins of each other, and possibly the same site as this shopping center. Don't assume; compare parcel 101513, lot and GLA.

**Ask:**
- (a) The subject address must come from the property header/summary element on **every** CoStar tab. Never take it from a Contacts / Leasing Company / Recorded Owner / Architect block. If the header isn't in the DOM, refuse to save and ask for a re-scan. Don't fall back to a contact address.
- (b) Server-side defence: run the capture's address through GOV-AVAIL1's `applySubjectAddressGuard` / brokerage-office registry. Also flag a capture whose address differs from the page title's street.
- (c) Residue:
  - Repair entity `2f90e232…` to the header address, logged.
  - Quarantine or correct gov 41083 reversibly, following the GOV-AVAIL1 pattern.
  - Put 41083, 31048 and 31796 into the gov twin/duplicate review with the parcel evidence. Merge nothing automatically.
  - Grep the last 30 days of CoStar captures for the same pattern (captured street ≠ page-title street) and report the count.

## 2. "Pipeline still processing for the latest save…" never clears (SIDEBAR4-d follow-up)

- The run finished at 17:47:26.935 UTC, 55 s after the Save: `_pipeline_status='success'`, `_pipeline_processed_at` set, one run in `_pipeline_run_log`.
- `pollPipelineStatus` (`extension/sidepanel.js` ~154) stops after `POLL_WAITS_MS = [3500, 6000, 10000, 16000]` (35.5 s) and returns `{status:'processing'}`. That value is stored in `LccCaptureState.rememberAction` (a 10-minute memo).
- `computeMatchedView` (`extension/shared/capture-state.js` ~210–222) prefers `rec.pipeline` over the stored `_pipeline_status`. So the memo's "processing" beats the database's "success" on every re-render, for 10 minutes.

**Ask:**
- A stored terminal status (`success` / `failed`) whose `_pipeline_processed_at` (or last run-log `finished_at`) is **newer than the memo's `at`** overrides the memo.
- Keep polling with backoff up to ~3 minutes (runs of 55–70 s are normal), then show "still running, check back" without freezing the state.
- Also: `if (summary)` treats a **previous** run's `_pipeline_summary` as this run's success on an Update. Key the terminal check on `_pipeline_processed_at > action time`.
- Tests for each case, each with a mutation that turns it red.

## 3. Table-header junk still sent as tenants

The same capture's tenants include **"Office/Ret Avail"** and **"Total Avail"**. The server guard (LEASEJUNK1) catches them for dia leases, but the extension still sends them, and the side panel's "Comparison" shows them. Add LEASEJUNK1's header list to the extension's `COSTAR_UI_REJECT` / `TENANT_REJECT`, lock-step with the server list, plus a drift test. This closes LEASEJUNK1's open residue item.

## Done means

- Bump the manifest; Scott reloads the extension.
- Deploy = redeploy BOTH Railway services if server code changes.
- Backlog rows `SIDEBAR5` and LEASEJUNK1 (residue) updated.
- Cowork re-verifies with Scott's next Save from a Contacts tab.
