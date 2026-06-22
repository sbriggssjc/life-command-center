# Salesforce / pipeline data-quality audit (2026-06-22)

> Audit #36. Is the CRM/pipeline data (SF sync, opportunities, leads, cadences, contacts) accurate,
> deduped, and healthy? Grounded live on LCC Opps (gov DB was mid-restart; gov-side `prospect_leads`
> covered separately). Headline: **the data is clean and syncing; the pipeline is under-utilized.**

## Data quality / sync — HEALTHY
- **SF sync at scale, low error:** 61,613 sync-log rows in 7 days, **12 errors (0.02%)**. The SF
  ingest pipeline works.
- **Entity graph large + deduped:** 23,638 organizations / 4,338 persons (live, post-R39/R40
  email-dedup + merge-orphan reconcile). The contact/account graph is in good shape.
- **Activity ingest at volume:** 8,312 activity_events in 30 days.

## Pipeline activity — THIN (the real finding)
- **Formal opportunities = 7** (5 `prospect` + 2 `government_buyer`). This is **by design** — the
  R5/R6 doctrine gates opportunity creation behind ownership-resolution + a connected contact, so
  most entities sit in the P0.4/P0.5 connect-work bands, not as opportunities. Not a bug, but the
  formal pipeline is near-empty.
- **Cadence outreach is dormant:** 751 cadences, 232 active, but **only 4 have EVER been touched** (3
  in 30 days). The outreach engine is built and data-ready (519 carry a contact) but isn't being
  worked.
- **Human outreach is sparse:** 30-day activity is **4,967 system + 3,226 copilot_action** vs **24
  calls + 17 emails + 66 notes**. So the ingest captures automated/system events at volume but very
  little human outreach — consistent with the OUTREACH#1 / NBT finding that Scott works outreach in
  Outlook/Salesforce and the SF-activity→cadence-advance loop only sees a thin, archival-limited
  slice of it.

## Bugs (separate tracks)
- **`prospect_leads.lead_source` NOT-NULL failures (gov)** — the live-only pg functions
  `propagate_deed_to_property` / `propagate_parcel_owner_to_property` insert leads without
  `lead_source` → **every insert fails → those prospects aren't created.** In the gov post-deploy
  hotfix prompt (patch the two functions). This directly suppresses pipeline inflow.
- SF sync 0.02% error rate is normal noise (worth a periodic glance, not a problem).

## Verdict
**Data quality is good** — SF sync is clean and high-volume, the entity graph is large and deduped,
activity ingest runs. **The gap is pipeline ACTIVATION, not data:** opportunities (7) and cadence
outreach (4 ever touched) are minimal because (a) opportunity creation is intentionally gated on
ownership-resolution/connection — most entities are still connect-work — and (b) the outreach loop
isn't being driven (Scott outreaches externally; only a thin slice flows back via SF activity). The
levers are the ones already in motion: the OUTREACH#1 / R10 / R20 cadence-advance work, contact
acquisition (R16/R20), and unblocking prospect inflow (fix the `prospect_leads` functions). The CRM
data is ready for the pipeline to fill once those activation levers run.
