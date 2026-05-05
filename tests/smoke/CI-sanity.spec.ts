import { test, expect } from '../../src/fixtures';
import { unlockCompleteHierarchy, lockCompleteHierarchy } from '../../src/api/apiHelpers';
import { updateUnitHierarchy } from '../../src/api/hierarchychange';

// ============ Sanity Test: Always Passes ============
test('sanity_alwaysPass @smoke', () => {
  expect(1).toBe(1);
});

// ============ CI Test: Move unit 401 from unit 3 to unit 101 (under 11, under 2) ============
test('test_moveUnit401_from3_to101 @ci', async ({ request }) => {
  test.setTimeout(60000);

  const unitToMove = 401;
  const newParentUnit = 101;
  const hatunit = 1;

  // Original hierarchy: unit 401 is under unit 3
  const originalHierarchy = [3, 401];
  // New hierarchy: unit 401 should end up under 2 → 11 → 101
  const newHierarchy = [2, 11, 101, 401];

  // Step 1: Unlock all units in both old and new hierarchy paths
  console.log(`[CI] Unlocking hierarchies...`);
  await unlockCompleteHierarchy(request, originalHierarchy, newHierarchy);
  console.log(`[CI] Unlock complete ✓`);

  // Step 2: Move unit via API
  console.log(`[CI] Moving unit ${unitToMove} to parent ${newParentUnit}...`);
  await updateUnitHierarchy(request, unitToMove, newParentUnit, 1, hatunit);
  console.log(`[CI] Move complete ✓`);

  // Step 3: Lock units back via API (includes reportUnits call)
  console.log(`[CI] Locking hierarchies...`);
  const topParentOriginal = originalHierarchy[0]; // 3
  const topParentNew = newHierarchy[0]; // 2
  await lockCompleteHierarchy(request, [topParentOriginal, topParentNew]);
  console.log(`[CI] Lock complete ✓`);

  console.log(`[CI] Successfully moved unit ${unitToMove} from unit 3 to unit ${newParentUnit}`);
});
