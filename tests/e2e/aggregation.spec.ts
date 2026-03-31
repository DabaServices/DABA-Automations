import { test, expect } from '../../src/fixtures';
import aggregationData from '../../src/testData/aggregationData.json';
import { lockCompleteHierarchy } from '../../src/api/apiHelpers';

const hierarchicalAggregationTestData = aggregationData.hierarchicalAggregationTestData;

/**
 * E2E Test Suite: Hierarchical Aggregation Verification
 * 
 * PURPOSE: Verify that parent-child aggregation logic works correctly
 * in the hierarchical supply system
 * 
 * AGGREGATION RULE: Parent cell value = SUM(all child cell values)
 * Example: If leaf units have values [5, 3], parent should = 8
 * 
 * TEST WORKFLOW:
 * Step 1: Add a Makat (material) to the table
 * Step 2: Expand hierarchy through network buttons to reach leaf units
 * Step 3: Set test values at changeable leaf cells
 * Step 4: Verify aggregation by checking parent = sum of children
 * 
 * EXPECTED BEHAVIOR:
 * - When leaf cells are updated, parent values automatically aggregate
 * - Parent value must always equal the sum of child values
 * - If this fails, it indicates a bug in aggregation logic (backend or frontend)
 * 
 * TEST DATA: Parameterized test runs for each material in hierarchicalAggregationTestData
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

hierarchicalAggregationTestData.forEach((testData) => {
  test(
    `test_aggregationVerification[${testData.description}]`,
    async ({ hierarchyPage, request }) => {
      // Lock default test units at the start
      await lockCompleteHierarchy(request, [10, 2, 3, 4, 5, 6, 7, 8, 9]);
      await hierarchyPage.page.reload();
      await hierarchyPage.page.waitForLoadState('networkidle');

      // Extract test parameters: material ID and units to expand through
      const makatId = testData.materialId;
      const unitsToExpand = testData.unitsToExpand;

      // STEP 1: Add the material to the table
      await hierarchyPage.addMakatFromDropdown(makatId);

      // STEP 2: Expand ONLY the given hierarchy path - no more, no less
      await hierarchyPage.expandHierarchyToLeaf(makatId, unitsToExpand);

      // STEP 3: Set test values at leaf cells
      const leafValues = await hierarchyPage.setLeafCellValues(makatId, 4);

      // STEP 4: Capture ALL visible cell values at each level (including all siblings)
      const allVisibleValues = await hierarchyPage.captureAllVisibleCellValuesAtEachLevel(makatId, unitsToExpand);

      // STEP 5: Verify aggregation with all visible children using the captured values
      console.log(`\n[AGGREGATION VERIFICATION] Verifying aggregation including all siblings...`);
      const aggregationValid = await hierarchyPage.verifyAggregationWithAllVisibleCells(
        makatId,
        unitsToExpand,
        allVisibleValues
      );
      if (aggregationValid) {
        console.log(`✓ AGGREGATION VERIFIED`);
      } else {
        console.log(`✗ AGGREGATION FAILED`);
      }
      expect(aggregationValid).toBe(true);
    }
  );
});

