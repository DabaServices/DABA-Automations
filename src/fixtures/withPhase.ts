/**
 * Phase-tagged error helper.
 *
 * Wraps an async test phase so any thrown error is re-thrown with a clear,
 * phase-tagged prefix and context. The original error is preserved as
 * `cause` for stack traces.
 *
 * Playwright surfaces the `Error.message` in the line reporter, the HTML
 * report, the JSON report, and the trace viewer — so embedding the phase
 * and the test-data context here makes failures self-diagnosing without
 * having to dig through console logs.
 *
 * @example
 *   await withPhase('Move unit via UI', { unit: 108, parent: 8 }, () =>
 *     hierarchyPage.unitMoveUI(108, 8, [1, 8, 108]),
 *   );
 *   // On failure throws:
 *   //   [PHASE: Move unit via UI] (unit=108, parent=8) — <original message>
 */
export async function withPhase<T>(
  phase: string,
  ctx: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const original = err instanceof Error ? err.message : String(err);
    const ctxStr = Object.entries(ctx)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join('→')}]` : v}`)
      .join(', ');
    const tagged = new Error(`[PHASE: ${phase}] (${ctxStr}) — ${original}`);
    if (err instanceof Error) (tagged as Error & { cause?: unknown }).cause = err;
    throw tagged;
  }
}
