// ============================================================================
// Utilities — Shared helpers for Edge Functions
// Life Command Center — Infrastructure Migration Phase 0
// ============================================================================

/**
 * Parse query parameters from a Request URL.
 * Supabase Edge Functions receive a full URL — this extracts the search params.
 */
export function queryParams(req: Request): URLSearchParams {
  const url = new URL(req.url);
  return url.searchParams;
}

/**
 * Parse JSON body from a Request, returning null on failure.
 */
export async function parseBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    if (req.method === "GET" || req.method === "OPTIONS") return null;
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Derive a human-readable title from a heterogeneous record.
 * Ported from daily-briefing.js deriveItemTitle().
 * Returns null when no usable title can be inferred.
 */
export function deriveItemTitle(item: Record<string, unknown> | string | null): string | null {
  if (item == null) return null;
  if (typeof item === "string") {
    const s = item.trim();
    return s || null;
  }
  if (typeof item !== "object") return null;

  const directFields = [
    "title", "subject", "name", "headline", "label",
    "what_name", "full_name", "company_name",
  ];
  for (const field of directFields) {
    const val = item[field];
    if (typeof val === "string" && val.trim()) return val.trim();
  }

  // Synthetic title from sender or task_type
  const sender = item.sender_name || item.sender_email;
  if (typeof sender === "string" && sender.trim()) {
    const taskType = item.task_type || item.source_type || "item";
    return `${taskType} from ${sender.trim()}`;
  }

  return null;
}

/**
 * Timestamp helpers
 */
export function isoNow(): string {
  return new Date().toISOString();
}

export function isoFuture(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

export function isoPast(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

/**
 * Estimate token count from a JSON payload.
 * Uses the ~4 chars per token heuristic (same as operations.js).
 */
export function estimateTokens(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

/**
 * Safe array coercion — returns [] if the value is not an array.
 */
export function toArray<T>(value: T[] | T | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
