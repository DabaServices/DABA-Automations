/**
 * Aggregation Test Data
 * Contains parameterized test data for E2E aggregation and advanced scenario tests
 * 
 * DESIGN PRINCIPLES:
 * - Only define visible hierarchy path (unitsToExpand) and materialId
 * - Parent-child relationships are extracted dynamically from the DOM
 * - No need for pre-defined unitHierarchy maps
 * - Tests validate only what's visible on screen after expansion
 * - Simple, maintainable test data focused on test scenarios, not internal structure
 */

// ============ Hierarchical Aggregation Test Data ============
/**
 * Test data for hierarchical aggregation verification
 * - Expand hierarchy through visible path only (e.g., [2, 12, 52])
 * - Set leaf-level inventory amounts
 * - Verify aggregation using unitHierarchy to validate ALL children
 */
export const hierarchicalAggregationTestData = [
  {
    materialId: 'm0000001',
    description: 'Hierarchical Aggregation Test - Matkal Level',
    unitsToExpand: [2, 12, 52],
    unitHierarchy: {
      2: [12, 22, 32, 42],
      12: [52, 92, 132, 172],
      52: [202, 352],
    } as Record<number, number[]>,
  },
];

// ============ Hierarchical Change Test Data ============
/**
 * Test data for hierarchical change verification
 * - Set values at specific unit level (e.g., unit 12 - Ugda)
 * - Move unit to a different parent (e.g., move unit 12 from parent 2 to parent 3)
 * - Verify aggregation still works correctly after hierarchy change
 * 
 * Each test case includes:
 * - materialId: The material to test
 * - description: Human-readable test description
 * - originalHierarchy: Path to expand BEFORE move (e.g., [2, 12, 52])
 * - newHierarchy: Path to expand AFTER move (e.g., [3, 12, 52])
 * - unitToMove: The unit ID being moved
 * - newParentUnit: The new parent for the moved unit
 * - oldParentUnit: The old parent of the moved unit
 * 
 * NOTE: No unitHierarchy map needed!
 * - verifyAggregation extracts parent-child relationships dynamically from DOM
 * - Test validates only the visible hierarchy paths (originalHierarchy and newHierarchy)
 * - Siblings and descendants are discovered from DOM during verification
 */
export const hierarchicalChangeTestData = [
  // {
  //   materialId: 'm0000001',
  //   description: 'Hierarchical Change Test - Move Unit 12 from Parent 2 to Parent 3',
  //   originalHierarchy: [2, 12, 52],
  //   newHierarchy: [3, 12, 52],
  //   unitToMove: 12,
  //   newParentUnit: 3,
  //   oldParentUnit: 2,
  //   unitHierarchy: {
  //     2: [12, 22, 32, 42],
  //     3: [12, 43, 33, 23, 13],
  //     12: [52, 92, 132, 172],
  //     52: [202, 352],
  //   } as Record<number, number[]>,
  // },
   {
    materialId: 'm0000001',
    description: 'Hierarchical Change Test - Move Unit 12 from Parent 2 to Parent 3',
    originalHierarchy: [2, 12, 52],
    newHierarchy: [3, 13, 52],
    unitToMove: 52,
    newParentUnit: 13,
    oldParentUnit: 12,
    unitHierarchy: {
      2: [12, 22, 32, 42],
      3: [23, 33, 43, 14, 13],
      13: [52, 53, 133, 92, 173],
      52: [202, 352],
    } as Record<number, number[]>,
  },
];
