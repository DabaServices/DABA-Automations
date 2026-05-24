import { test as base } from '@playwright/test';
import { ShechelPage } from '../pages/ShechelPage';
import { lockCompleteHierarchy } from '../api/apiHelpers';
import { ClientError } from '../api/reportUnits';
import aggregationData from '../testData/changeHierarchyData.json';
import regularTestsData from '../testData/regularTestsData.json';

// ─────────────────────────────────────────────────────────────────────────────
// topUnitsByDescription – maps a dataset entry's `description` string to the
// set of TOP-level units that must be locked before any test using it runs.
//
// Tests are expected to name themselves `<testName>[<description>]` so this
// hook can extract the description and find the correct entry, regardless of
// which test (sanity, e2e, etc.) references the data.
//
// For every dataset entry we collect:
//   • unitsToExpand[0]  (top of the original hierarchy)
//   • newHierarchy[0]   (top of the destination hierarchy, if present)
// ─────────────────────────────────────────────────────────────────────────────

const topUnitsByDescription = new Map<string, number[]>();
/** Descriptions whose tests will MOVE a given unit — used to skip locking
 *  the unit-to-move (locking it would block the test's own move). */
const unitToMoveByDescription = new Map<string, number>();

const allDataSources: Record<string, unknown> = {
  ...aggregationData,
  ...regularTestsData,
};

for (const entries of Object.values(allDataSources)) {
  if (!Array.isArray(entries)) continue;
  for (const entry of entries) {
    if (!entry || !entry.description) continue;
    const tops = new Set<number>();
    if (Array.isArray(entry.unitsToExpand) && entry.unitsToExpand.length > 0) {
      tops.add(entry.unitsToExpand[0]);
    }
    if (Array.isArray(entry.newHierarchy) && entry.newHierarchy.length > 0) {
      tops.add(entry.newHierarchy[0]);
    }
    if (tops.size > 0) {
      const existing = topUnitsByDescription.get(entry.description);
      const merged = new Set<number>([...(existing ?? []), ...tops]);
      topUnitsByDescription.set(entry.description, [...merged]);
    }
    if (typeof entry.unitToMove === 'number') {
      unitToMoveByDescription.set(entry.description, entry.unitToMove);
    }
  }
}

/** Extract the `description` from a test title formatted as `name[description]`.
 *
 * Robust against descriptions that themselves contain `[ ]` (e.g. `[OUTSIDE]`).
 * Strategy: strip optional trailing `@tag` markers, then take everything
 * between the FIRST `[` and the LAST `]`. Falls back to undefined.
 */
function descriptionFromTitle(title: string): string | undefined {
  // Strip trailing playwright-style tags like " @smoke @fast"
  const cleaned = title.replace(/(?:\s+@\S+)+\s*$/, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first === -1 || last === -1 || last <= first + 1) return undefined;
  return cleaned.slice(first + 1, last);
}

// ============ Extend Playwright Test with Custom Fixtures ============

export const test = base.extend<{
  hierarchyPage: ShechelPage;
}>({
  
  /**
   * FIXTURE: hierarchyPage
   * 
   * PURPOSE: Initialize and provide the mainPage POM for all tests
   * 
   * NOTE: Page is automatically opened via beforeEach hook
   * 
   * USAGE:
   * test('my test', async ({ hierarchyPage }) => {
   *   // Page is already open!
   *   await hierarchyPage.selectMakatFromDropdown('m0000001');
   * });
   */
  hierarchyPage: async ({ page }, use) => {
    // Setup: Create mainPage instance
    const hierarchyPage = new ShechelPage(page);
    
    // Provide to test
    await use(hierarchyPage);
    
    // Teardown: (if needed)
  },

});

// ============ Global Hooks ============

/**
 * HOOK: beforeEach
 *
 * 1. Locks the top-level units referenced by the current test's data
 *    (unitsToExpand[0] and newHierarchy[0]) via the API.
 *    The Makat combobox in the UI is ONLY rendered when at least one
 *    top-level unit is locked, so this lock is a hard prerequisite for
 *    every test — a failure here must abort the test fast with a clear
 *    error rather than letting the test crawl through ~60 s of combobox
 *    timeouts.
 * 2. Navigates to the page.
 */
