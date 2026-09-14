// ============================================================================
// salesforce-soap — direct SOAP login + REST SOQL query against Salesforce
// Life Command Center — SF-DIRECT (2026-09-09)
//
// Rebuilds the capability the deleted `sf-test` edge function proved: logging
// into Salesforce over the SOAP `login` API with username/password+token (no
// Connected App — Scott has no admin rights to register one, see C1 in
// CLAUDE.md) and then using the returned session id as a Bearer token against
// the REST Query API. This is the only path in the system that reaches
// Salesforce directly from an edge function, with no Power Automate hop.
//
// NEVER log SF_PASSWORD, SF_SECURITY_TOKEN, or a live sessionId. Error
// messages carry only the SOAP fault CODE, never the fault string verbatim
// (a fault string can echo back submitted input) and never the envelope.
// ============================================================================

const DEFAULT_API_VERSION = "61.0";

function apiVersion(): string {
  return Deno.env.get("SF_API_VERSION") || DEFAULT_API_VERSION;
}

function loginHost(): string {
  return Deno.env.get("SF_LOGIN_HOST") || "login.salesforce.com";
}

export interface SfSession {
  sessionId: string;
  serverUrl: string;
  instanceUrl: string;
  userId: string;
}

export interface SfQueryResult {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
}

/**
 * Thrown on a SOAP login fault. Carries the fault CODE only — never the
 * fault string verbatim (it can echo submitted input) and never the
 * request envelope.
 */
export class SfAuthError extends Error {
  faultCode: string;
  constructor(faultCode: string, message: string) {
    super(message);
    this.name = "SfAuthError";
    this.faultCode = faultCode;
  }
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the SOAP login envelope. Exported (pure, no I/O) so it can be
 * unit-tested without a network call and without ever printing real
 * credentials — tests pass synthetic username/password.
 */
export function buildLoginEnvelope(username: string, password: string, version: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">
  <soapenv:Body>
    <urn:login>
      <urn:username>${xmlEscape(username)}</urn:username>
      <urn:password>${xmlEscape(password)}</urn:password>
    </urn:login>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Parse a SOAP login response. Exported (pure) for testing against captured
 * fixture XML — both a successful `loginResponse` and a `soapenv:Fault`.
 * Never throws on malformed XML for the success path; returns null fields
 * instead so the caller can decide. Throws SfAuthError on a recognized fault.
 */
export function parseLoginResponse(xml: string): SfSession {
  const faultCodeMatch = xml.match(/<faultcode>([^<]*)<\/faultcode>/i);
  if (faultCodeMatch) {
    const faultStringMatch = xml.match(/<faultstring>([^<]*)<\/faultstring>/i);
    const code = faultCodeMatch[1].trim();
    // Keep the message generic — never echo the raw faultstring, which can
    // contain submitted input (e.g. INVALID_LOGIN messages sometimes quote
    // the username).
    const friendly =
      code.includes("INVALID_LOGIN")
        ? "Salesforce rejected the credentials (INVALID_LOGIN)."
        : code.includes("LOGIN_MUST_USE_SECURITY_TOKEN")
        ? "Salesforce requires a security token for this login (LOGIN_MUST_USE_SECURITY_TOKEN)."
        : `Salesforce SOAP login fault: ${code}`;
    void faultStringMatch; // deliberately not included in the thrown message
    throw new SfAuthError(code, friendly);
  }

  const sessionId = xml.match(/<sessionId>([^<]*)<\/sessionId>/i)?.[1] || "";
  const serverUrl = xml.match(/<serverUrl>([^<]*)<\/serverUrl>/i)?.[1] || "";
  const userId = xml.match(/<userId>([^<]*)<\/userId>/i)?.[1] || "";

  if (!sessionId || !serverUrl) {
    throw new SfAuthError(
      "UNPARSEABLE_RESPONSE",
      "Salesforce SOAP login response could not be parsed (no sessionId/serverUrl)."
    );
  }

  // serverUrl looks like https://xx.salesforce.com/services/Soap/u/61.0/00Dxx...
  // instanceUrl is the host portion, which the REST API also uses.
  let instanceUrl = serverUrl;
  try {
    const u = new URL(serverUrl);
    instanceUrl = `${u.protocol}//${u.host}`;
  } catch {
    // leave instanceUrl = serverUrl on the (unexpected) parse failure
  }

  return { sessionId, serverUrl, instanceUrl, userId };
}

/**
 * Log into Salesforce via the SOAP partner `login` API.
 * Password = SF_PASSWORD + SF_SECURITY_TOKEN concatenated (SOAP convention).
 * Never logs the password, token, or the resulting session id.
 */
export async function sfLogin(): Promise<SfSession> {
  const username = Deno.env.get("SF_USERNAME");
  const password = Deno.env.get("SF_PASSWORD");
  const token = Deno.env.get("SF_SECURITY_TOKEN") || "";
  if (!username || !password) {
    throw new SfAuthError(
      "MISSING_CREDENTIALS",
      "SF_USERNAME / SF_PASSWORD are not configured."
    );
  }

  const version = apiVersion();
  const envelope = buildLoginEnvelope(username, password + token, version);
  const url = `https://${loginHost()}/services/Soap/u/${version}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=UTF-8",
      SOAPAction: "login",
    },
    body: envelope,
  });

  const xml = await res.text();
  return parseLoginResponse(xml);
}

/**
 * Run a SOQL query via the REST Query API using an existing SOAP session id
 * as the Bearer token (a SOAP session id is valid for the REST API too —
 * that's what makes the SOAP login worth having with no Connected App).
 */
export async function sfQuery(session: SfSession, soql: string): Promise<SfQueryResult> {
  const version = apiVersion();
  const url = `${session.instanceUrl}/services/data/v${version}/query?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${session.sessionId}` },
  });
  const body = await res.text();
  let data: Record<string, unknown>;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new SfAuthError("UNPARSEABLE_QUERY_RESPONSE", `Salesforce query response was not JSON (status ${res.status}).`);
  }
  if (!res.ok) {
    // REST error bodies are an array of {errorCode, message}; surface the
    // errorCode only.
    const errorCode = Array.isArray(data) && data[0] && typeof data[0] === "object"
      ? String((data[0] as Record<string, unknown>).errorCode || "UNKNOWN")
      : "UNKNOWN";
    throw new SfAuthError(errorCode, `Salesforce query failed: ${errorCode} (status ${res.status}).`);
  }
  return {
    totalSize: Number(data.totalSize) || 0,
    done: data.done !== false,
    records: Array.isArray(data.records) ? (data.records as Record<string, unknown>[]) : [],
  };
}
