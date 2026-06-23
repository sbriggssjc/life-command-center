// ============================================================================
// sf-config.ts — Salesforce object mapping + routing for intake-salesforce
// Life Command Center
//
// Ports the describe-driven mapping from DialysisProject/src/sf_object_sync.py:
// raw_row keeps the entire Salesforce record, and a small set of "parsed"
// columns are mapped via candidate-name lists so this works before the
// managed-package API field names are 100% confirmed.
// ============================================================================

import { GOV_STATE_SIGNALS } from "../_shared/sf-deal-promotion.ts";

export type Vertical = "dia" | "gov" | "ops";

export interface ObjectDef {
  stagingTable: string;
  sfIdColumn: string;
  parents: Record<string, string[]>;   // staging col -> candidate SF lookup fields
  parsed: Record<string, string[]>;    // staging col -> candidate SF field names
}

// Logical object key -> mapping definition. Keyed by logical name; the POST
// body's object_type is resolved to one of these by resolveObjectKey().
export const OBJECT_CONFIG: Record<string, ObjectDef> = {
  property: {
    stagingTable: "sf_property_staging",
    sfIdColumn: "sf_property_id",
    parents: {
      sf_owner_company_id: ["Owner_Company__c", "Account__c", "AccountId", "Company__c"],
    },
    parsed: {
      // Confirmed against NorthMarq Property__c (a068W00000Fb9eAQAR, 2026-05-15);
      // confirmed API names are listed first, legacy guesses kept as fallbacks.
      property_name: ["Name"],
      property_type: ["Property_Type__c", "Type__c"],
      property_subtype: ["Property_Sub_Type__c", "Property_Subtype__c", "Subtype__c", "Specific_Use__c"],
      tenancy: ["Tenancy__c"],
      street: ["Street__c", "Address__c", "Property_Street__c", "BillingStreet"],
      city: ["City__c", "Property_City__c", "BillingCity"],
      state: ["State_Province__c", "State__c", "Property_State__c", "BillingState"],
      zip_code: ["Zip_Code__c", "Zip__c", "Postal_Code__c", "BillingPostalCode"],
      building_sf: ["Total_Building_SF2__c", "Total_Rentable_Sq_Ft__c", "Rentable_Square_Footage__c", "Building_SF__c", "Building_Size__c", "Total_Building_SF__c"],
      year_built: ["Year_Built__c"],
      owner_company_name: ["Owner_Company_Name__c", "Account_Name__c"],
      // ── Underwriting fields (added 2026-05-15 after Tucson test) ──────────
      noi: ["NOI__c", "Net_Operating_Income__c"],
      last_cap_rate: ["Last_Cap_Rate__c", "Cap_Rate__c"],
      annual_rent: ["Annual_Rent__c", "Annualized_Rent__c"],
      tenant_names: ["Tenant_Names__c", "Tenant_Name__c"],
      land_size_acres: ["Land_Size_Acres__c", "Lot_Size_Acres__c", "Acres__c"],
      last_sold_price: ["Last_Sold_Price__c", "Sale_Price__c"],
      last_sold_date: ["Last_Sold_Date__c", "Sale_Date__c"],
      lease_term_remaining: ["Lease_Term_Remaining__c", "Remaining_Term__c"],
      market_type: ["Market_Type__c", "Market_Tier__c"],
      county: ["County__c"],
      metro_name: ["Metro_Name__c", "MSA__c"],
      property_region: ["Property_Region__c", "Region__c"],
      building_class: ["Building_Class__c", "Class__c"],
      year_refurbished: ["Year_Refurbished__c", "Year_Renovated__c"],
      number_of_buildings: ["Number_of_Buildings__c"],
      number_of_floors: ["Number_of_Floors__c", "Stories__c"],
      parking_spaces: ["Parking_Spaces__c"],
    },
  },
  comp: {
    stagingTable: "sf_comp_staging",
    sfIdColumn: "sf_comp_id",
    parents: {
      sf_property_id: ["Property__c", "Related_Property__c"],
      sf_deal_id: ["Deal__c", "Related_Deal__c"],
      sf_listing_id: ["Listing__c", "Related_Listing__c"],
    },
    parsed: {
      // Confirmed against NorthMarq Comp__c (a1Y8W000004JrP3UAK, 2026-05-15).
      comp_name: ["Name"],
      comp_type: ["Comp_Type__c", "Type__c"],
      status: ["Status__c"],
      tenant: ["Tenant_Name2__c", "Related_Tenants__c", "Tenant__c", "Tenant_Name__c"],
      street: ["Street__c", "Address__c", "Address_Formula__c"],
      city: ["City__c"],
      state: ["State__c"],
      zip_code: ["Postal_Code__c", "Zip__c", "Zip_Code__c"],
      sold_price: ["Comp_Price__c", "Price_Formula__c", "Price__c", "Sale_Price_w_Assumptions__c", "Sold_Price__c", "Sale_Price__c"],
      sold_date: ["Sold_Date__c", "Sale_Date__c"],
      listing_price: ["Listing_Price__c", "List_Price__c"],
      // ── Underwriting additions (added 2026-05-15) ─────────────────────────
      cap_rate: ["Cap_Rate__c", "Comp_Cap_Rate__c", "Cap_Rate_Formula__c"],
      comp_ltr: ["Comp_LTR__c", "Term_Remaining_At_Sale__c"],
      term_remaining: ["Term_Remaining__c"],
      annual_rent: ["Annual_Rent__c"],
      building_sf: ["Building_SF__c", "Total_Building_SF__c"],
      year_built: ["Year_Built__c", "Year_Built_Date__c"],
      year_renovated: ["Year_Renovated__c"],
      land_acres: ["Land_Acres__c"],
      days_on_market: ["Days_on_Market__c"],
      lease_expiration: ["Lease_Expiration__c"],
      lease_term_years: ["Lease_Term_years__c"],
      price_sf: ["Price_SF__c"],
      property_type: ["Property_Type__c"],
      primary_use: ["Primary_Use__c"],
      market_type: ["Market_Type__c"],
    },
  },
  listing: {
    stagingTable: "sf_listing_staging",
    sfIdColumn: "sf_listing_id",
    parents: {
      sf_property_id: ["Property__c", "Related_Property__c", "Property2__c"],
      sf_deal_id: ["Deal__c", "Related_Deal__c"],
    },
    parsed: {
      // Confirmed against NorthMarq Listing__c (a0j1I00000DobXmQAJ, 2026-05-15).
      // Heavy use of _sjc__c suffix (Stan Johnson Company legacy package).
      listing_name: ["Name"],
      record_type: ["Deal_Record_Type_sjc__c", "RecordType.Name", "Record_Type__c"],
      listing_status: ["Deal_Status__c", "Listing_Status__c", "Status__c"],
      marketing_status: ["Marketing_Status_sjc__c", "Marketing_Status__c"],
      listing_price: ["Asking_List_Price2_sjc__c", "Notable_Transaction_Price_sjc__c", "Listing_Price__c", "List_Price__c"],
      first_broadcast_date: ["RCM_First_Broadcast_Date__c", "First_Broadcast_Date__c", "Broadcast_Date__c"],
      // ── Underwriting additions (added 2026-05-15) ─────────────────────────
      asking_list_price: ["Asking_List_Price2_sjc__c", "Notable_Transaction_Price_sjc__c"],
      marketing_cap_rate: ["Marketing_Cap_Rate2_sjc__c", "Targeted_Cap_Rate_sjc__c"],
      time_on_market_days: ["Time_on_Market_Days_sjc__c"],
      listing_expiration_date: ["Listing_Expiration_Date_sjc__c"],
      lease_expiration: ["Lease_Expiration_sjc__c"],
      property_address: ["Property_Address__c"],
      property_subtype: ["Property_Subtype__c"],
      building_sf: ["Building_SF_sjc__c"],
      year_built: ["Year_Built__c"],
      noi: ["NOI_sjc__c"],
    },
  },
  deal: {
    stagingTable: "sf_deal_staging",
    sfIdColumn: "sf_deal_id",
    parents: {
      sf_property_id: ["Property2__c", "Property__c", "Related_Property__c"],
    },
    parsed: {
      // Confirmed against NorthMarq Opportunity (0068W00000jee5VQAQ, 2026-05-15).
      // Standard SObject (not Deal__c); custom fields use _sjc__c suffix.
      deal_name: ["Name"],
      deal_type: ["Deal_Type_formula__c", "Category_sjc__c", "Business_Line__c", "Deal_Type__c", "Type__c"],
      stage: ["StageName", "Stage__c"],
      expected_close_date: ["CloseDate", "Expected_Close_Date__c"],
      listing_price: ["Listing_Price__c", "Asking_List_Price_sjc__c", "List_Price__c"],
      seller_company_name: ["Seller_Company__c", "Seller__c"],
      buyer_company_name: ["Buyer_Company__c", "Buyer__c"],
      // ── Underwriting additions (added 2026-05-15) ─────────────────────────
      noi: ["NOI_sjc__c"],
      deal_cap_rate: ["Deal_Cap_Rate__c", "CapRate_sjc__c", "Marketing_Cap_Rate_sjc__c", "Target_Actual_Cap_Rate_sjc__c"],
      annual_rent: ["Annual_Gross_Rent_sjc__c"],
      deal_price: ["Deal_Price__c", "Sale_Price_Report_sjc__c", "Est_Transaction_Price__c"],
      property_type: ["Property_Type__c"],
      property_subtype: ["Property_Type_Sub_Type__c", "Property_Type_Subtype__c"],
      property_city: ["Property_City__c", "City_sjc__c"],
      property_state: ["Property_State__c", "State_sjc__c"],
      property_address: ["Address_sjc__c", "Property_Address_Line_1__c"],
      property_postal_code: ["Postal_Code_sjc__c"],
      property_region: ["Property_Region_sjc__c"],
      building_sf: ["Building_Size_SF_sjc__c"],
      year_built: ["Year_Built_sjc__c"],
      tenant_names: ["Tenant_Names_sjc__c"],
      lease_term_remaining: ["Lease_Term_Remaining_sjc__c"],
    },
  },
};

