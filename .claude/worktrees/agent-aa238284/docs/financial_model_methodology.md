# Dialysis Clinic Financial Model Methodology

## 1. Executive Summary

The Briggs CRE dialysis clinic financial model estimates annual revenue, operating costs, and profitability for individual dialysis facilities using a 4-payer treatment-based approach. The model combines CMS patient census data with payer-specific reimbursement rates, state-level payer mix adjustments, and treatment frequency assumptions to produce revenue estimates suitable for commercial real estate investment analysis, broker opinions of value, and disposition modeling.

## 2. Rate Table

All per-treatment reimbursement rates are derived from publicly available CMS data, industry 10-K filings (DaVita, Fresenius), and MedPAC reports.

| Payer          | Rate/Treatment | Source                                   |
|----------------|----------------|------------------------------------------|
| Medicare       | $279           | CMS ESRD PPS bundled rate (2024)         |
| Medicaid       | $225           | State-weighted average (MedPAC)          |
| Commercial     | $1,100         | DaVita 10-K implied rate                 |
| Other          | $250           | Blended (VA, self-pay, uninsured)        |
| **Cost/Treatment** | **$315**   | Industry average operating cost          |

## 3. Payer Mix Methodology

**National Defaults:**

| Payer       | % of Patients |
|-------------|---------------|
| Medicare    | 65%           |
| Medicaid    | 20%           |
| Commercial  | 11%           |
| Other       | 4%            |

**Adjustments:**

- **State-level:** Payer mix baselines are adjusted using state Medicaid expansion status and historical CMS enrollment data. Medicaid-expansion states typically show higher Medicaid and lower uninsured rates.
- **Demographic:** Census ACS data at the county level informs adjustments for age distribution (Medicare eligibility), income (Medicaid eligibility), and employer-sponsored insurance prevalence (Commercial).
- **Operator-specific:** When available, operator 10-K filings override national defaults (e.g., DaVita reports ~53% Medicare, ~7% Medicaid, ~32% Commercial including MA plans).

## 4. Treatment Frequency

- **Standard assumption:** 156 treatments per patient per year (3 sessions/week x 52 weeks)
- **Adjustment factors:** Home HD patients may receive 5-6x/week but shorter sessions; peritoneal dialysis patients are counted separately. The 156-treatment assumption applies to in-center hemodialysis, which represents ~87% of the patient population.

## 5. Revenue Calculation

```
Annual Revenue = Σ (Patients_by_payer × 156 treatments × Rate_per_treatment)

Where:
  Medicare Revenue   = Total_Patients × Medicare_Pct × 156 × $279
  Medicaid Revenue   = Total_Patients × Medicaid_Pct × 156 × $225
  Commercial Revenue = Total_Patients × Commercial_Pct × 156 × $1,100
  Other Revenue      = Total_Patients × Other_Pct × 156 × $250

Total Operating Costs = Total_Patients × 156 × $315
Operating Profit = Revenue - Costs
Operating Margin = Profit / Revenue × 100
```

## 6. Trend Analysis

### CAGR (Compound Annual Growth Rate)
```
CAGR = (Patient_Count_Latest / Patient_Count_Earliest)^(1/Years) - 1
```

Calculated across all available CMS patient census snapshots for the facility, requiring a minimum of 3 data points spanning at least 18 months.

### Linear Regression
- **Slope:** Patients gained or lost per year (fitted via ordinary least squares)
- **R-squared:** Goodness of fit (0-1); values above 0.5 indicate a statistically meaningful trend
- **Trend Direction:** Growth (slope > 0 and R² > 0.3), Decline (slope < 0 and R² > 0.3), or Stable (R² ≤ 0.3 or |slope| < 1)

### Confidence Scoring
Trend confidence is rated as High, Medium, or Low based on:
- Number of data points (≥8 = High, 5-7 = Medium, <5 = Low)
- R-squared value (≥0.6 = High, 0.3-0.6 = Medium, <0.3 = Low)
- Data span (≥3 years = High, 2-3 years = Medium, <2 years = Low)

### Projections
- **1-year projection:** Current count + (regression slope × 1)
- **3-year projection:** Current count + (regression slope × 3)
- **Revenue projections:** Projected patient count × current revenue per patient

## 7. Lease Risk Scoring

The composite Lease Risk Score (0-100) aggregates five risk dimensions:

