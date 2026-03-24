"This is raw code for an item creation flow. Please refactor it into the second test you previously wrote.

Important Requirements:

Validation: Note that this raw code lacks data integrity checks. I want you to add assertions to verify all relevant fields whenever there is a change in the quantity/amount.

Aggregation: Ensure that the aggregation logic works correctly and all numerical data is accurate.

End-to-End Verification: At the end of the test, verify that the numerical data entered in the SKU matches the data displayed on the screen after the 'Dispatch' (שיגור) action and the transition to 'Unit 2'.
some of the clicks in the code were made by mistake, please remove them and add the correct ones to reflect the actual user flow.

remember that i want to test this on several SKUs, so make sure to parameterize the test to allow for different SKUs and their corresponding expected values.

Please follow the existing Page Object Model (POM) structure in my project for this refactor."

import { test, expect } from '@playwright/test';

timport { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:5173/committees');
  await page.getByTestId('material-search-combobox-input').click();
  await page.getByTestId('material-search-combobox-item-id-m0000002-description-mat-00000002-centerid-2-sectionid-2-unitofmeasurement-multiply-2-recordstatus-active-type-fin-materialcategory-materialid-m0000002-maincategory-description-main-category-2-nickname-unitfavorites-materialid-m0000002-unitofmeasure-category-main-category-2-favorite-true-comment').click();
  await page.getByTestId('material-search-combobox-start-adornment').click();
  await page.getByTestId('cell-controls-network-m0000002-2').click();
  await page.getByTestId('cell-controls-network-m0000002-12').click();
  await page.getByTestId('cell-controls-network-m0000002-52').click();
  await page.getByTestId('numbered-cell-m0000002-202-increment').click();
  await page.getByTestId('numbered-cell-m0000002-202-increment').click();
  await page.getByTestId('numbered-cell-m0000002-202-increment').click();
  await page.getByTestId('numbered-cell-m0000002-352-increment').click();
  await page.getByTestId('launch-button-tooltip-trigger').click();
  await page.getByTestId('unit-changer-combobox-input').click();
  await page.getByTestId('unit-changer-combobox-item-description-unit-2-id-2-level-1-simul-tic0000002-isemergencyunit-true-status-id-1-description-parent-description-root-unit-id-1-level-0-simul-tic0000001-status-id-0-description').click();
  await page.getByTestId('row-cell-m0000002-12').click();
  await page.getByTestId('cell-controls-network-m0000002-12').click();
  await page.getByTestId('cell-controls-network-m0000002-52').click();
});