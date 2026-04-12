import { test as base } from '@playwright/test';
import { mainPage } from '../pages/mainPage';
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

// ── Hierarchy-change tests: required starting path = originalHierarchy (unitsToExpand) ──
// Also pass the newHierarchy prefix so the destination parent chain is verified too.
for (const entry of aggregationData.test_hierarchicalChangeValuePreservation) {
  const prefixEnd = entry.newHierarchy.indexOf(entry.unitToMove);
  setupByTitle.set(
    `test_hierarchicalChangeValuePreservation[${entry.description}]`,
    {
      requiredHierarchy: entry.unitsToExpand,
      newHierarchyPrefix: prefixEnd > 0 ? entry.newHierarchy.slice(0, prefixEnd) : undefined,
    }
  );
}
for (const entry of aggregationData.test_hierarchicalChangeAggregation) {
  const prefixEnd = entry.newHierarchy.indexOf(entry.unitToMove);
  setupByTitle.set(
    `test_hierarchicalChangeAggregation[${entry.description}]`,
    {
      requiredHierarchy: entry.unitsToExpand,
      newHierarchyPrefix: prefixEnd > 0 ? entry.newHierarchy.slice(0, prefixEnd) : undefined,
    }
  );
}
for (const entry of aggregationData.test_hierarchicalChangeOldHierarchyAggregation) {
  const prefixEnd = entry.newHierarchy.indexOf(entry.unitToMove);
  setupByTitle.set(
    `test_hierarchicalChangeOldHierarchyAggregation[${entry.description}]`,
    {
      requiredHierarchy: entry.unitsToExpand,
      newHierarchyPrefix: prefixEnd > 0 ? entry.newHierarchy.slice(0, prefixEnd) : undefined,
    }
  );
}

// ── Aggregation tests ────────────────────────────────────────────────────────
for (const entry of aggregationData.hierarchicalAggregationTestData) {
  setupByTitle.set(
    `test_aggregationVerification[${entry.description}]`,
    { requiredHierarchy: entry.unitsToExpand }
  );
}

// ── Smoke tests ──────────────────────────────────────────────────────────────
for (const entry of smokeData.hierarchyExpansionTestData) {
  setupByTitle.set(
    `smoke_hierarchyExpansion[${entry.description}]`,
    { requiredHierarchy: entry.unitsToExpand }
  );
}
for (const entry of smokeData.leafCellClickabilityTestData) {
  setupByTitle.set(
    `smoke_leafCellClickability[${entry.description}]`,
    { requiredHierarchy: entry.unitsToExpand }
  );
}
for (const entry of smokeData.saveFunctionalityTestData) {
  setupByTitle.set(
    `smoke_saveFunctionality[${entry.description}]`,
    { requiredHierarchy: entry.unitsToExpand }
  );
}
for (const entry of smokeData.makatValidationTestData) {
  setupByTitle.set(
    `smoke_makatValidation[${entry.description}]`,
    { requiredHierarchy: entry.unitsToExpand }
  );
}
for (const entry of smokeData.commentFunctionalityTestData) {
  setupByTitle.set(
    `smoke_commentFunctionality[${entry.description}]`,
    { requiredHierarchy: entry.unitsToExpand }
  );
}

// ============ Extend Playwright Test with Custom Fixtures ============

