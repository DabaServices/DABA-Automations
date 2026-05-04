import { test, expect } from '../../src/fixtures';
import aggregationData from '../../src/testData/aggregationData.json';
import {
  unlockCompleteHierarchy,
  lockCompleteHierarchy,
} from '../../src/api/apiHelpers';
import { updateUnitHierarchy } from '../../src/api/hierarchychange';

const test_hierarchicalChangeValuePreservationData = aggregationData.test_hierarchicalChangeValuePreservation;
const test_hierarchicalChangeAggregationData = aggregationData.test_hierarchicalChangeAggregation;
const test_hierarchicalChangeOldHierarchyAggregationData = aggregationData.test_hierarchicalChangeOldHierarchyAggregation;

//────────────────────────TEST 1────────────────────────────────────
// hierarchy change using UI
test_hierarchicalChangeValuePreservationData.forEach((testData) => {
  test(`test_hierarchicalChangeValuePreservation[${testData.description}]`, async ({ hierarchyPage, request }) => {
    test.setTimeout(120000);

    const { materialId: makatId, unitsToExpand: originalHierarchy, newHierarchy, unitToMove, newParentUnit, oldParentUnit, hatunit } = testData;

    // STEP 1: Add material and expand
    await hierarchyPage.addMakatFromDropdown(makatId);

    // Expand the hierarchy tree to show leaf level values
    await hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy);
    
    // STEP 2: Set values and capture BEFORE move
    const leafValues = await hierarchyPage.setLeafCellValues(makatId, originalHierarchy, 1);
    
    // Capture the current values before we move the unit
    const valuesBefore = await hierarchyPage.captureAllVisibleCellValuesAtEachLevel(makatId, originalHierarchy);

    // STEP 3: Save material
    await hierarchyPage.saveMaterial();

    // STEP 4: Unlock units and refresh page, move unit using UI and refresh page 
    try {
      // Unlock all units in both old and new hierarchy paths (including parent units)
      await unlockCompleteHierarchy(request, originalHierarchy, newHierarchy);

      // *** CRITICAL: PAGE RELOAD BELOW ENSURES UI REFLECTS UNLOCK STATE BEFORE DRAWER OPERATIONS ***
      // Refresh the page so UI reflects the unlock changes
      await hierarchyPage.page.reload();
      await hierarchyPage.page.waitForLoadState('networkidle');

      // STEP 5: Move unit via UI (drawer)
      await hierarchyPage.unitMoveUI(unitToMove, newParentUnit, newHierarchy);

      // STEP 6: Lock units back using API - lock both top-level parents (original and new)
      // const topParentOriginal = originalHierarchy[0]; // Top parent from original hierarchy
      // const topParentNew = newHierarchy[0]; // Top parent from new hierarchy
      // await lockCompleteHierarchy(request, [topParentOriginal, topParentNew]);

      console.log(`  ✓ All operations completed`);
    } catch (error) {
      console.error(`Error during move: ${error}`);
    }

    await hierarchyPage.page.reload();
    await hierarchyPage.page.waitForLoadState('networkidle');

    // STEP 7: Expand new hierarchy to capture values after move
    await hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchy);
    
    // STEP 8: Capture values AFTER move
    const valuesAfter = await hierarchyPage.captureAllVisibleCellValuesAtEachLevel(makatId, newHierarchy);

    // STEP 9: Validate that the moved unit hierarchy is preserved
    console.log(`\n[MOVED UNIT HIERARCHY PRESERVATION CHECK]`);
    console.log(`────────────────────────────────────────────────────────────`);
    let hierarchyPreserved = true;
    
    // Check that the moved unit still has the same value
    const before = valuesBefore.get(unitToMove) ?? 'MISSING';
    const after = valuesAfter.get(unitToMove) ?? 'MISSING';
    const match = before === after;
    const marker = match ? '✓' : '✗';
    console.log(`  ${marker} Moved Unit ${unitToMove}: BEFORE=${before}, AFTER=${after}`);
    
    if (!match) {
      hierarchyPreserved = false;
    }
    
    console.log(`────────────────────────────────────────────────────────────`);
    expect(hierarchyPreserved && valuesAfter.size > 0).toBe(true);
    console.log(`✓ TEST PASSED: Moved unit hierarchy preserved after move!\n`);
  });
});



