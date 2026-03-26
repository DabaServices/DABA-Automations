import { test, expect } from '../../src/fixtures';
import aggregationData from '../../src/testData/aggregationData.json';

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

hierarchicalAggregationTestData.forEach((testData) => {
  test(
    `test_aggregationVerification[${testData.description}]`,
    async ({ hierarchyPage }) => {
      // Extract test parameters: material ID and units to expand through
      const makatId = testData.materialId;
      const unitsToExpand = testData.unitsToExpand;

      // STEP 1: Add the material to the table
      await hierarchyPage.selectMakatFromDropdown(makatId);
      await hierarchyPage.clickAddMakatAdornment();
      const makatAdded = await hierarchyPage.verifyMaterialIdInRow(makatId);
      expect(makatAdded).toBe(true);

      // STEP 2: Expand ONLY the given hierarchy path - no more, no less
      console.log(`\n[EXPANDING PATH] Expanding only: [${unitsToExpand.join(' → ')}]`);
      const hierarchyExpanded = await hierarchyPage.expandHierarchyToLeaf(makatId, unitsToExpand);
      expect(hierarchyExpanded).toBe(true);
      console.log(`✓ Path expanded`);

      // STEP 3: Set test values at leaf cells
      const leafValues = await hierarchyPage.setLeafCellValues(makatId, 4);
      console.log(`\n[LEAF VALUES SET] Material ${makatId}:`);
      for (const [unitId, value] of leafValues.entries()) {
        console.log(`  - Unit ${unitId}: ${value}`);
      }

      // STEP 4: Verify aggregation based on visible cells in the expanded path
      console.log(`\n[AGGREGATION VERIFICATION] Verifying aggregation for visible cells...`);
      
      // Convert unitHierarchy to Map for verification
      const unitHierarchyMap = testData.unitHierarchy
        ? new Map(Object.entries(testData.unitHierarchy).map(([k, v]) => [parseInt(k), v]))
        : undefined;
      
      // Verify aggregation using provided hierarchy
      const aggregationValid = await hierarchyPage.verifyAggregation(
        makatId,
        unitsToExpand,
        leafValues,
        unitHierarchyMap
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

