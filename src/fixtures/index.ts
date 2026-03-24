import { test as base } from '@playwright/test';
import { mainPage } from '../pages/mainPage';

/**
 * Custom Playwright Test Fixtures & Hooks
 * 
 * This file defines reusable fixtures for all tests and sets up automatic hooks.
 * Fixtures are helper functions that set up test state before each test runs.
 * 
 * USAGE:
 * Instead of: test('my test', async ({ page }) => { ... })
 * Use:        test('my test', async ({ hierarchyPage, setStartHierarchy }) => { ... })
 */

// ============ Extend Playwright Test with Custom Fixtures ============

export const test = base.extend<{
  hierarchyPage: mainPage;
  committeesPage: mainPage; // Backward compatibility alias
  setStartHierarchy: () => Promise<void>;
  ensureHierarchy: (expectedHierarchy: Record<number, number[]>) => Promise<boolean>;
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
      try {
        console.log(`\n[ENSURE HIERARCHY] Validating hierarchy structure...`);
        
        // Step 1: Open the Unit Hierarchy Drawer
        const drawerOpened = await hierarchyPage.openUnitHierarchyDrawer();
        if (!drawerOpened) {
          console.log(`✗ Failed to open Unit Hierarchy Drawer`);
          return false;
        }
        console.log(`✓ Unit Hierarchy Drawer opened`);

        // Step 2: Get current hierarchy from drawer
        const currentHierarchy = await hierarchyPage.getCurrentHierarchyFromDrawer();
        console.log(`\n[CURRENT HIERARCHY]:`);
        for (const [parentId, children] of Object.entries(currentHierarchy)) {
          console.log(`  ${parentId}: [${children.join(', ')}]`);
        }

        // Step 3: Compare expected vs current
        console.log(`\n[EXPECTED HIERARCHY]:`);
        for (const [parentId, children] of Object.entries(expectedHierarchy)) {
          console.log(`  ${parentId}: [${children.join(', ')}]`);
        }

        // Step 4: Check if they match
        const hierarchyMatches = await hierarchyPage.compareHierarchies(currentHierarchy, expectedHierarchy);
        
        if (hierarchyMatches) {
          console.log(`\n✓ Hierarchy matches expected structure`);
          return true;
        } else {
          console.log(`\n✗ Hierarchy does NOT match - correcting...`);
          
          // Step 5: Correct the hierarchy by moving units
          const corrected = await hierarchyPage.correctHierarchy(currentHierarchy, expectedHierarchy);
          
          if (corrected) {
            console.log(`✓ Hierarchy corrected successfully`);
            return false; // Return false to indicate corrections were made
          } else {
            console.log(`✗ Failed to correct hierarchy`);
            return false;
          }
        }
      } catch (error) {
        console.error(`Error ensuring hierarchy:`, error);
        return false;
      }
    };

    // Provide the function to test
    await use(ensureHierarchyFn);

    // Teardown: (if needed)
  },

});

// ============ Global Hooks ============

/**
 * HOOK: beforeEach - Opens the page before each test
 * 
 * PURPOSE: Automatically navigate to the module before each test runs
 * This eliminates the need for test-by-test navigation setup
 */
test.beforeEach(async ({ hierarchyPage }) => {
  await hierarchyPage.goto();
});

// Export the extended test for use in test files
export { expect } from '@playwright/test';