//────────────────────────TEST 2────────────────────────────────────
test_hierarchicalChangeAggregationData.forEach((testData) => {
  test(`test_hierarchicalChangeAggregation[${testData.description}]`, async ({ hierarchyPage, request }) => {
    test.setTimeout(120000);

    const { materialId: makatId, unitsToExpand: originalHierarchy, newHierarchy, unitToMove, newParentUnit, oldParentUnit, hatunit } = testData;

    // STEP 1: Add material and expand
    await hierarchyPage.addMakatFromDropdown(makatId);

    // Expand the hierarchy tree to show leaf level values
    await hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy);
    
    // STEP 2: Set values
    await hierarchyPage.setLeafCellValues(makatId, originalHierarchy, 1);
    
    // STEP 3: Save material
    await hierarchyPage.saveMaterial();

    // STEP 4: Unlock units and move via API
    try {
      // Unlock all units in both old and new hierarchy paths (including parent units)
      await unlockCompleteHierarchy(request, originalHierarchy, newHierarchy);

      // STEP 5: Move unit via API
      await updateUnitHierarchy(request, unitToMove, newParentUnit, 1, hatunit);
      
      // STEP 6: Lock units back using drawer UI
      await hierarchyPage.page.reload();
      await hierarchyPage.page.waitForLoadState('networkidle');
      await hierarchyPage.confirmAndLockHierarchyViaDrawer();
      
      // ALTERNATIVE STEP 6: Lock units back using API - lock both top-level parents (original and new)
      // const topParentOriginal = originalHierarchy[0]; // Top parent from original hierarchy
      // const topParentNew = newHierarchy[0]; // Top parent from new hierarchy
      // await lockCompleteHierarchy(request, [topParentOriginal, topParentNew]);

    } catch (error) {
      console.error(`Error during move: ${error}`);
    }

    await hierarchyPage.page.reload();
    await hierarchyPage.page.waitForLoadState('networkidle');
    
    // STEP 7: Expand new hierarchy and verify aggregation for entire new hierarchy
    await hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchy);
    
    // STEP 8: Capture ALL visible cell values at each level (including all siblings)
    console.log(`\n[CAPTURING ALL VISIBLE CELLS] Including all siblings at each level...`);
    const allVisibleValues = await hierarchyPage.captureAllVisibleCellValuesAtEachLevel(makatId, newHierarchy);
    
    // STEP 9: Verify aggregation for entire new hierarchy with all visible children
    console.log(`\n[AGGREGATION VERIFICATION FOR NEW HIERARCHY]`);
    const aggregationValid = await hierarchyPage.verifyAggregationWithAllVisibleCells(
      makatId,
      newHierarchy,
      allVisibleValues
    );
    expect(aggregationValid).toBe(true);
    console.log(`✓ TEST PASSED: Aggregation verified for entire new hierarchy!\n`);
  });
});



//────────────────────────TEST 3────────────────────────────────────
// ============ TEST 3: Aggregation Verification in Old Hierarchy After Unit Removal ============
test_hierarchicalChangeOldHierarchyAggregationData.forEach((testData) => {
  test(`test_hierarchicalChangeOldHierarchyAggregation[${testData.description}]`, async ({ hierarchyPage, request }) => {
    test.setTimeout(120000);

    const { materialId: makatId, unitsToExpand: originalHierarchy, newHierarchy, unitToMove, newParentUnit, oldParentUnit, hatunit } = testData;

    // STEP 1: Add material and expand
    await hierarchyPage.addMakatFromDropdown(makatId);

    // Expand the hierarchy tree to show leaf level values
    await hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy);
    
    // STEP 2: Set values
    await hierarchyPage.setLeafCellValues(makatId, originalHierarchy, 1);
    
    // STEP 3: Save material
    await hierarchyPage.saveMaterial();

    // STEP 4: Unlock units and move via API
    try {
      // Unlock all units in both old and new hierarchy paths (including parent units)
      await unlockCompleteHierarchy(request, originalHierarchy, newHierarchy);

      // STEP 5: Move unit via API
      await updateUnitHierarchy(request, unitToMove, newParentUnit, 1, hatunit);

      // STEP 6: Lock units back using drawer UI
      await hierarchyPage.page.reload();
      await hierarchyPage.page.waitForLoadState('networkidle');
      await hierarchyPage.confirmAndLockHierarchyViaDrawer();

      // ALTERNATIVE STEP 6: Lock units back using API - lock both top-level parents (original and new)
      // const topParentOriginal = originalHierarchy[0]; // Top parent from original hierarchy
      // const topParentNew = newHierarchy[0]; // Top parent from new hierarchy
      // await lockCompleteHierarchy(request, [topParentOriginal, topParentNew]);

    } catch (error) {
      console.error(`Error during move: ${error}`);
    }

    await hierarchyPage.page.reload();
    await hierarchyPage.page.waitForLoadState('networkidle');

    // STEP 7: Re-expand old hierarchy to verify old parent aggregation
    const oldHierarchyPath = originalHierarchy.slice(0, originalHierarchy.indexOf(oldParentUnit) + 1);
    await hierarchyPage.expandHierarchyToLeaf(makatId, oldHierarchyPath);
    
    // STEP 8: Capture ALL visible cell values at each level for old hierarchy path
    console.log(`\n[CAPTURING ALL VISIBLE CELLS] For old hierarchy after unit removal...`);
    const oldHierarchyValues = await hierarchyPage.captureAllVisibleCellValuesAtEachLevel(makatId, oldHierarchyPath);

    // STEP 9: Verify moved unit is NO LONGER present in the old hierarchy
    console.log(`\n[MOVED UNIT ABSENCE CHECK]`);
    console.log(`────────────────────────────────────────────────────────────`);
    if (oldHierarchyValues.has(unitToMove)) {
      const staleValue = oldHierarchyValues.get(unitToMove);
      console.error(`  ✗ Unit ${unitToMove} still appears in old hierarchy with value=${staleValue}`);
      throw new Error(
        `Unit ${unitToMove} was NOT removed from old hierarchy path [${oldHierarchyPath.join(' → ')}]. ` +
        `It still appears with value=${staleValue}. The move operation may have failed.`
      );
    }
    console.log(`  ✓ Unit ${unitToMove} is absent from old hierarchy – move confirmed`);
    console.log(`────────────────────────────────────────────────────────────`);
    
    // STEP 10: Verify aggregation of the old hierarchy with all visible children
    console.log(`\n[AGGREGATION VERIFICATION FOR OLD HIERARCHY]`);
    const oldHierarchyAggregationValid = await hierarchyPage.verifyAggregationWithAllVisibleCells(
      makatId,
      oldHierarchyPath,
      oldHierarchyValues
    );
    expect(oldHierarchyAggregationValid).toBe(true);
    console.log(`✓ TEST PASSED: Aggregation verified for OLD hierarchy after unit removal!\n`);
  });
});

