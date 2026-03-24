/**
 * Smoke Test Data
 * Contains parameterized test data for smoke tests - organized by test function
 * - Basic Makat validation and table operations
 * - Hierarchical aggregation verification
 * - Leaf-level cell clickability verification
 */

// ============ Smoke Test 1: Makat Table Validation Data ============
/**
 * Test data for validating basic Makat table operations
 * - Add a Makat to the table
 * - Verify Makat is visible in the table
 * 
 * Each test material contains:
 * - index: Position in dropdown to select
 * - materialId: Unique material identifier
 * - description: Human-readable test description
 */
export const makatValidationTestData = [
  {
    index: 0,
    materialId: 'm0000001',
    description: 'Material 1 - Basic Validation',
  },
];

// ============ Smoke Test 2: Hierarchy Expansion Data ============
/**
 * Test data for verifying core hierarchy drill-down functionality
 * - Add a Makat to the table
 * - Expand hierarchy through multiple levels
 * - Verify leaf-level cells exist
 */
export const hierarchyExpansionTestData = [
  {
    materialId: 'm0000001',
    materialDescription: 'mat_00000001',
    description: 'Hierarchical Aggregation Test - Matkal Level',
    unitsToExpand: [2, 12, 52],
  },
];

// ============ Smoke Test 3: Leaf-Level Cell Clickability Data ============
/**
 * Test data for verifying all leaf-level cells are clickable and interactive
 * - Verify ALL zero-cells are clickable
 * - Verify ALL numbered-cell increment buttons are clickable
 */
export const leafCellClickabilityTestData = [
  {
    materialId: 'm0000001',
    materialDescription: 'mat_00000001',
    description: 'Hierarchical Aggregation Test - Matkal Level',
    unitsToExpand: [2, 12, 52],
  },
];