const INT_COLS = new Set([
  "building_sf", "year_built", "year_refurbished", "year_renovated",
  "number_of_buildings", "number_of_floors", "parking_spaces",
  "days_on_market", "time_on_market_days",
]);
const NUM_COLS = new Set([
  "sold_price", "listing_price",
  // property
  "noi", "last_cap_rate", "annual_rent", "land_size_acres",
  "last_sold_price", "lease_term_remaining",
  // comp / listing / deal
  "cap_rate", "comp_ltr", "term_remaining", "land_acres", "lease_term_years",
  "price_sf", "asking_list_price", "marketing_cap_rate", "deal_cap_rate",
  "deal_price",
]);

// ── object-type resolution ──────────────────────────────────────────────────
// Power Automate may send a logical key ("comp") or the SObject API name
// ("Comp__c"). Resolve case-insensitively so this survives O-2 (unconfirmed
// managed-package API names).
export function resolveObjectKey(objectType: string): string | null {
  const t = (objectType || "").toLowerCase();
  if (OBJECT_CONFIG[t]) return t;
  if (t.includes("propert")) return "property";
  if (t.includes("listing")) return "listing";
  if (t.includes("deal") || t.includes("opportunit")) return "deal";
  if (t.includes("comp")) return "comp";
  return null;
}

