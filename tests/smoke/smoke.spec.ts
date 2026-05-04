import { test, expect } from '../../src/fixtures';
import smokeData from '../../src/testData/smokeData.json';

const { makatValidationTestData, hierarchyExpansionTestData, leafCellClickabilityTestData, saveFunctionalityTestData, commentFunctionalityTestData, deleteMakatTestData } = smokeData;


// ============ Smoke Test 1: Makat Table Validation ============
makatValidationTestData.forEach((testData) => {
  test(
    `makatValidationTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      try {
        // Add material from dropdown
        await hierarchyPage.addMakatFromDropdown(testData.materialId);
        
        // Verify material was added to the table
        const makatAdded = await hierarchyPage.verifyMaterialIdInRow(testData.materialId);
        expect(makatAdded).toBe(true);
        console.log(`✓ Material ${testData.materialId} successfully added to table`);
      } catch (error) {
        console.error(`✗ Test failed: ${error}`);
        throw error;
      }
    }
  );
});

// ============ Smoke Test 2: Hierarchy Expansion ============
hierarchyExpansionTestData.forEach((testData) => {
  test(
    `hierarchyExpansionTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      // Select material from dropdown and add it
      await hierarchyPage.addMakatFromDropdown(testData.materialId);
      
      // Expand hierarchy through the specified path
      await hierarchyPage.expandHierarchyToLeaf(
        testData.materialId,
        testData.unitsToExpand
      );
      console.log(`✓ Hierarchy expanded through path: [${testData.unitsToExpand.join(' → ')}]`);
    }
  );
});

// ============ Smoke Test 3: Leaf Cell Clickability ============
leafCellClickabilityTestData.forEach((testData) => {
  test(
    `leafCellClickabilityTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      // Select material from dropdown and add it
      await hierarchyPage.addMakatFromDropdown(testData.materialId);
      
      // Expand hierarchy
      await hierarchyPage.expandHierarchyToLeaf(testData.materialId, testData.unitsToExpand);
      
      // Set values in leaf cells
      const leafValues = await hierarchyPage.setLeafCellValues(testData.materialId, testData.unitsToExpand, 1);
      expect(leafValues.size).toBeGreaterThan(0);
      console.log(`✓ Successfully set values in ${leafValues.size} leaf cells`);
    }
  );
});


// ============ Smoke Test 4: Save Functionality ============
saveFunctionalityTestData.forEach((testData) => {
  test(
    `saveFunctionalityTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      try {
        // Select material from dropdown and add it
        await hierarchyPage.addMakatFromDropdown(testData.materialId);
        
        // Expand hierarchy
        await hierarchyPage.expandHierarchyToLeaf(testData.materialId, testData.unitsToExpand);
        
        // Set values in leaf cells
        await hierarchyPage.setLeafCellValues(testData.materialId, testData.unitsToExpand, testData.testValue);
        
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

// ============ Smoke Test 5: Delete Makat Functionality ============
deleteMakatTestData.forEach((testData) => {
  test(
    `deleteMakatTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      try {
        // Step 1: Add material from dropdown
        await hierarchyPage.addMakatFromDropdown(testData.materialId);
        
        // Step 2: Verify material was added to the table
        let makatExists = await hierarchyPage.verifyMaterialIdInRow(testData.materialId);
        expect(makatExists).toBe(true);
        console.log(`✓ Material ${testData.materialId} successfully added to table`);
        
        // Step 3: Delete the material using the POM method
        const deleteSuccess = await hierarchyPage.deleteMakat(testData.materialId);
        expect(deleteSuccess).toBe(true);
        console.log(`✓ Material ${testData.materialId} delete initiated successfully`);
        
        // Step 4: Verify material was deleted from the table
        makatExists = await hierarchyPage.verifyMaterialIdInRow(testData.materialId);
        expect(makatExists).toBe(false);
        console.log(`✓ Material ${testData.materialId} successfully deleted from table`);
      } catch (error) {
        console.error(`✗ Delete test failed: ${error}`);
        throw error;
      }
    }
  );
});


// לשנות ליוזר של פיקוד 
// ============ Smoke Test 6: Comment Functionality ============
// commentFunctionalityTestData.forEach((testData) => {
//   test(
//     `smoke_commentFunctionality[${testData.description}]`,
//     async ({ hierarchyPage }) => {
//       try {
//         // Select material from dropdown and add it
//         await hierarchyPage.addMakatFromDropdown(testData.materialId);
        
//         // Open the comment dialog for this material
//         const dialogOpened = await hierarchyPage.openCommentDialog(testData.materialId);
//         expect(dialogOpened).toBe(true);
        
//         // Add comment to the material
//         const commentAdded = await hierarchyPage.addCommentToMaterial(testData.materialId, testData.commentText);
//         expect(commentAdded).toBe(true);
        
//         // Save the comment
//         const commentSaved = await hierarchyPage.saveComment(testData.materialId);
//         expect(commentSaved).toBe(true);
        
//         // Close the dialog
//         await hierarchyPage.closeCommentDialog();
        
//         // Re-open the comment dialog to verify the comment was saved
//         const commentExists = await hierarchyPage.verifyCommentExists(testData.materialId, testData.commentText);
//         expect(commentExists).toBe(true);
        
//         console.log(`✓ Comment functionality verified: Comment "${testData.commentText}" saved and retrieved successfully`);
//       } catch (error) {
//         console.error(`✗ Comment test failed: ${error}`);
//         throw error;
//       }
//     }
//   );
// });
