import { test as base } from '@playwright/test';
import { ShechelPage } from '../pages/ShechelPage';
import { ensureTestHierarchy, buildHierarchyFromPath } from '../api/hierarchyCheck';
import { lockCompleteHierarchy } from '../api/apiHelpers';
import aggregationData from '../testData/aggregationData.json';
import smokeData from '../testData/smokeData.json';

// ─────────────────────────────────────────────────────────────────────────────
// setupByTitle – ONE map for ALL tests
//
// Every test registers the hierarchy path that must be correct before it runs.
// The beforeEach hook will:
//   1. Call ensureTestHierarchy → checks & fixes unit positions via API
//   2. Lock the hierarchy via the UI drawer
//   3. Navigate to the page
// ─────────────────────────────────────────────────────────────────────────────

interface TestSetupData {
  /** The hierarchy path that must be in place before the test starts (unitsToExpand / old path). */
  requiredHierarchy: number[];
  /**
   * Optional: the destination parent chain that must exist before a move.
   * = newHierarchy slice from start up to (NOT including) unitToMove.
   * Only needed for hierarchy-change tests that have a newHierarchy field.
   */
  newHierarchyPrefix?: number[];
}

const setupByTitle = new Map<string, TestSetupData>();

// ── Auto-register all datasets from all data files ──────────────────────────
// Each entry must have `description` and `unitsToExpand`.
// If it also has `newHierarchy` + `unitToMove`, the destination prefix is computed.
const allDataSources: Record<string, unknown> = {
  ...aggregationData,
  ...smokeData,
};

for (const [dataSetName, entries] of Object.entries(allDataSources)) {
  if (!Array.isArray(entries)) continue;
  for (const entry of entries) {
    if (!entry.description) continue;

    let newHierarchyPrefix: number[] | undefined;
    if (entry.newHierarchy && entry.unitToMove !== undefined) {
      const prefixEnd = entry.newHierarchy.indexOf(entry.unitToMove);
      newHierarchyPrefix = prefixEnd > 0 ? entry.newHierarchy.slice(0, prefixEnd) : undefined;
    }

    setupByTitle.set(
      `${dataSetName}[${entry.description}]`,
      { requiredHierarchy: entry.unitsToExpand || [], newHierarchyPrefix }
    );
  }
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
 * Runs automatically before every test:
 *   1. Looks up the required hierarchy path for this test in setupByTitle
 *   2. Calls ensureTestHierarchy → checks & fixes unit positions via API
 *   3. Locks the hierarchy via the UI drawer so cells are editable
 *   4. Navigates to the page
 *
 * No test needs any setup code in its own body.
 */
test.beforeEach(async ({ hierarchyPage, request }) => {
  const title = test.info().title;

  const setup = setupByTitle.get(title);
  if (setup) {
    const { requiredHierarchy, newHierarchyPrefix } = setup;

    const maxSetupRetries = 3;
    const retryDelayMs = 3000;

    // Step 1: ensure the starting path (unitsToExpand / old hierarchy)
    if (requiredHierarchy.length > 0) {
      console.log(`\n[beforeEach] Ensuring old hierarchy [${requiredHierarchy.join(' → ')}] for: ${title}`);
      for (let attempt = 1; attempt <= maxSetupRetries; attempt++) {
        try {
          await ensureTestHierarchy(request, buildHierarchyFromPath(requiredHierarchy));
          console.log(`[beforeEach] Old hierarchy verified ✓`);
          break;
        } catch (error) {
          if (attempt === maxSetupRetries) {
            console.error(`[beforeEach] Failed to ensure old hierarchy after ${maxSetupRetries} attempts: ${error}`);
            throw new Error(`[beforeEach] Hierarchy setup failed for "${title}". The required hierarchy [${requiredHierarchy.join(' → ')}] could not be established after ${maxSetupRetries} attempts. This may be caused by a previous test leaving the system in an unexpected state.`);
          }
          console.warn(`[beforeEach] Hierarchy setup attempt ${attempt}/${maxSetupRetries} failed, retrying in ${retryDelayMs}ms...`);
          await new Promise(r => setTimeout(r, retryDelayMs));
        }
      }
    }

    // Step 2: if a newHierarchy exists, also ensure the destination parent chain
    if (newHierarchyPrefix && newHierarchyPrefix.length > 0) {
      console.log(`[beforeEach] Ensuring destination parent chain [${newHierarchyPrefix.join(' → ')}]`);
      for (let attempt = 1; attempt <= maxSetupRetries; attempt++) {
        try {
          await ensureTestHierarchy(request, buildHierarchyFromPath(newHierarchyPrefix));
          console.log(`[beforeEach] Destination parent chain verified ✓`);
          break;
        } catch (error) {
          if (attempt === maxSetupRetries) {
            console.error(`[beforeEach] Failed to ensure destination parent chain after ${maxSetupRetries} attempts: ${error}`);
            throw new Error(`[beforeEach] Destination hierarchy setup failed for "${title}". Chain [${newHierarchyPrefix.join(' → ')}] could not be established after ${maxSetupRetries} attempts.`);
          }
          console.warn(`[beforeEach] Destination chain setup attempt ${attempt}/${maxSetupRetries} failed, retrying in ${retryDelayMs}ms...`);
          await new Promise(r => setTimeout(r, retryDelayMs));
        }
      }
    }

    // Step 3: lock via API — if no specific units, lock all; otherwise lock top-level units
    const unitsToLock = new Set<number>();
    if (requiredHierarchy.length > 0) {
      unitsToLock.add(requiredHierarchy[0]);
    }
    if (newHierarchyPrefix && newHierarchyPrefix.length > 0) {
      unitsToLock.add(newHierarchyPrefix[0]);
    }
    if (unitsToLock.size > 0) {
      await lockCompleteHierarchy(request, [...unitsToLock]);
      console.log(`[beforeEach] Hierarchy locked via API for units [${[...unitsToLock].join(', ')}] ✓`);
    } else {
      // No specific hierarchy — lock all units
      console.log(`[beforeEach] No specific hierarchy path, locking all units...`);
      await lockCompleteHierarchy(request, []);
      console.log(`[beforeEach] All units locked via API ✓`);
    }
  } else {
    // No setup entry found for this test — lock all units as a safe default
    console.log(`[beforeEach] No setup entry for "${title}", locking all units...`);
    await lockCompleteHierarchy(request, []);
    console.log(`[beforeEach] All units locked via API ✓`);
  }
  
  // Retry navigation if the page doesn't fully load (cold-start flakiness)
  const maxNavigationRetries = 3;
  for (let attempt = 1; attempt <= maxNavigationRetries; attempt++) {
    try {
      await hierarchyPage.goto();
      await hierarchyPage.page.waitForLoadState('networkidle');
      await hierarchyPage.waitForPageReady();
      await hierarchyPage.waitForMakatComboboxReady(30000);

      // Wait for the page to stabilize — the combobox can briefly appear
      // then disappear during a late React re-render triggered by lock/data fetch.
      await hierarchyPage.page.waitForTimeout(2000);
      await hierarchyPage.page.waitForLoadState('networkidle');
      await hierarchyPage.waitForMakatComboboxReady(30000);
      break; // success
    } catch (error) {
      console.warn(`[beforeEach] Page load attempt ${attempt}/${maxNavigationRetries} failed: ${error}`);
      if (attempt === maxNavigationRetries) throw error;
      console.log(`[beforeEach] Retrying with fresh navigation...`);
      await hierarchyPage.page.waitForTimeout(2000); // let the server settle
    }
  }
});

// Export the extended test for use in test files
export { expect } from '@playwright/test';