// ── value helpers ───────────────────────────────────────────────────────────
function pick(record: Record<string, unknown>, candidates: string[]): unknown {
  for (const name of candidates) {
    if (name.includes(".")) {
      const [top, sub] = name.split(".", 2);
      const obj = record[top];
      if (obj && typeof obj === "object") {
        const v = (obj as Record<string, unknown>)[sub];
        if (v !== null && v !== undefined && v !== "") return v;
      }
    } else {
      const v = record[name];
      if (v !== null && v !== undefined && v !== "") return v;
    }
  }
  return null;
}

// Drop Salesforce's `attributes` envelope, top-level and nested.
export function cleanRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === "attributes") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested: Record<string, unknown> = {};
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (sk !== "attributes") nested[sk] = sv;
      }
      out[k] = nested;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function coerceInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function coerceNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeAddress(s: string | null | undefined): string | null {
  if (!s) return null;
  const norm = String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return norm || null;
}

// Stable SHA-256 of the mapped business fields — lets a later crawl skip
// unchanged records (mirrors sf_object_sync.py's payload_hash).
export async function payloadHash(mapped: Record<string, unknown>): Promise<string> {
  const sorted = Object.keys(mapped).sort().reduce((acc, k) => {
    acc[k] = mapped[k] ?? null;
    return acc;
  }, {} as Record<string, unknown>);
  const data = new TextEncoder().encode(JSON.stringify(sorted));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── record mapping ──────────────────────────────────────────────────────────
export interface MappedRecord {
  row: Record<string, unknown>;   // staging-row partial (parsed + parent + raw_row + hash)
  raw: Record<string, unknown>;   // cleaned full SF record
  sfId: string | null;
}

export async function mapRecord(objectKey: string, record: Record<string, unknown>): Promise<MappedRecord> {
  const cfg = OBJECT_CONFIG[objectKey];
  const raw = cleanRecord(record);
  const row: Record<string, unknown> = {
    [cfg.sfIdColumn]: raw["Id"] ?? null,
    sf_last_modified: raw["LastModifiedDate"] ?? null,
    raw_row: raw,
  };

  for (const [col, candidates] of Object.entries(cfg.parents)) {
    row[col] = pick(raw, candidates);
  }

  const parsedForHash: Record<string, unknown> = {};
  for (const [col, candidates] of Object.entries(cfg.parsed)) {
    let val = pick(raw, candidates);
    if (INT_COLS.has(col)) val = coerceInt(val);
    else if (NUM_COLS.has(col)) val = coerceNum(val);
    row[col] = val ?? null;
    parsedForHash[col] = row[col];
  }

  if (["street", "city", "state", "zip_code"].some((c) => c in cfg.parsed)) {
    const parts = [row["street"], row["city"], row["state"], row["zip_code"]]
      .filter((p) => p).join(" ");
    row["normalized_address"] = normalizeAddress(parts);
  }

  const hashInput = { ...parsedForHash };
  for (const col of Object.keys(cfg.parents)) hashInput[col] = row[col] ?? null;
  row["payload_hash"] = await payloadHash(hashInput);

  return { row, raw, sfId: (raw["Id"] as string) ?? null };
}

// ── vertical routing ────────────────────────────────────────────────────────
// Decide which domain database a record belongs to. Property/Comp/Listing/Deal
// must land in a vertical with sf_*_staging tables (dia or gov). A record with
// no clear signal defaults to "dia" and is flagged review on the staging row.
const DIA_SIGNALS = ["dialysis", "davita", "fresenius", "renal", "kidney", "clinic", "nephrology"];
// Federal cues + state-government cues (Topic 3, mirrors sidebar-pipeline.js
// GOV_TENANT_PATTERNS). GOV_STATE_SIGNALS is the single source of truth for the
// state cues, shared with the sf-promotion-worker.
const GOV_SIGNALS = [
  "gsa", "federal", "government", "u.s.", "veterans", "social security",
  ...GOV_STATE_SIGNALS,
];

export function routeVertical(row: Record<string, unknown>): { vertical: Vertical; resolved: boolean } {
  const hay = [
    row["property_type"], row["property_subtype"], row["tenant"], row["tenant_names"],
    row["property_name"], row["comp_name"], row["listing_name"], row["deal_name"],
  ].filter((v) => v).join(" ").toLowerCase();

  // dia (operator cue) wins first so a dialysis deal never trips a gov state
  // cue; only then check federal/state-government cues.
  if (DIA_SIGNALS.some((s) => hay.includes(s))) return { vertical: "dia", resolved: true };
  if (GOV_SIGNALS.some((s) => hay.includes(s))) return { vertical: "gov", resolved: true };
  return { vertical: "dia", resolved: false }; // default + review flag
}
