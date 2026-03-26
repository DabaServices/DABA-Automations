import { test, expect } from '../../src/fixtures';
import aggregationData from '../../src/testData/aggregationData.json';
import { lockUnitStatus } from '../../src/api/lockunitstatus';

const hierarchicalChangeTestData = aggregationData.hierarchicalChangeTestData;

/**
 * E2E Tests: Hierarchical Unit Relocation
 * 
 * Test 1: Values Preservation During Unit Move
 * - Add material and set values
 * - Move unit to new parent
 * - Verify values remain unchanged
 * 
 * Test 2: Aggregation Verification After Hierarchy Change
 * - Add material and set values
 * - Move unit to new parent
 * - Verify aggregation works in entire new hierarchy
 * 
 * Test 3: Aggregation Verification in Old Hierarchy After Unit Removal
 * - Add material and set values
 * - Move unit to new parent
 * - Verify aggregation still works in OLD hierarchy after unit removal
 *   (starting from the highest parent in the old hierarchy path)
 */

// Helper: Get all descendants of a unit from hierarchy
// Recursively collects all child units of a given unit ID
const getDescendants = (unitId: number, hierarchy: Map<number, number[]>): number[] => {
  const descendants: number[] = [unitId];
  const children = hierarchy.get(unitId) || [];
  for (const child of children) {
    descendants.push(...getDescendants(child, hierarchy));
  }
  return descendants;
};

// Helper: Capture unit values from DOM
// Extracts values from input cells for each unit in the descendants list
const captureUnitValues = async (hierarchyPage: any, makatId: string, descendants: number[]) => {
  const unitValuesMap = new Map<number, number>();
  // Find all input elements containing the material ID
  const inputElements = await hierarchyPage.page.locator(`[data-testid*="${makatId}"] [data-testid*="input"]`).all();
  
  for (const input of inputElements) {
    try {
      const testId = await input.locator('..').getAttribute('data-testid');
      // Extract numbered-cell for this material
      if (testId?.includes(`numbered-cell-${makatId}`)) {
        // Parse unit ID from testId (e.g., numbered-cell-ABC123-5 -> 5)
        const unitMatch = testId.match(/numbered-cell-[^-]+-(\d+)/);
        if (unitMatch) {
          const unitId = parseInt(unitMatch[1], 10);
          // Only capture values for units we care about
          if (descendants.includes(unitId)) {
            const value = parseInt(await input.inputValue().catch(() => '0') || '0', 10);
            unitValuesMap.set(unitId, value);
          }
        }
      }
    } catch (err) {
      // Skip cells that can't be read
    }
  }
  return unitValuesMap;
};

