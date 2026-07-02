import type { Response } from '@playwright/test';

/**
 * Shared helpers for turning a failed HTTP response into a CLEAR, actionable
 * error — so the test report literally says "the request failed (status/body)"
 * instead of a confusing downstream symptom (e.g. a value mismatch caused by an
 * unsaved value).
 *
 * Design rules (see the test suite's failure policy):
 *   • A 2xx/3xx response is a success.
 *   • A 4xx is a permanent CLIENT error — never retry, fail fast.
 *   • A 5xx is a SERVER error — may be retried by the caller, but if it is the
 *     final outcome of a required mutation the caller MUST fail (not continue).
 *   • The error message ALWAYS embeds method + URL + status + a body preview,
 *     because that is exactly the information needed to triage the failure.
 */

/** True for any non-success HTTP status (i.e. not 2xx/3xx). */
export function isFailureStatus(status: number): boolean {
  return status < 200 || status >= 400;
}

/** True for a permanent client error (4xx) that will never pass on retry. */
export function isClientFailure(status: number): boolean {
  return status >= 400 && status < 500;
}

/** True for a server error (5xx) that may be transient/retryable. */
export function isServerFailure(status: number): boolean {
  return status >= 500;
}

/**
 * Read a response body as a short, safe-to-log preview. Prefers JSON (so the
 * backend's `{message, type}` envelope is readable) and falls back to text.
 */
export async function readBodyPreview(
  resp: Response,
  maxLen = 300,
): Promise<string> {
  try {
    const json = await resp.json();
    return JSON.stringify(json).slice(0, maxLen);
  } catch {
    try {
      const text = await resp.text();
      return text.slice(0, maxLen);
    } catch {
      return '<unreadable body>';
    }
  }
}

/**
 * Build a uniform, fully-detailed failure message for a response:
 *   "[<label>] Request failed — POST <url> → 502. Body: {…}"
 *
 * `label` lets the caller name the operation (e.g. "saveMaterial") so the
 * report points straight at the failing step.
 */
export async function describeResponseFailure(
  resp: Response,
  label: string,
): Promise<string> {
  const req = resp.request();
  const body = await readBodyPreview(resp);
  return (
    `[${label}] Request failed — ${req.method()} ${resp.url()} → ${resp.status()} ` +
    `${resp.statusText()}. Body: ${body}`
  );
}
