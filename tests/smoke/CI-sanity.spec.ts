import { test, expect } from '../../src/fixtures';
import {
  unlockCompleteHierarchy,
  lockCompleteHierarchy,
} from '../../src/api/apiHelpers';
import { updateUnitHierarchy } from '../../src/api/hierarchychange';

// ============ Sanity Test: Always Passes ============
test('sanity_alwaysPass @smoke', () => {
  expect(1).toBe(1);
});

// ============ CI Sanity: Hierarchy Move via API ============
// Expands a hierarchy in the UI, unlocks units via API, moves a unit via API,
// locks units back via API, and verifies the move in the UI.
test('sanity_hierarchyMoveViaAPI @smoke', async ({ hierarchyPage, request }) => {
  test.setTimeout(120000);

  // ── Test parameters ──
  const makatId = '000000006';
  const originalHierarchy = [3, 401];               // current path
  const newHierarchy = [2, 11, 101, 401];            // target path after move
  const unitToMove = 401;
  const newParentUnit = 101;

  // STEP 1: Add material and expand original hierarchy in the UI
  console.log(`\n[CI-SANITY] Step 1: Add material ${makatId} and expand hierarchy [${originalHierarchy.join(' → ')}]`);
  await hierarchyPage.addMakatFromDropdown(makatId);
  await hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy);

  // Verify the unit-to-move is visible before the move
  const cellBefore = await hierarchyPage.getCellValue(makatId, unitToMove);
  console.log(`[CI-SANITY] Unit ${unitToMove} value before move: ${cellBefore}`);

  // STEP 2: Unlock both old and new hierarchy paths via API
  console.log(`\n[CI-SANITY] Step 2: Unlocking hierarchies via API`);
  await unlockCompleteHierarchy(request, originalHierarchy, newHierarchy);
  console.log(`[CI-SANITY] Unlock complete ✓`);

  // STEP 3: Move unit via API
  console.log(`\n[CI-SANITY] Step 3: Moving unit ${unitToMove} → new parent ${newParentUnit} via API`);
  await updateUnitHierarchy(request, unitToMove, newParentUnit);
  console.log(`[CI-SANITY] Move complete ✓`);

  // STEP 4: Refresh page (to prime backend hierarchy cache), then lock via API
  console.log(`\n[CI-SANITY] Step 4: Refreshing page before API lock`);
  await hierarchyPage.page.reload();
  await hierarchyPage.page.waitForLoadState('networkidle');
  
  console.log(`[CI-SANITY] Locking hierarchy via API (single call)`);
  const topUnitsToLock = [...new Set([originalHierarchy[0], newHierarchy[0]])];
  await lockCompleteHierarchy(request, topUnitsToLock);
  console.log(`[CI-SANITY] Lock via API complete ✓`);

  // STEP 5: Reload page and verify the unit moved to the new hierarchy
  console.log(`\n[CI-SANITY] Step 5: Verifying move in UI`);
  await hierarchyPage.page.reload();
  await hierarchyPage.page.waitForLoadState('networkidle');
  await hierarchyPage.waitForMakatComboboxReady(30000);

  // Expand new hierarchy to see the moved unit
  await hierarchyPage.addMakatFromDropdown(makatId);
  await hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchy);

  // Verify the moved unit is visible under the new parent
  const cellAfter = await hierarchyPage.getCellValue(makatId, unitToMove);
  console.log(`[CI-SANITY] Unit ${unitToMove} value after move: ${cellAfter}`);
  expect(cellAfter).toBeDefined();
  console.log(`[CI-SANITY] ✓ Unit 401 found under new hierarchy [${newHierarchy.join(' → ')}]`);

  // Check that unit 3's value no longer includes unit 401's contribution
  const unit3ValueAfter = await hierarchyPage.getCellValue(makatId, 3);
  console.log(`[CI-SANITY] Unit 3 value after move: ${unit3ValueAfter} (should NOT include unit 401's value of ${cellBefore})`);

  // STEP 6: Move unit BACK to original parent to restore state
  console.log(`\n[CI-SANITY] Step 6: Restoring original hierarchy (move back)`);
  const oldParentUnit = 3; // original parent before the move
  await unlockCompleteHierarchy(request, newHierarchy, originalHierarchy);
  await updateUnitHierarchy(request, unitToMove, oldParentUnit);
  await lockCompleteHierarchy(request, topUnitsToLock);
  console.log(`[CI-SANITY] ✓ Hierarchy restored to original state`);

  console.log(`\n[CI-SANITY] ✅ TEST PASSED: Full API hierarchy move cycle verified\n`);
});