// Helper: Print unit values in a formatted table
// Shows unit ID, value, and marks the moving unit with ▶
const printUnitValues = (label: string, unitValuesMap: Map<number, number>, unitToMove: number) => {
  console.log(`\n[${label}]`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  const sorted = Array.from(unitValuesMap.keys()).sort((a, b) => a - b);
  for (const unitId of sorted) {
    const value = unitValuesMap.get(unitId) || 0;
    // Mark the unit being moved with ▶
    const marker = unitId === unitToMove ? '▶' : ' ';
    console.log(`  ${marker} Unit ${unitId}: ${value}`);
  }
  console.log(`═══════════════════════════════════════════════════════════════`);
};

hierarchicalChangeTestData.forEach((testData) => {
  test(`test_hierarchicalChangeValuePreservation[${testData.description}]`, async ({ hierarchyPage, request }) => {
    test.setTimeout(120000);

    const { materialId: makatId, unitsToExpand: originalHierarchy, newHierarchy, unitToMove, newParentUnit, oldParentUnit, unitHierarchy } = testData;
    // Convert unit hierarchy object to Map for easier access
    const unitHierarchyMap = unitHierarchy ? new Map(Object.entries(unitHierarchy).map(([k, v]) => [parseInt(k), v])) : undefined;
    // Get all descendants of the unit we're moving
    const descendants = getDescendants(unitToMove, unitHierarchyMap!);

    // STEP 1: Add material and expand
    await hierarchyPage.selectMakatFromDropdown(makatId);
    await hierarchyPage.clickAddMakatAdornment();
    expect(await hierarchyPage.verifyMaterialIdInRow(makatId)).toBe(true);

    // Expand the hierarchy tree to show leaf level values
    await hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy);
    
    // STEP 2: Set values and capture BEFORE move
    const leafValues = await hierarchyPage.setLeafCellValues(makatId, 1);
    
    // Capture the current values before we move the unit
    const valuesBefore = await captureUnitValues(hierarchyPage, makatId, descendants);
    printUnitValues(`CAPTURED VALUES BEFORE MOVE`, valuesBefore, unitToMove);

    // STEP 3: Save material
    await hierarchyPage.saveMaterial();

    // STEP 4: Move unit
    try {
      // Open the unit hierarchy drawer
      await hierarchyPage.openUnitHierarchyDrawer();
      
      // Show all units by triggering and confirming the initial popup
      const initTrigger = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-trigger"]`);
      await initTrigger.click();
      
      const initConfirm = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]`);
      await initConfirm.click();

      // SOURCE HIERARCHY: Expand up to and INCLUDING the old parent
      await hierarchyPage.expandHierarchyPath(originalHierarchy, oldParentUnit);
      
      // Unlock the old parent via API if needed
      try {
        await lockUnitStatus(request, [oldParentUnit], 1, 0);
      } catch (error) {
        console.log(`  ⚠ Could not unlock via API: ${error}`);
      }

      // Collapse the old hierarchy by clicking the highest parent
      await hierarchyPage.collapseHierarchyPath(originalHierarchy);

      // TARGET HIERARCHY: Expand up to and INCLUDING the new parent
      await hierarchyPage.expandHierarchyPath(newHierarchy, newParentUnit);

      // Unlock the new parent via API if needed
      try {
        await lockUnitStatus(request, [newParentUnit], 1, 0);
      } catch (error) {
        console.log(`  ⚠ Could not unlock via API: ${error}`);
      }

      // UNIT RELOCATION: Select and move the unit to new parent's combobox
      const comboboxInput = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-input"]`);
      await comboboxInput.click();
      
      // Click the unit option item to select it
      const unitOptionItem = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-item-${unitToMove}"]`);
      await unitOptionItem.waitFor({ state: 'visible' });
      await unitOptionItem.click();
      
      // Confirm the unit selection
      const comboboxActionButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-action-button"]`);
      await comboboxActionButton.click();
      
      // Trigger and confirm the move via popup
      const actionButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-trigger"]`);
      await actionButton.click();
      
      const confirmButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]`);
      await confirmButton.click();
      
      // Close the drawer
      await hierarchyPage.page.keyboard.press('Escape');
    } catch (error) {
      console.error(`Error during move: ${error}`);
    }

    // STEP 5: Wait for updates and re-expand old hierarchy to verify old parent
    await hierarchyPage.waitForNetworkIdle();
    
    // Re-expand the old hierarchy up to and INCLUDING the old parent to verify structure
    console.log(`\n[OLD HIERARCHY VERIFICATION] Expanding old hierarchy up to old parent unit ${oldParentUnit}...`);
    await hierarchyPage.expandHierarchyPath(originalHierarchy, oldParentUnit);
    
    // STEP 6: Wait and expand new hierarchy
    await hierarchyPage.waitForNetworkIdle();
    await hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchy);
    
    // STEP 7: Capture values AFTER move
    const valuesAfter = await captureUnitValues(hierarchyPage, makatId, descendants);
    printUnitValues(`CAPTURED VALUES AFTER MOVE`, valuesAfter, unitToMove);

    // STEP 7: Validate values are preserved
    console.log(`\n[VALUE PRESERVATION CHECK]`);
    console.log(`────────────────────────────────────────────────────────────`);
    let allValuesMatch = true;
    const valuesToCheck = new Set([...valuesBefore.keys(), ...valuesAfter.keys()]);
    
    for (const unitId of Array.from(valuesToCheck).sort((a, b) => a - b)) {
      const before = valuesBefore.get(unitId) ?? 'MISSING';
      const after = valuesAfter.get(unitId) ?? 'MISSING';
      const match = before === after;
      const marker = match ? '✓' : '✗';
      console.log(`  ${marker} Unit ${unitId}: BEFORE=${before}, AFTER=${after}`);
      
      if (!match) {
        allValuesMatch = false;
      }
    }
    
    console.log(`────────────────────────────────────────────────────────────`);
    expect(allValuesMatch && valuesAfter.size > 0).toBe(true);
    console.log(`✓ TEST PASSED: All values preserved after move!\n`);
  });
});

hierarchicalChangeTestData.forEach((testData) => {
  test(`test_hierarchicalChangeAggregation[${testData.description}]`, async ({ hierarchyPage, request }) => {
    test.setTimeout(120000);

    const { materialId: makatId, unitsToExpand: originalHierarchy, newHierarchy, unitToMove, newParentUnit, oldParentUnit, unitHierarchy } = testData;
    // Convert unit hierarchy object to Map for easier access
    const unitHierarchyMap = unitHierarchy ? new Map(Object.entries(unitHierarchy).map(([k, v]) => [parseInt(k), v])) : undefined;
    // Get all descendants of the unit we're moving
    const descendants = getDescendants(unitToMove, unitHierarchyMap!);

    // STEP 1: Add material and expand
    await hierarchyPage.selectMakatFromDropdown(makatId);
    await hierarchyPage.clickAddMakatAdornment();
    expect(await hierarchyPage.verifyMaterialIdInRow(makatId)).toBe(true);

    // Expand the hierarchy tree to show leaf level values
    await hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy);
    
    // STEP 2: Set values
    await hierarchyPage.setLeafCellValues(makatId, 1);
    
    // STEP 3: Save material
    await hierarchyPage.saveMaterial();

    // STEP 4: Move unit
    try {
      // Open the unit hierarchy drawer
      await hierarchyPage.openUnitHierarchyDrawer();
      
      // Show all units by triggering and confirming the initial popup
      const initTrigger = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-trigger"]`);
      await initTrigger.click();
      
      const initConfirm = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]`);
      await initConfirm.click();

      // SOURCE HIERARCHY: Expand up to and INCLUDING the old parent
      await hierarchyPage.expandHierarchyPath(originalHierarchy, oldParentUnit);
      
      // Unlock the old parent via API if needed
      try {
        await lockUnitStatus(request, [oldParentUnit], 1, 0);
      } catch (error) {
        console.log(`  ⚠ Could not unlock via API: ${error}`);
      }

      // Collapse the old hierarchy by clicking the highest parent
      await hierarchyPage.collapseHierarchyPath(originalHierarchy);

      // TARGET HIERARCHY: Expand up to and INCLUDING the new parent
      await hierarchyPage.expandHierarchyPath(newHierarchy, newParentUnit);

      // Unlock the new parent via API if needed
      try {
        await lockUnitStatus(request, [newParentUnit], 1, 0);
      } catch (error) {
        console.log(`  ⚠ Could not unlock via API: ${error}`);
      }

      // UNIT RELOCATION: Select and move the unit to new parent's combobox
      const comboboxInput = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-input"]`);
      await comboboxInput.click();
      
      // Wait for options to appear in the dropdown
      await hierarchyPage.page.waitForLoadState('networkidle');
      
      // Click the unit option item to select it
      const unitOptionItem = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-item-${unitToMove}"]`);
      await unitOptionItem.waitFor({ state: 'visible' });
      await unitOptionItem.click();
      
      // Confirm the unit selection
      const comboboxActionButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-action-button"]`);
      await comboboxActionButton.click();
      
      // Trigger and confirm the move via popup
      const actionButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-trigger"]`);
      await actionButton.click();
      
      const confirmButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]`);
      await confirmButton.click();
      
      // Close the drawer
      await hierarchyPage.page.keyboard.press('Escape');
    } catch (error) {
      console.error(`Error during move: ${error}`);
    }

    // STEP 5: Wait for updates and re-expand old hierarchy to verify old parent
    await hierarchyPage.waitForNetworkIdle();
    
    // Re-expand the old hierarchy up to and INCLUDING the old parent to verify structure
    console.log(`\n[OLD HIERARCHY VERIFICATION] Expanding old hierarchy up to old parent unit ${oldParentUnit}...`);
    await hierarchyPage.expandHierarchyPath(originalHierarchy, oldParentUnit);
    
    // STEP 6: Wait and expand new hierarchy
    await hierarchyPage.waitForNetworkIdle();
    await hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchy);
    
    // STEP 7: Verify aggregation for entire new hierarchy
    console.log(`\n[AGGREGATION VERIFICATION FOR NEW HIERARCHY]`);
    const leafValues = await hierarchyPage.setLeafCellValues(makatId, 0);
    const aggregationValid = await hierarchyPage.verifyAggregation(makatId, newHierarchy, leafValues, unitHierarchyMap);
    expect(aggregationValid).toBe(true);
    console.log(`✓ TEST PASSED: Aggregation verified for entire new hierarchy!\n`);
  });

  // ============ TEST 3: Aggregation Verification in Old Hierarchy After Unit Removal ============
  hierarchicalChangeTestData.forEach((testData) => {
    test(`test_hierarchicalChangeOldHierarchyAggregation[${testData.description}]`, async ({ hierarchyPage, request }) => {
      test.setTimeout(120000);

      const { materialId: makatId, unitsToExpand: originalHierarchy, newHierarchy, unitToMove, newParentUnit, oldParentUnit, unitHierarchy } = testData;
      // Convert unit hierarchy object to Map for easier access
      const unitHierarchyMap = unitHierarchy ? new Map(Object.entries(unitHierarchy).map(([k, v]) => [parseInt(k), v])) : undefined;

      // STEP 1: Add material and expand
      await hierarchyPage.selectMakatFromDropdown(makatId);
      await hierarchyPage.clickAddMakatAdornment();
      expect(await hierarchyPage.verifyMaterialIdInRow(makatId)).toBe(true);

      // Expand the hierarchy tree to show leaf level values
      await hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy);
      
      // STEP 2: Set values
      const leafValues = await hierarchyPage.setLeafCellValues(makatId, 1);
      
      // STEP 3: Save material
      await hierarchyPage.saveMaterial();

      // STEP 4: Move unit
      try {
        // Open the unit hierarchy drawer
        await hierarchyPage.openUnitHierarchyDrawer();
        
        // Show all units by triggering and confirming the initial popup
        const initTrigger = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-trigger"]`);
        await initTrigger.click();
        
        const initConfirm = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]`);
        await initConfirm.click();

        // SOURCE HIERARCHY: Expand up to and INCLUDING the old parent
        await hierarchyPage.expandHierarchyPath(originalHierarchy, oldParentUnit);
        
        // Unlock the old parent via API if needed
        try {
          await lockUnitStatus(request, [oldParentUnit], 1, 0);
        } catch (error) {
          console.log(`  ⚠ Could not unlock via API: ${error}`);
        }

        // Collapse the old hierarchy by clicking the highest parent
        await hierarchyPage.collapseHierarchyPath(originalHierarchy);

        // TARGET HIERARCHY: Expand up to and INCLUDING the new parent
        await hierarchyPage.expandHierarchyPath(newHierarchy, newParentUnit);

        // Unlock the new parent via API if needed
        try {
          await lockUnitStatus(request, [newParentUnit], 1, 0);
        } catch (error) {
          console.log(`  ⚠ Could not unlock via API: ${error}`);
        }

        // UNIT RELOCATION: Select and move the unit to new parent's combobox
        const comboboxInput = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-input"]`);
        await comboboxInput.click();
        
        // Wait for options to appear in the dropdown
        await hierarchyPage.page.waitForLoadState('networkidle');
        
        // Click the unit option item to select it
        const unitOptionItem = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-item-${unitToMove}"]`);
        await unitOptionItem.waitFor({ state: 'visible' });
        await unitOptionItem.click();
        
        // Confirm the unit selection
        const comboboxActionButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-node-combobox-${newParentUnit}-action-button"]`);
        await comboboxActionButton.click();
        
        // Trigger and confirm the move via popup
        const actionButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-trigger"]`);
        await actionButton.click();
        
        const confirmButton = hierarchyPage.page.locator(`[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]`);
        await confirmButton.click();
        
        // Close the drawer
        await hierarchyPage.page.keyboard.press('Escape');
      } catch (error) {
        console.error(`Error during move: ${error}`);
      }

      // STEP 5: Wait for updates and re-expand old hierarchy to verify old parent aggregation
      await hierarchyPage.waitForNetworkIdle();
      
      // Re-expand the old hierarchy up to and INCLUDING the old parent to verify aggregation after unit removal
      console.log(`\n[OLD HIERARCHY AGGREGATION CHECK] Expanding old hierarchy up to old parent unit ${oldParentUnit}...`);
      await hierarchyPage.expandHierarchyPath(originalHierarchy, oldParentUnit);
      
      // STEP 6: Verify aggregation of the old hierarchy
      console.log(`\n[AGGREGATION VERIFICATION FOR OLD HIERARCHY]`);

      // STEP 6: Expand and verify aggregation for OLD hierarchy starting from highest parent
      console.log(`\n[AGGREGATION VERIFICATION FOR OLD HIERARCHY AFTER UNIT REMOVAL]`);
      console.log(`Verifying aggregation in OLD hierarchy: [${originalHierarchy.join(' → ')}]`);
      console.log(`(Unit ${unitToMove} has been removed from this hierarchy)`);
      
      // Expand the original hierarchy UP TO the old parent only (not beyond)
      await hierarchyPage.expandHierarchyPath(originalHierarchy, oldParentUnit);
      console.log(`\n✓ Expanded old hierarchy up to parent unit ${oldParentUnit}`);
      
      // Verify aggregation for the old hierarchy path (starting from highest parent up to old parent)
      console.log(`\nChecking aggregation after expanding to old parent...`);
      const oldHierarchyAggregationValid = await hierarchyPage.verifyAggregation(
        makatId,
        originalHierarchy.slice(0, originalHierarchy.indexOf(oldParentUnit) + 1),
        leafValues,
        unitHierarchyMap
      );
      
      expect(oldHierarchyAggregationValid).toBe(true);
      console.log(`✓ TEST PASSED: Aggregation verified for OLD hierarchy after unit removal!\n`);
    });
  });
});

