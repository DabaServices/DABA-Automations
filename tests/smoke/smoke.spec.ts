import { test, expect } from '../../src/fixtures';
import smokeData from '../../src/testData/smokeData.json';
import { lockCompleteHierarchy } from '../../src/api/apiHelpers';

const { makatValidationTestData, hierarchyExpansionTestData, leafCellClickabilityTestData, saveFunctionalityTestData, commentFunctionalityTestData } = smokeData;

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
    async ({ hierarchyPage, page, request }) => {
      try {
        // Lock default test units at the start
        await lockCompleteHierarchy(request, [10, 2, 3, 4, 5, 6, 7, 8, 9]);
        await hierarchyPage.page.reload();
        await hierarchyPage.page.waitForLoadState('networkidle');

        // Add material from dropdown
        await hierarchyPage.addMakatFromDropdown(testData.materialId);
        
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
    async ({ hierarchyPage, page, request }) => {
      try {
        // Lock default test units at the start
        await lockCompleteHierarchy(request, [10, 2, 3, 4, 5, 6, 7, 8, 9]);
        await hierarchyPage.page.reload();
        await hierarchyPage.page.waitForLoadState('networkidle');

        // Select material from dropdown and add it
        await hierarchyPage.addMakatFromDropdown(testData.materialId);
        
        // Expand hierarchy through the specified path
        await hierarchyPage.expandHierarchyToLeaf(
          testData.materialId,
          testData.unitsToExpand
        );
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
    async ({ hierarchyPage, request }) => {
      // Lock default test units at the start
      await lockCompleteHierarchy(request, [10, 2, 3, 4, 5, 6, 7, 8, 9]);
      await hierarchyPage.page.reload();
      await hierarchyPage.page.waitForLoadState('networkidle');

      // Select material from dropdown and add it
      await hierarchyPage.addMakatFromDropdown(testData.materialId);
      
      // Expand hierarchy
      await hierarchyPage.expandHierarchyToLeaf(testData.materialId, testData.unitsToExpand);
      
      // Set values in leaf cells
      const leafValues = await hierarchyPage.setLeafCellValues(testData.materialId, 1);
      expect(leafValues.size).toBeGreaterThan(0);
      console.log(`✓ Successfully set values in ${leafValues.size} leaf cells`);
    }
  );
});






// ============ Smoke Test 4: Save Functionality ============
saveFunctionalityTestData.forEach((testData) => {
  test(
    `smoke_saveFunctionality[${testData.description}]`,
    async ({ hierarchyPage, request }) => {
      // Lock default test units at the start
      await lockCompleteHierarchy(request, [10, 2, 3, 4, 5, 6, 7, 8, 9]);
      await hierarchyPage.page.reload();
      await hierarchyPage.page.waitForLoadState('networkidle');

      try {
        // Select material from dropdown and add it
        await hierarchyPage.addMakatFromDropdown(testData.materialId);
        
        // Expand hierarchy
        await hierarchyPage.expandHierarchyToLeaf(testData.materialId, testData.unitsToExpand);
        
        // Set values in leaf cells
        await hierarchyPage.setLeafCellValues(testData.materialId, testData.testValue);
        
        // Save material - this clicks the save button and waits for network idle
        await hierarchyPage.saveMaterial();
        
        // Verify save worked by checking material is still visible after save
        let isMaterialInRow = await hierarchyPage.verifyMaterialIdInRow(testData.materialId);
        expect(isMaterialInRow).toBe(true);
        console.log(`✓ Material still visible after save`);
        
        // Strong verification: Reload the page and check if material still appears
        // This proves the save actually persisted to the database
        await hierarchyPage.page.reload();
        await hierarchyPage.page.waitForLoadState('networkidle');
        
        // After reload, verify the material is still in the table
        isMaterialInRow = await hierarchyPage.verifyMaterialIdInRow(testData.materialId);
        expect(isMaterialInRow).toBe(true);
        console.log(`✓ Save functionality verified: Material ${testData.materialId} persisted after page reload`);
      } catch (error) {
        console.error(`✗ Save test failed: ${error}`);
        throw error;
      }
    }
  );
});

// ============ Smoke Test 5: Comment Functionality ============
commentFunctionalityTestData.forEach((testData) => {
  test(
    `smoke_commentFunctionality[${testData.description}]`,
    async ({ hierarchyPage, request }) => {
      // Lock default test units at the start
      await lockCompleteHierarchy(request, [10, 2, 3, 4, 5, 6, 7, 8, 9]);
      await hierarchyPage.page.reload();
      await hierarchyPage.page.waitForLoadState('networkidle');

      try {
        // Select material from dropdown and add it
        await hierarchyPage.addMakatFromDropdown(testData.materialId);
        
        // Open the comment dialog for this material
        const dialogOpened = await hierarchyPage.openCommentDialog(testData.materialId);
        expect(dialogOpened).toBe(true);
        
        // Add comment to the material
        const commentAdded = await hierarchyPage.addCommentToMaterial(testData.materialId, testData.commentText);
        expect(commentAdded).toBe(true);
        
        // Save the comment
        const commentSaved = await hierarchyPage.saveComment(testData.materialId);
        expect(commentSaved).toBe(true);
        
        // Close the dialog
        await hierarchyPage.closeCommentDialog();
        
        // Wait a moment for dialog to fully close
        await hierarchyPage.page.waitForTimeout(500);
        
        // Re-open the comment dialog to verify the comment was saved
        const commentExists = await hierarchyPage.verifyCommentExists(testData.materialId, testData.commentText);
        expect(commentExists).toBe(true);
        
        console.log(`✓ Comment functionality verified: Comment "${testData.commentText}" saved and retrieved successfully`);
      } catch (error) {
        console.error(`✗ Comment test failed: ${error}`);
        throw error;
      }
    }
  );
});


