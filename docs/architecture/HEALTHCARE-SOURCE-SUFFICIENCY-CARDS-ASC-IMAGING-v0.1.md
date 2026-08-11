# Healthcare Source-Sufficiency Cards: ASC and Diagnostic Imaging v0.1

Status: design recommendation; no production source acquisition or ingestion authorized.

## Decision

Evaluate ambulatory surgery centers (ASCs) before diagnostic imaging as the next comparative swim lane. ASCs
have the stronger official facility spine and cleaner facility-level reimbursement identity. Imaging must be
split into fixed-site independent diagnostic testing facilities (IDTFs) and hospital/physician-office imaging;
mobile suppliers and minority-suite physician practices cannot qualify the core real-estate lane.

Neither lane is presumed viable. Each must pass the same observed 50-property brokerage gates adopted for
oncology/infusion: single-tenant or 50%+ dominant-user form, third-party landlord addressability, facility-level
economics modelability, and reasonable research cost.

## Ambulatory surgery centers

| Evidence need | Proposed source | Use and limitation |
|---|---|---|
| Facility identity and certification | CMS Provider of Services/iQIES ASC file | National facility spine; reconcile certification number, operator, address, and status. |
| Current quality participation | CMS ASC Quality Reporting facility data | Operating/reporting corroboration; non-reporting alone does not prove closure. |
| Enrollment and ownership signals | Medicare FFS Public Provider Enrollment | Resolve organization, location, enrollment and disclosed ownership; enrollment owner is not necessarily fee owner. |
| Volume and payment economics | CMS claims/utilization products and ASC payment files | Model procedure mix, Medicare volume, allowed amount and reimbursement sensitivity; Medicare is not total revenue. |
| Current services | Official operator page and state license registry | Required address-matched current-service corroboration. |
| Real estate and landlord | LCC owner graph, assessor/deed, lease and OM evidence | Independently classify building form and resolve true fee owner/landlord. |

Initial hypothesis: ASCs should outperform oncology/infusion on facility identity, capital intensity and
procedure-level economics. The unresolved question is property form because many ASCs occupy MOB or campus
space. The sample must measure freestanding STNL/dominant-user prevalence rather than infer it from the label.

Economics: cases by procedure family × payer-specific net reimbursement, plus evidenced ancillary revenue;
subtract labor, supplies/implants, anesthesia/management arrangements, occupancy and corporate allocation.
Emit low/base/high revenue, contribution profit, EBITDA, occupancy-cost ratio and EBITDAR/rent coverage with
lineage, confidence and conflict suppression.

## Diagnostic imaging

| Evidence need | Proposed source | Use and limitation |
|---|---|---|
| Fixed-site supplier identity | Medicare FFS Public Provider Enrollment restricted to IDTF/relevant enrollment types | Discovery spine; separate fixed sites from mobile, physician-office and hospital imaging. |
| Facility/service corroboration | Official operator page, accreditation, and state equipment/radiation registries | Confirm modality, fixed address, operation and equipment; coverage varies by state. |
| Utilization and reimbursement | CMS physician/supplier utilization and PFS technical-component data | Model Medicare modality/code volume and technical economics; professional billing and total payer mix stay separate. |
| Ownership and real estate | LCC owner graph, assessor/deed, lease and OM evidence | Resolve operator, fee owner, landlord, tenant share and building form. |

Initial hypothesis: MRI, CT and PET have strong capital/location stickiness, but imaging's discovery universe is
noisier. IDTF status does not guarantee a freestanding building. Fixed-site status, modality mix and building
control are mandatory gates.

Economics: scans by modality/code × technical-component net reimbursement, adjusted for payer mix, utilization,
hours, capacity and downtime; subtract labor, contrast/supplies, equipment lease/depreciation/service, occupancy,
reading arrangements where borne and overhead. Suppress EBITDA or rent coverage when professional and technical
revenue cannot be reconciled.

## Comparative execution

1. Freeze the reusable Phase A receipt and acceptance contract.
2. Define ASC and fixed-site IDTF manifests without downloading data.
3. After explicit authorization, run aggregate source-sufficiency profiles.
4. Draw separate 50-property samples using the identical clinical/property/owner/economics scorecard.
5. Compare observed STNL/dominant-user share, third-party landlords, economics coverage, transaction inventory,
   and research minutes per qualified property.
6. Advance only lanes that pass the hard brokerage gates; retain failed lanes as enrichment categories.

## LCC boundary

Discovery stays in private `healthcare_discovery`. Existing LCC property, organization, canonical-person,
ownership, comp, dossier and Salesforce-promotion contracts remain authoritative. Specialty adapters may propose
evidence and mappings but cannot create duplicate core entities or write Salesforce before promotion gates pass.

Detailed next-stage contracts:

- `HEALTHCARE-ASC-IDTF-SOURCE-MANIFEST-CONTRACTS-v0.1.md`
- `HEALTHCARE-ASC-IDTF-LCC-INTEGRATION-CONTRACT-v0.1.md`
- `HEALTHCARE-ASC-IDTF-ECONOMICS-AND-SAMPLING-v0.1.md`

## Official sources reviewed

- CMS Provider Data Catalog ASC facility and quality-reporting datasets.
- CMS Provider of Services/iQIES facility file.
- CMS Medicare FFS Public Provider Enrollment data dictionary and provider-type glossary.
- CMS IDTF enrollment and Medicare Program Integrity guidance.
- CMS Physician Fee Schedule technical/professional component framework.
- Supabase Data API security guidance; discovery remains non-exposed and least-privilege.
