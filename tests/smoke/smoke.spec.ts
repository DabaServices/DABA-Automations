import { test, expect } from '../../src/fixtures';
import { 
  makatValidationTestData, 
  hierarchyExpansionTestData, 
  leafCellClickabilityTestData 
} from '../../src/testData/smokeData';

/**
 * E2E Smoke Tests for Hierarchy Module
 *
 * PURPOSE: Quick validation that core functionality works
 * - Navigation to the module
 * - Adding a material to the table
 * - Basic hierarchy expansion
 * - Leaf cell interactions
 *
 * These are fast, focused tests to catch major regressions
 */

// ============ Hooks ============
test.afterEach(async ({ hierarchyPage }) => {
  // Close the page after each test
  try {
    await hierarchyPage.page.close();
  } catch (err) {
    // Ignore errors if page is already closed
  }
});

// ============ Smoke Test 1: Makat Table Validation ============
makatValidationTestData.forEach((testData) => {
  test(
    `smoke_makatValidation[${testData.description}]`,
    async ({ hierarchyPage, page }) => {
      try {
        // Select a material from dropdown
        await hierarchyPage.selectMakatFromDropdown(testData.materialId);
        
        // Click add button
        await hierarchyPage.clickAddMakatAdornment();
        
        // Verify material was added to the table
        const makatAdded = await hierarchyPage.verifyMaterialIdInRow(testData.materialId);
        expect(makatAdded).toBe(true);
        console.log(`✓ Material ${testData.materialId} successfully added to table`);
      } catch (error) {
        console.error(`✗ Test failed: ${error}`);
        throw error;
      } finally {
        // Close the page when test finishes
        try {
          await page.close();
        } catch (err) {
          console.warn(`Warning: Could not close page: ${err}`);
        }
      }
    }
  );
});

// ============ Smoke Test 2: Hierarchy Expansion ============
hierarchyExpansionTestData.forEach((testData) => {
  test(
    `smoke_hierarchyExpansion[${testData.description}]`,
    async ({ hierarchyPage, page }) => {
      try {
        // Select material from dropdown
        await hierarchyPage.selectMakatFromDropdown(testData.materialId);
        
        // Click add button
        await hierarchyPage.clickAddMakatAdornment();
        
        // Verify material was added
        const makatAdded = await hierarchyPage.verifyMaterialIdInRow(testData.materialId);
        expect(makatAdded).toBe(true);
        
        // Expand hierarchy through the specified path
        const hierarchyExpanded = await hierarchyPage.expandHierarchyToLeaf(
          testData.materialId,
          testData.unitsToExpand
        );
        expect(hierarchyExpanded).toBe(true);
        console.log(`✓ Hierarchy expanded through path: [${testData.unitsToExpand.join(' → ')}]`);
      } finally {
        // Close the page when test finishes
        await page.close();
      }
    }
  );
});

// ============ Smoke Test 3: Leaf Cell Clickability ============
leafCellClickabilityTestData.forEach((testData) => {
  test(
    `smoke_leafCellClickability[${testData.description}]`,
    async ({ hierarchyPage }) => {
      // Select material from dropdown and add it
      await hierarchyPage.selectMakatFromDropdown(testData.materialId);
      
      await hierarchyPage.clickAddMakatAdornment();
      
      // Expand hierarchy
      await hierarchyPage.expandHierarchyToLeaf(testData.materialId, testData.unitsToExpand);
      
      // Set values in leaf cells
      const leafValues = await hierarchyPage.setLeafCellValues(testData.materialId, 1);
      expect(leafValues.size).toBeGreaterThan(0);
      console.log(`✓ Successfully set values in ${leafValues.size} leaf cells`);
    }
  );
});