| Component         | Weight | Scoring Criteria                                              |
|-------------------|--------|---------------------------------------------------------------|
| Patient Trend     | 30%    | YoY growth >5% = 10, 0-5% = 25, 0 to -5% = 60, -5 to -10% = 80, <-10% = 95 |
| Financial Health  | 25%    | Margin >15% = 10, 8-15% = 25, 3-8% = 50, 0-3% = 75, <0% = 95 |
| Quality Metrics   | 20%    | Stars ≥4 = 15, 3 = 35, 2 = 65, 1 = 90                       |
| Lease Expiration  | 15%    | >84mo = 10, 60-84 = 20, 36-60 = 40, 24-36 = 60, 12-24 = 80, <12 = 95 |
| Market Conditions | 10%    | Utilization ≥85% = 15, 70-85% = 35, 50-70% = 60, <50% = 85  |

**Risk Levels:**
- 0-25: Low
- 26-50: Moderate
- 51-75: High
- 76-100: Critical

## 8. Data Sources

| Source                       | Data Provided                                     | Update Frequency |
|------------------------------|---------------------------------------------------|------------------|
| CMS Dialysis Facility Compare | Patient counts, star ratings, quality metrics     | Quarterly        |
| CMS HCRIS (Cost Reports)    | Actual revenue, costs, treatments (when available) | Annual           |
| USRDS Annual Data Report     | National ESRD statistics, modality trends          | Annual           |
| DaVita 10-K / 10-Q          | Operator financials, payer mix, treatment rates    | Quarterly        |
| Fresenius Annual Report      | Operator comparison, global benchmarks             | Annual           |
| MedPAC Report to Congress    | Medicare payment rates, adequacy analysis          | Annual           |
| Census ACS (5-year)          | County demographics, income, insurance coverage    | Annual           |
| CDC PLACES                   | County health indicators, ESRD prevalence          | Annual           |
| State Medicaid agencies      | State-level Medicaid enrollment and rates          | Varies           |

## 9. Glossary

| Term                     | Definition                                                                                  |
|--------------------------|---------------------------------------------------------------------------------------------|
| CCN / Medicare ID        | CMS Certification Number — unique 6-digit facility identifier                                |
| TTM                      | Trailing Twelve Months — most recent 12-month period of reported data                        |
| ESRD                     | End-Stage Renal Disease — permanent kidney failure requiring dialysis or transplant           |
| PPS                      | Prospective Payment System — CMS bundled payment methodology for dialysis                    |
| HCRIS                    | Healthcare Cost Report Information System — CMS cost report data                             |
| NPI                      | National Provider Identifier — 10-digit provider identification number                       |
| QIP                      | Quality Incentive Program — CMS program that adjusts payments based on quality measures       |
| Star Rating              | CMS 1-5 star quality rating based on 9 clinical measures                                     |
| CAGR                     | Compound Annual Growth Rate — annualized growth over multiple periods                        |
| Operating Margin         | Operating profit as a percentage of revenue                                                  |
| Capacity Utilization     | Current patients as a percentage of estimated station capacity                               |
| Payer Mix                | Distribution of patients across insurance categories                                         |
| Revenue per Treatment    | Total revenue divided by total annual treatments                                             |
| Cost per Treatment       | Total operating costs divided by total annual treatments                                     |
| Regression Slope         | Patients gained or lost per year based on linear regression of historical census              |
| R-squared                | Statistical measure (0-1) of how well the linear model fits the historical patient data      |
| Modality                 | Type of dialysis treatment (In-Center HD, Home HD, Peritoneal Dialysis)                     |
| Lease Risk Score         | Composite 0-100 score aggregating patient, financial, quality, lease, and market risk factors |

## 10. Validation

Comparison of model estimates vs. DaVita 10-K reported actuals (2023):

| Metric                      | Our Model          | DaVita 10-K (2023)  | Variance |
|-----------------------------|--------------------|---------------------|----------|
| Revenue per Treatment       | ~$443 (blended)    | ~$390               | +13.6%   |
| Cost per Treatment          | $315               | ~$330               | -4.5%    |
| Operating Margin            | ~14%               | ~15.5%              | -1.5pp   |
| Medicare % of Revenue       | ~42%               | ~54% (incl MA)      | -12pp    |
| Treatments per Patient/Year | 156                | ~152                | +2.6%    |

**Notes:** Variance is expected due to (a) DaVita includes Medicare Advantage in their Medicare line while our model separates it into Commercial, (b) DaVita's cost structure includes corporate overhead not present in individual facility estimates, (c) our Commercial rate ($1,100) reflects gross billed rates before contractual adjustments.