export const test = base.extend<{
  hierarchyPage: mainPage;
  committeesPage: mainPage;
  setStartHierarchy: () => Promise<void>;
  ensureHierarchy: (expectedHierarchy: Record<number, number[]>) => Promise<boolean>;
  /**
   * FIXTURE: prepareHierarchy
   *
   * PURPOSE: Ensure the hierarchy is in the correct starting state before
   * a hierarchical-change test runs.
   *
   * Wraps `ensureHierarchyBeforeMove` so tests never need to call setup
   * logic manually – they simply destructure this fixture and call it with
   * the test's own data.
   *
   * USAGE:
   * test('my test', async ({ hierarchyPage, prepareHierarchy }) => {
   *   await prepareHierarchy(originalHierarchy, newHierarchy, unitToMove);
   *   // Hierarchy is now guaranteed to be in the correct starting state
   * });
   */
  prepareHierarchy: (
    originalHierarchy: number[],
    newHierarchy: number[],
    unitToMove: number
  ) => Promise<void>;
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
    const hierarchyPage = new mainPage(page);
    
    // Provide to test
    await use(hierarchyPage);
    
    // Teardown: (if needed)
  },

  /**
   * FIXTURE: committeesPage (DEPRECATED - use hierarchyPage instead)
   * 
   * PURPOSE: Backward compatibility alias for hierarchyPage
   * 
   * Provided for old test files that use `committeesPage` fixture name.
   * New test files should use `hierarchyPage` instead.
   */
  committeesPage: async ({ hierarchyPage }, use) => {
    await use(hierarchyPage);
  },

  /**
   * FIXTURE: setStartHierarchy
   * 
   * PURPOSE: Set up the initial hierarchy state before running hierarchical change tests
   * 
   * USAGE:
   * test('hierarchical change test', async ({ hierarchyPage, setStartHierarchy }) => {
   *   await setStartHierarchy();
   *   // Now test can proceed with hierarchical changes
   * });
   */
  setStartHierarchy: async ({ hierarchyPage }, use) => {
    // Setup: Initialize function (implementation added later)
    const setUpHierarchy = async () => {
      // TODO: Implement hierarchy setup logic
    };
    
    // Provide to test
    await use(setUpHierarchy);
    
    // Teardown: (if needed)
  },

  /**
   * FIXTURE: ensureHierarchy
   * 
   * PURPOSE: Validate the current unit hierarchy in the system and correct it if needed
   * 
   * FLOW:
   * 1. Gets the current hierarchy from the Unit Hierarchy Drawer
   * 2. Compares it with the expected hierarchy provided
   * 3. If they don't match, moves units to match the expected hierarchy
   * 4. Returns true if hierarchy matches, false if corrections were needed
   * 
   * USAGE:
   * test('my test', async ({ hierarchyPage, ensureHierarchy }) => {
   *   const isCorrect = await ensureHierarchy({
   *     2: [12, 22, 32, 42],
   *     12: [52, 92, 132, 172],
   *     52: [202, 352],
   *   });
   *   
   *   if (!isCorrect) {
   *     console.log('Hierarchy was corrected');
   *   }
   * });
   */
  ensureHierarchy: async ({ hierarchyPage }, use) => {
    const ensureHierarchyFn = async (expectedHierarchy: Record<number, number[]>): Promise<boolean> => {
      // TODO: implement once the following methods are added to mainPage:
      //   openUnitHierarchyDrawer()
      //   getCurrentHierarchyFromDrawer()
      //   compareHierarchies(current, expected)
      //   correctHierarchy(current, expected)
      console.warn('[ensureHierarchy] Not yet implemented – returning false');
      return false;
    };

    await use(ensureHierarchyFn);
  },

  /**
   * FIXTURE: prepareHierarchy
   * PURPOSE: Ensure the hierarchy is in the correct starting state before
   * a hierarchical-change test runs.
   */
  prepareHierarchy: async ({ request }, use) => {
    const prepare = async (
      originalHierarchy: number[],
      newHierarchy: number[],
      unitToMove: number
    ): Promise<void> => {
      await ensureTestHierarchy(request, buildHierarchyFromPath(originalHierarchy));
    };

    await use(prepare);
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

    // Step 1: ensure the starting path (unitsToExpand / old hierarchy)
    console.log(`\n[beforeEach] Ensuring old hierarchy [${requiredHierarchy.join(' → ')}] for: ${title}`);
    await ensureTestHierarchy(request, buildHierarchyFromPath(requiredHierarchy));
    console.log(`[beforeEach] Old hierarchy verified ✓`);

    // Step 2: if a newHierarchy exists, also ensure the destination parent chain
    if (newHierarchyPrefix && newHierarchyPrefix.length > 0) {
      console.log(`[beforeEach] Ensuring destination parent chain [${newHierarchyPrefix.join(' → ')}]`);
      await ensureTestHierarchy(request, buildHierarchyFromPath(newHierarchyPrefix));
      console.log(`[beforeEach] Destination parent chain verified ✓`);
    }

    // Step 3: lock and navigate
    // await hierarchyPage.goto();
    // await hierarchyPage.page.waitForLoadState('networkidle');
    // await hierarchyPage.confirmAndLockHierarchyViaDrawer();
    // console.log(`[beforeEach] Hierarchy locked via drawer ✓`);

    // ALTERNATIVE Step 3: lock using API instead of UI drawer (commented out)
    const topLevelUnit = requiredHierarchy[0];
    await lockCompleteHierarchy(request, [topLevelUnit]);
    await hierarchyPage.goto();
    await hierarchyPage.page.waitForLoadState('networkidle');
    console.log(`[beforeEach] Hierarchy locked via API ✓`);
  } else {
    // No hierarchy setup needed (e.g. sanity test) – just navigate
    await hierarchyPage.goto();
  }
});

// Export the extended test for use in test files
export { expect } from '@playwright/test';