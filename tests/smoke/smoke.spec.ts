import { test, expect } from '../../src/fixtures';
import { withPhase } from '../../src/fixtures/withPhase';
import regularTestsData from '../../src/testData/regularTestsData.json';

const { makatValidationTestData, hierarchyExpansionTestData, leafCellClickabilityTestData, saveFunctionalityTestData, commentFunctionalityTestData, deleteMakatTestData } = regularTestsData;


// ============ Smoke Test 1: Makat Table Validation ============
makatValidationTestData.forEach((testData) => {
  test(
    `makatValidationTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      const ctx = { makatId: testData.materialId };
      await withPhase('Add makat from dropdown', ctx, () =>
        hierarchyPage.addMakatFromDropdown(testData.materialId),
      );
      const makatAdded = await withPhase('Verify material in row', ctx, () =>
        hierarchyPage.verifyMaterialIdInRow(testData.materialId),
      );
      expect(
        makatAdded,
        `[ASSERTION: makat-not-in-row] Material ${testData.materialId} was not found in the table after being added from the dropdown.`,
      ).toBe(true);
      console.log(`✓ Material ${testData.materialId} successfully added to table`);
    }
  );
});

// ============ Smoke Test 2: Hierarchy Expansion ============
hierarchyExpansionTestData.forEach((testData) => {
  test(
    `hierarchyExpansionTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      const ctx = {
        makatId: testData.materialId,
        unitsToExpand: testData.unitsToExpand,
      };
      await withPhase('Add makat from dropdown', ctx, () =>
        hierarchyPage.addMakatFromDropdown(testData.materialId),
      );
      await withPhase('Expand hierarchy to leaf', ctx, () =>
        hierarchyPage.expandHierarchyToLeaf(
          testData.materialId,
          testData.unitsToExpand,
        ),
      );
      console.log(
        `✓ Hierarchy expanded through path: [${testData.unitsToExpand.join(' → ')}]`,
      );
    }
  );
});

// ============ Smoke Test 3: Leaf Cell Clickability ============
leafCellClickabilityTestData.forEach((testData) => {
  test(
    `leafCellClickabilityTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      const ctx = {
        makatId: testData.materialId,
        unitsToExpand: testData.unitsToExpand,
      };
      await withPhase('Add makat from dropdown', ctx, () =>
        hierarchyPage.addMakatFromDropdown(testData.materialId),
      );
      await withPhase('Expand hierarchy to leaf', ctx, () =>
        hierarchyPage.expandHierarchyToLeaf(
          testData.materialId,
          testData.unitsToExpand,
        ),
      );
      const leafValues = await withPhase('Set leaf cell values', ctx, () =>
        hierarchyPage.setLeafCellValues(
          testData.materialId,
          testData.unitsToExpand,
          1,
        ),
      );
      expect(
        leafValues.size,
        `[ASSERTION: no-leaf-cells-set] setLeafCellValues did not set any cells for material ${testData.materialId} on path [${testData.unitsToExpand.join(' → ')}].`,
      ).toBeGreaterThan(0);
      console.log(`✓ Successfully set values in ${leafValues.size} leaf cells`);
    }
  );
});


// ============ Smoke Test 4: Save Functionality ============
saveFunctionalityTestData.forEach((testData) => {
  test(
    `saveFunctionalityTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      const ctx = {
        makatId: testData.materialId,
        unitsToExpand: testData.unitsToExpand,
        testValue: testData.testValue,
      };
      await withPhase('Add makat from dropdown', ctx, () =>
        hierarchyPage.addMakatFromDropdown(testData.materialId),
      );
      await withPhase('Expand hierarchy to leaf', ctx, () =>
        hierarchyPage.expandHierarchyToLeaf(
          testData.materialId,
          testData.unitsToExpand,
        ),
      );
      await withPhase('Set leaf cell values', ctx, () =>
        hierarchyPage.setLeafCellValues(
          testData.materialId,
          testData.unitsToExpand,
          testData.testValue,
        ),
      );
      await withPhase('Save material', ctx, () => hierarchyPage.saveMaterial());

      let isMaterialInRow = await withPhase(
        'Verify material in row after save',
        ctx,
        () => hierarchyPage.verifyMaterialIdInRow(testData.materialId),
      );
      expect(
        isMaterialInRow,
        `[ASSERTION: makat-missing-after-save] Material ${testData.materialId} disappeared from the table after Save was clicked.`,
      ).toBe(true);
      console.log(`✓ Material still visible after save`);

      await withPhase('Reload page after save', ctx, async () => {
        await hierarchyPage.page.reload();
        await hierarchyPage.page.waitForLoadState('networkidle');
      });

      isMaterialInRow = await withPhase(
        'Verify material in row after reload',
        ctx,
        () => hierarchyPage.verifyMaterialIdInRow(testData.materialId),
      );
      expect(
        isMaterialInRow,
        `[ASSERTION: makat-not-persisted] Material ${testData.materialId} did NOT persist after page reload — save was not committed to the backend.`,
      ).toBe(true);
      console.log(
        `✓ Save functionality verified: Material ${testData.materialId} persisted after page reload`,
      );
    }
  );
});

// ============ Smoke Test 5: Delete Makat Functionality ============
deleteMakatTestData.forEach((testData) => {
  test(
    `deleteMakatTestData[${testData.description}]`,
    async ({ hierarchyPage }) => {
      const ctx = { makatId: testData.materialId };
      await withPhase('Add makat from dropdown', ctx, () =>
        hierarchyPage.addMakatFromDropdown(testData.materialId),
      );
      let makatExists = await withPhase(
        'Verify material in row after add',
        ctx,
        () => hierarchyPage.verifyMaterialIdInRow(testData.materialId),
      );
      expect(
        makatExists,
        `[ASSERTION: makat-not-in-row] Material ${testData.materialId} was not in the table after being added (pre-delete check).`,
      ).toBe(true);
      console.log(`✓ Material ${testData.materialId} successfully added to table`);

      const deleteSuccess = await withPhase('Delete makat', ctx, () =>
        hierarchyPage.deleteMakat(testData.materialId),
      );
      expect(
        deleteSuccess,
        `[ASSERTION: delete-action-failed] deleteMakat returned false for material ${testData.materialId} — the delete UI action did not complete successfully.`,
      ).toBe(true);
      console.log(`✓ Material ${testData.materialId} delete initiated successfully`);

      makatExists = await withPhase(
        'Verify material removed from row',
        ctx,
        () => hierarchyPage.verifyMaterialIdInRow(testData.materialId),
      );
      expect(
        makatExists,
        `[ASSERTION: makat-still-present-after-delete] Material ${testData.materialId} is still in the table after a successful delete action.`,
      ).toBe(false);
      console.log(`✓ Material ${testData.materialId} successfully deleted from table`);
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