test.beforeEach(async ({ hierarchyPage, request }) => {
  const title = test.info().title;
  const description = descriptionFromTitle(title);
  const rawTopUnits = description ? topUnitsByDescription.get(description) : undefined;
  const unitToMove = description ? unitToMoveByDescription.get(description) : undefined;

  // Never lock the unit the test is about to move — locking it would block
  // the very operation under test (see audit scenario [12]).
  // Also never lock Matkal (unit 1): it is the global root, and locking it
  // contends with every other parallel worker (and the backend frequently
  // returns 502 on /reportUnits for it). Skip it silently.
  let topUnits =
    rawTopUnits?.filter((u) => u !== unitToMove && u !== 1) ?? [];

  // Safety net: if filtering left us with no top units to lock (e.g. the
  // only top unit was Matkal itself, or was the unit-to-move), skip the
  // lock phase entirely. Some other parallel worker will have a non-Matkal
  // top unit locked, which is enough for the Makat combobox to render.
  if (topUnits.length === 0) {
    console.info(
      `[beforeEach] No non-Matkal top units to lock for "${title}" — skipping lock phase.`,
    );
  }

  // Lock with retries and exponential backoff. The lock is REQUIRED — the
  // Makat combobox only renders when at least one unit is locked, so if the
  // lock never succeeds we'd timeout 60 s later in the combobox wait with a
  // useless error message. Backend can return 502s during cold-start, so be
  // patient: ~5 attempts spread over ~30 s before giving up.
  //
  // IMPORTANT: a 4xx response from the lock API typically means the unit is
  // ALREADY LOCKED (e.g. leftover state from a previous run, or another
  // worker already locked it). That is FINE — the prerequisite (a locked
  // top unit so the combobox renders) is already satisfied. We treat any
  // ClientError as a soft-success and proceed.
  const lockAttempts = [0, 2000, 4000, 6000, 8000]; // ms to wait BEFORE each attempt
  let lockError: unknown;
  if (topUnits.length === 0) {
    // Nothing to lock (Matkal-only or empty after filtering) — proceed.
    lockError = undefined;
  } else {
  for (let i = 0; i < lockAttempts.length; i++) {
    const waitMs = lockAttempts[i];
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    try {
      console.log(
        `[beforeEach] Locking top units [${topUnits.join(', ')}] for: ${title} (attempt ${i + 1}/${lockAttempts.length})`,
      );
      await lockCompleteHierarchy(request, topUnits);
      console.log(`[beforeEach] Top units locked ✓`);
      lockError = undefined;
      break;
    } catch (error) {
      // 4xx → unit is already locked (or another non-retryable client issue).
      // Either way, the precondition is satisfied or further retries won't help.
      if (error instanceof ClientError) {
        console.info(
          `[beforeEach] Lock for [${topUnits.join(', ')}] returned HTTP ${error.status} — treating as "already locked", proceeding.`,
        );
        lockError = undefined;
        break;
      }
      lockError = error;
      console.warn(
        `[beforeEach] Lock attempt ${i + 1}/${lockAttempts.length} for [${topUnits.join(', ')}] failed: ${error}`,
      );
    }
  }
  }
  if (lockError) {
    throw new Error(
      `[beforeEach] Could not lock top units [${topUnits.join(', ')}] after ${lockAttempts.length} attempts — ` +
        `Makat combobox cannot appear without at least one locked unit. ` +
        `Underlying error: ${lockError}`,
    );
  }

  // Retry navigation if the page doesn't fully load (cold-start flakiness)
  const maxNavigationRetries = 2;
  for (let attempt = 1; attempt <= maxNavigationRetries; attempt++) {
    try {
      await hierarchyPage.goto();
      await hierarchyPage.page.waitForLoadState('networkidle');
      await hierarchyPage.waitForPageReady();
      // Per-attempt timeout grows with each retry so a slow cold-start
      // backend gets more time before we give up and re-navigate.
      const perAttemptTimeout = 40_000 + attempt * 10_000;
      await hierarchyPage.waitForMakatComboboxReady(perAttemptTimeout);

      // Wait for the page to stabilize — the combobox can briefly appear
      // then disappear during a late React re-render triggered by lock/data fetch.
      await hierarchyPage.page.waitForTimeout(2000);
      await hierarchyPage.page.waitForLoadState('networkidle');
      await hierarchyPage.waitForMakatComboboxReady(perAttemptTimeout);
      break; // success
    } catch (error) {
      console.warn(`[beforeEach] Page load attempt ${attempt}/${maxNavigationRetries} failed: ${error}`);
      if (attempt === maxNavigationRetries) throw error;
      console.log(`[beforeEach] Retrying with fresh navigation + reload...`);
      // Force a hard reload before retrying so React re-mounts cleanly.
      try {
        await hierarchyPage.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch { /* ignore — next goto() will recover */ }
      await hierarchyPage.page.waitForTimeout(3000);
    }
  }
});

// Export the extended test for use in test files
export { expect } from '@playwright/test';