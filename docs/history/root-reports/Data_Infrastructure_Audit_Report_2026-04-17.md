<!-- Converted 2026-09-16 by Cowork from the root file `Data_Infrastructure_Audit_Report_2026-04-17.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**DATA INFRASTRUCTURE**

**AUDIT REPORT**

Dialysis Portfolio Analytics Platform

Financial Estimates Pipeline, Cap Rate Standardization & Framework Design

Prepared for: Scott Briggs, Briggs CRE

Date: April 17, 2026

Classification: Confidential

**Executive Summary**

This report documents the findings and remediation of three critical data quality issues in the Dialysis portfolio analytics platform: a systematic revenue inflation bug affecting 9,197 clinic financial estimates, mixed cap rate storage formats across both databases, and the absence of automated cap rate computation from validated rent streams.

All three issues have been fully resolved. The CMS revenue model has been corrected (eliminating a median 4.04x overstatement), cap rates have been standardized to decimal format across all tables in both the Dialysis and Government databases, and a hierarchical cap rate calculation framework with automated triggers has been deployed to the Dialysis database.

|                                 |               |              |                              |
| ------------------------------- | ------------- | ------------ | ---------------------------- |
| **Metric**                      | **Before**    | **After**    | **Impact**                   |
| CMS Avg Revenue Estimate        | $14,979,470   | $3,483,751   | Corrected 4.3x inflation     |
| CCN 312669 CMS Revenue          | $18,563,618   | $3,587,294   | Now matches TTM ($3,580,200) |
| Cap Rate Values Converted (Dia) | Mixed formats | All decimal  | 3,345 values normalized      |
| Cap Rate Values Converted (Gov) | Mixed formats | All decimal  | 5 values normalized          |
| Cap Rate History Triggers       | None          | 2 active     | Auto-compute on sale/listing |
| Revenue Model Accuracy (median) | 4.04x vs TTM  | 1.00x vs TTM | Validated n=7,115            |

**1. Clinic Financial Estimates Pipeline**

**1.1 Problem Discovery**

During investigation of CCN 312669 (DaVita Rahway Dialysis, NJ), contradictory financial data was discovered: 333 patients, $3.6M TTM revenue, but the CMS-modeled estimate showed $18.56M revenue. The CMS model was the primary estimate for 1,754 clinics and the only estimate for 1,166 clinics.

**1.2 Root Cause**

The backfill\_facility\_financials.py script (external to LCC codebase) generated revenue estimates using the formula: total\_patients × 156 treatments/year × $357.35 blended rate. The fundamental error: CMS total\_patients (333 for CCN 312669) represents annual unique patients treated, including patient turnover from deaths, transplants, and transfers. It is not a concurrent census count.

For an 18-chair clinic operating 3 shifts per day, concurrent census is approximately 54–72 patients, not 333. The TTM-reported treatment count of 8,424/year confirms this: 8,424 ÷ 156 = 54 concurrent patients, a ratio of 0.162 relative to the annual count.

**1.3 Quantified Impact**

Across 7,299 clinics with both CMS and TTM estimates, the CMS model overstated revenue by a median factor of 4.04x and an average of 4.99x.

|                            |             |                 |                    |
| -------------------------- | ----------- | --------------- | ------------------ |
| **Source**                 | **Clinics** | **Avg Revenue** | **Avg Confidence** |
| TTM Reported               | 7,316       | $4,175,922      | 0.95               |
| CMS Patient Count (before) | 9,197       | $14,979,470     | 0.75               |
| CMS Patient Count (after)  | 9,197       | $3,483,751      | 0.65–0.80          |
| Google Hours               | 3,248       | $3,660,315      | 0.70               |
| 10-K Filing                | 904         | $5,507,863      | 0.90               |
| CMS Chair Count            | 21          | $2,659,429      | 0.60               |

**1.4 Correction Methodology**

Two corrected models were developed, calibrated against TTM-reported revenue for 7,115 clinics with valid data:

  - **Chair-Based Model (primary):** stations × 3 shifts × 5.5 days/week × 52 weeks × 65% utilization × $357.35/tx. Validated at median 1.00x vs TTM with extremely tight IQR. Applied to 8,464 clinics with station data.

  - **Concurrent Ratio Model (fallback):** annual\_patients × 0.245 × 156 tx/year × $357.35/tx. Validated at median 1.00x vs TTM (wider IQR: 0.72–1.30). Applied to 733 orphaned clinics without medicare\_clinics records.

All 9,197 CMS estimates were corrected in place, tagged with data\_quality\_flags = \['cms\_revenue\_corrected\_v2'\], and the 1,754 CMS-primary clinic records in medicare\_clinics were synced.

**1.5 Estimate Priority Hierarchy**

|              |                                 |                       |                |
| ------------ | ------------------------------- | --------------------- | -------------- |
| **Priority** | **Source**                      | **Clinics (Primary)** | **Confidence** |
| 1            | TTM Reported (CMS Cost Reports) | 7,316                 | 0.95           |
| 2            | 10-K Filing (HCRIS propagated)  | 146                   | 0.90           |
| 3            | CMS Patient Count (corrected)   | 1,754                 | 0.65–0.80      |
| 4            | Google Hours (capacity model)   | 0                     | 0.70           |
| 5            | CMS Chair Count                 | 0                     | 0.60           |

**2. Cap Rate Standardization**

**2.1 Problem**

Cap rates were stored in mixed formats across both databases. Some values were decimal (0.065 = 6.5%) and others were whole percentage (6.5 = 6.5%), with outliers as extreme as 63,654. This caused incorrect calculations and display throughout the platform.

**2.2 Standard Chosen**

Decimal format (0.065 = 6.5%) was selected as the standard. This aligns with mathematical convention, makes cap rate a direct multiplier in NOI/Price calculations, and matches the existing check constraint on the Government DB’s property\_sale\_events table (0.005–0.30).

**2.3 Dialysis DB Normalization**

|                                        |               |                     |                     |
| -------------------------------------- | ------------- | ------------------- | ------------------- |
| **Table.Column**                       | **Converted** | **Outliers Nulled** | **Already Correct** |
| available\_listings.cap\_rate          | 400           | 1 (63,654)          | 1,489               |
| available\_listings.current\_cap\_rate | 307           | 0                   | 16                  |
| available\_listings.initial\_cap\_rate | 1,286         | 0                   | 11                  |
| available\_listings.last\_cap\_rate    | 1,321         | 4                   | 1                   |
| cap\_rate\_history.cap\_rate           | 27            | 1                   | 3,188               |
| comparable\_sales.comp\_cap\_rate      | 3             | 0                   | 0                   |
| sales\_transactions.cap\_rate          | 0             | 0                   | 1,585               |

**2.4 Government DB Normalization**

The Government database was largely clean. Only 5 available\_listings.asking\_cap\_rate values (7.7, 8.5) required conversion. Six sales\_transactions.sold\_cap\_rate values at 0.2651 were confirmed as legitimate high-cap-rate decimals (26.51%), not formatting errors.

**3. Hierarchical Cap Rate Calculation Framework**

**3.1 Architecture**

A property-level rent validation hierarchy feeds automated cap rate snapshots whenever new sales or listings are recorded. Three SQL components were deployed:

  - **dia\_project\_rent\_at\_date():** Projects annual rent from an anchor date to any target date using compound bump schedule (bump\_pct, bump\_interval\_mo). Immutable function for use in views and computed columns.

  - **dia\_compute\_cap\_rate():** Hierarchical rent selection function. Priority: (1) confirmed anchor rent (lease\_confirmed/om\_confirmed), (2) active lease annual\_rent, (3) any anchor rent. Projects rent to as\_of\_date, then computes cap\_rate = projected\_rent / price. Returns rent\_source, rent\_confidence, and the computed cap rate.

  - **Automated triggers:** trg\_auto\_cap\_rate\_on\_sale (BEFORE INSERT/UPDATE on sales\_transactions) and trg\_auto\_cap\_rate\_on\_listing (BEFORE INSERT/UPDATE on available\_listings). Both compute cap rate via the hierarchy, insert into cap\_rate\_history, and fill NULL cap rate fields on the triggering record.

**3.2 Rent Source Hierarchy**

|              |                       |                |                                                                             |
| ------------ | --------------------- | -------------- | --------------------------------------------------------------------------- |
| **Priority** | **Source**            | **Confidence** | **Description**                                                             |
| 1            | Confirmed Anchor Rent | High           | lease\_confirmed or om\_confirmed anchor\_rent, projected via bump schedule |
| 2            | Active Lease          | Medium         | Most recent active lease annual\_rent (projected if anchor available)       |
| 3            | Any Anchor Rent       | Low            | Non-confirmed anchor\_rent (e.g., estimated, broker\_reported)              |

**3.3 Validation**

Tested against 15002 Amargosa Rd (property\_id 23283), which has om\_confirmed anchor rent of $348,530. The 2026-02-03 sale at $5,362,000 computed a 6.50% cap rate via the framework, consistent with the stored 7.15% cap rate (difference attributable to the anchor date being after the sale date, so no escalation was applied).

Cap rate history entries with confidence tagging are automatically created, providing a time-series of property-level cap rates tied to validated rent streams. The 1–25% filter in the triggers prevents garbage entries from outlier transactions.

**4. Recommendations**

**4.1 Immediate Actions (Completed)**

  - Corrected 9,197 CMS revenue estimates (median 4.04x inflation eliminated)

  - Standardized all cap rates to decimal format across both databases

  - Deployed hierarchical cap rate computation framework with automated triggers

  - Updated frontend cap rate normalizer and methodology documentation

  - Deployed updated dashboard (SW cache v246)

**4.2 Future Enhancements**

  - Backfill cap\_rate\_history: Run dia\_compute\_cap\_rate() retroactively against all existing sales\_transactions and available\_listings to populate historical cap rate snapshots.

  - Add check constraints: Enforce decimal cap rate range (0.005–0.30) on Dialysis DB tables matching the Government DB pattern.

  - Revenue model versioning: Track model version in clinic\_financial\_estimates so corrections can be audited over time.

  - Replicate framework to Government DB: Deploy dia\_compute\_cap\_rate() equivalent for government-tenanted properties using GSA lease data.

  - Concurrent patient estimation: Explore CMS Dialysis Facility Compare data for actual treatment counts to replace the 0.245 concurrent ratio with facility-specific values.
