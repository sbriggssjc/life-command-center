// ============================================================================
// sf-config.ts — Salesforce object mapping + routing for intake-salesforce
// Life Command Center
//
// Ports the describe-driven mapping from DialysisProject/src/sf_object_sync.py:
// raw_row keeps the entire Salesforce record, and a small set of "parsed"
// columns are mapped via candidate-name lists so this works before the
// managed-package API field names are 100% confirmed.
// ============================================================================

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
      property_name: ["Name"],
      property_type: ["Property_Type__c", "Type__c"],
      property_subtype: ["Property_Subtype__c", "Subtype__c", "Specific_Use__c"],
      tenancy: ["Tenancy__c"],
      street: ["Street__c", "Address__c", "Property_Street__c", "BillingStreet"],
      city: ["City__c", "Property_City__c", "BillingCity"],
      state: ["State__c", "Property_State__c", "BillingState"],
      zip_code: ["Zip__c", "Zip_Code__c", "Postal_Code__c", "BillingPostalCode"],
      building_sf: ["Building_SF__c", "Building_Size__c", "Total_Building_SF__c"],
      year_built: ["Year_Built__c"],
      owner_company_name: ["Owner_Company_Name__c", "Account_Name__c"],
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
      comp_name: ["Name"],
      comp_type: ["Comp_Type__c", "Type__c"],
      status: ["Status__c"],
      tenant: ["Tenant__c", "Tenant_Name__c"],
      street: ["Street__c", "Address__c"],
      city: ["City__c"],
      state: ["State__c"],
      zip_code: ["Zip__c", "Zip_Code__c"],
      sold_price: ["Sold_Price__c", "Sale_Price__c"],
      sold_date: ["Sold_Date__c", "Sale_Date__c"],
      listing_price: ["Listing_Price__c", "List_Price__c"],
    },
  },
  listing: {
    stagingTable: "sf_listing_staging",
    sfIdColumn: "sf_listing_id",
    parents: {
      sf_property_id: ["Property__c", "Related_Property__c"],
      sf_deal_id: ["Deal__c", "Related_Deal__c"],
    },
    parsed: {
      listing_name: ["Name"],
      record_type: ["RecordType.Name", "Record_Type__c"],
      listing_status: ["Listing_Status__c", "Status__c"],
      marketing_status: ["Marketing_Status__c"],
      listing_price: ["Listing_Price__c", "List_Price__c"],
      first_broadcast_date: ["First_Broadcast_Date__c", "Broadcast_Date__c"],
    },
  },
  deal: {
    stagingTable: "sf_deal_staging",
    sfIdColumn: "sf_deal_id",
    parents: {
      sf_property_id: ["Property__c", "Related_Property__c"],
    },
    parsed: {
      deal_name: ["Name"],
      deal_type: ["Deal_Type__c", "Type__c"],
      stage: ["Stage__c", "StageName"],
      expected_close_date: ["Expected_Close_Date__c", "CloseDate"],
      listing_price: ["Listing_Price__c", "List_Price__c"],
      seller_company_name: ["Seller_Company__c", "Seller__c"],
      buyer_company_name: ["Buyer_Company__c", "Buyer__c"],
    },
  },
};

const INT_COLS = new Set(["building_sf", "year_built"]);
const NUM_COLS = new Set(["sold_price", "listing_price"]);

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
const GOV_SIGNALS = ["gsa", "federal", "government", "u.s.", "department of", "veterans", "social security"];

export function routeVertical(row: Record<string, unknown>): { vertical: Vertical; resolved: boolean } {
  const hay = [
    row["property_type"], row["property_subtype"], row["tenant"],
    row["property_name"], row["comp_name"], row["listing_name"], row["deal_name"],
  ].filter((v) => v).join(" ").toLowerCase();

  if (DIA_SIGNALS.some((s) => hay.includes(s))) return { vertical: "dia", resolved: true };
  if (GOV_SIGNALS.some((s) => hay.includes(s))) return { vertical: "gov", resolved: true };
  return { vertical: "dia", resolved: false }; // default + review flag
}
