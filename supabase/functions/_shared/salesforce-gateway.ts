// ============================================================================
// salesforce-gateway — read-only SOQL via the "HTTP Switch Salesforce Lookup"
// Power Automate flow. Life Command Center — SF-DIRECT-b (2026-09-09)
//
// WHY: SF-DIRECT (salesforce-soap.ts) proved the direct-SOAP path works end
// to end and then was refused at the org's door with INVALID_SSO_GATEWAY_URL
// — the integration user's Salesforce profile is under corporate SSO
// (delegated auth), so password API login needs a Salesforce-admin change
// nobody has requested yet. The PA flow already authenticates successfully
// under that same SSO (its Salesforce connector runs as Scott's signed-in
// session), so this is the sanctioned fallback: same gateway `api/_shared/
// salesforce.js` already uses from Node/Railway, reachable now from Deno
// edge functions too, with one new generic `soql` operation the flow's
// `soql` Switch case executes.
//
// Contract mirrors api/_shared/salesforce.js::callSfLookupFlow exactly —
// same ok/reason/detail shapes, same pickFlowMessage coercion — so a caller
// reading either surface's error never has to learn a second vocabulary.
// See docs/architecture/flows/http-switch-salesforce-lookup.md
// "soql operation (SF-DIRECT-b, 2026-09-09)" for the flow-side spec this
// helper is written against.
//
// NEVER log or return the webhook URL (it carries a `?sig=...` signature —
// treat the whole URL as a secret) or SELECT more than what the caller's
// own soql text describes. This helper does not add SOQL injection
// protection beyond the SELECT-only guard below — it trusts the caller
// already built a safe query, exactly as the flow's own guards do.
// ============================================================================

const DEFAULT_MAX_ROWS = 200;
const HARD_MAX_ROWS = 500;
const REQUEST_TIMEOUT_MS = 20000;

export interface SfGatewayQueryResult {
  ok: true;
  operation: "soql";
  total_size: number;
  done: boolean;
  records: Record<string, unknown>[];
}

export type SfGatewayErrorReason =
  | "gateway_not_configured"
  | "soql_rejected"
  | "flow_unreachable"
  | "flow_http_error"
  | "flow_reported_failure";

/**
 * Thrown on any gateway failure. `reason` is one of the enumerated codes
 * above; `detail` is a short, human-readable string (never the webhook URL,
 * never a raw record body beyond what the flow itself echoed back).
 */
export class SfGatewayError extends Error {
  reason: SfGatewayErrorReason;
  status?: number;
  detail?: string | null;
  constructor(reason: SfGatewayErrorReason, message: string, opts: { status?: number; detail?: string | null } = {}) {
    super(message);
    this.name = "SfGatewayError";
    this.reason = reason;
    this.status = opts.status;
    this.detail = opts.detail ?? null;
  }
}

/**
 * Coerce a flow-error value of ANY shape to a human-readable string. Mirrors
 * api/_shared/salesforce.js::pickFlowMessage exactly — a Power Automate /
 * Salesforce-connector non-2xx body commonly arrives as `{error:{message}}`,
 * `{message}`, or an array of `{message}`; calling `.slice` on those objects
 * throws before the real error is ever seen if this coercion is skipped.
 */
export function pickFlowMessage(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? pickFlowMessage(v[0]) : "";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const msg = o.message ?? o.error_description ?? o.errorMessage;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return "";
}

function clampMaxRows(n: number | undefined): number {
  if (!Number.isFinite(n) || (n as number) <= 0) return DEFAULT_MAX_ROWS;
  return Math.min(Math.floor(n as number), HARD_MAX_ROWS);
}

/**
 * Client-side pre-check mirroring the flow's own guard (never the sole line
 * of defense — the flow rejects independently — but failing fast here saves
 * a round trip and keeps the error shape consistent for a caller that never
 * reaches the network).
 */
function assertSelectOnly(soql: string): void {
  const trimmed = soql.trim();
  if (!/^select\b/i.test(trimmed)) {
    throw new SfGatewayError("soql_rejected", "soql must be a SELECT statement.");
  }
  if (trimmed.includes(";")) {
    throw new SfGatewayError("soql_rejected", "soql must not contain a ';' character.");
  }
}

/**
 * Run a read-only SOQL query through the PA gateway flow's `soql` operation.
 * Never throws on a flow-reported failure below the network layer — those
 * are raised as SfGatewayError with the flow's own reason/detail so callers
 * can branch on `err.reason` exactly as they would on the Node-side helper's
 * `{ok:false, reason, detail}` return shape.
 *
 * @param soql A single SELECT statement. No trailing ';'.
 * @param opts.maxRows Clamped server-side to [1,500]; default 200.
 */
export async function sfGatewayQuery(
  soql: string,
  opts: { maxRows?: number } = {},
): Promise<SfGatewayQueryResult> {
  const url = Deno.env.get("SF_LOOKUP_WEBHOOK_URL");
  if (!url) {
    throw new SfGatewayError("gateway_not_configured", "SF_LOOKUP_WEBHOOK_URL is not configured.");
  }
  const trimmedSoql = String(soql || "").trim();
  if (!trimmedSoql) {
    throw new SfGatewayError("soql_rejected", "soql is required.");
  }
  assertSelectOnly(trimmedSoql);
  const maxRows = clampMaxRows(opts.maxRows);

  const body = { operation: "soql", soql: trimmedSoql, max_rows: maxRows, schema_version: 1 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new SfGatewayError("flow_unreachable", "Could not reach the Salesforce lookup gateway.", {
      detail: String((e as Error)?.message || e).slice(0, 300),
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    // keep json null; fall through to the http-error / reported-failure paths below
  }

  if (!res.ok) {
    const detailRaw =
      pickFlowMessage(json?.error) ||
      pickFlowMessage(json?.detail) ||
      (typeof text === "string" ? text : "") ||
      "";
    throw new SfGatewayError("flow_http_error", `Salesforce lookup gateway returned HTTP ${res.status}.`, {
      status: res.status,
      detail: String(detailRaw).slice(0, 500),
    });
  }

  if (!json || json.ok !== true) {
    const detailRaw = pickFlowMessage(json?.detail) || pickFlowMessage(json?.error) || "";
    const reason = (json?.reason as SfGatewayErrorReason) || "flow_reported_failure";
    throw new SfGatewayError(reason, "Salesforce lookup gateway reported failure.", {
      detail: detailRaw ? String(detailRaw).slice(0, 500) : null,
    });
  }

  const records = Array.isArray(json.records) ? (json.records as Record<string, unknown>[]) : [];
  return {
    ok: true,
    operation: "soql",
    total_size: typeof json.total_size === "number" ? json.total_size : records.length,
    done: json.done !== false,
    records: records.slice(0, maxRows),
  };
}
