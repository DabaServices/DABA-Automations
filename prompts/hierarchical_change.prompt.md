Agent Prompt: Hierarchical Change Automation Logic
Role: You are an expert Automation Engineer using Playwright and TypeScript.
Task: Explore the UI using Playwright MCP and implement/update tests for the "Hierarchical Change" (שינוי היררכי) feature based on the following business logic.

1. Navigation & Context Discovery
Use Playwright MCP to navigate to the system (default: http://localhost:5173/committees) and identify the following components:


The Hierarchy View/Tree where units (Matkal, Pikud, Ugda, Hativa, Gdud) are displayed.

The Search/Add/Remove/Move buttons and context menus for units.

The Status Indicators (Locked/Unlocked/Dispatched).

2. Core Business Rules to Validate
Implement tests that enforce these constraints. Use the MCP to find exact selectors for buttons like "Add", "Remove", "Move", and "Dispatch" (שיגור).

Rule 1: Internal Boundary ("In the house" only): Units cannot be "stolen" from another branch. A unit can only be moved within its own parent's hierarchy.

Rule 2: Level-Based Restrictions:

An Ugda cannot move Hativas from another unit but can add a Gdud directly under itself.

Validate that hierarchical levels are respected (e.g., cannot add a higher-level unit under a lower-level one).

Rule 3: Locking & Status Locks:

Blocked Action: If a parent unit is Locked (נעול), its children cannot be moved or removed.

Blocked Destination: You cannot add or move a unit to a parent that is already Locked.

Phase Block: Hierarchical changes are strictly forbidden during the Allocations (הקצאות) phase.

Rule 4: Aggregation Integrity:

If a unit is removed, its status must be reset.

If a unit is moved, its reporting records must be updated to reflect the new parent.

3. Concurrency & Real-time Validation (Technical Specs)
The system must handle race conditions. Ensure the test verifies these "Toast" messages or error states:

Missing Parent: On Save/Dispatch, if the parent was removed by another user, verify the message: "The association of unit X has been removed from the system."

Structure Change: If the children composition changed while the user was active, verify the message: "The structure of your subordinate units has changed, please refresh."

Locked Child: On Dispatch, ensure all children are locked. If a child was removed mid-process, verify: "Unit X was removed, change not saved."

4. Technical Implementation Instructions
Exploration Phase: Use browser_navigate and screenshot to map the hierarchy screen. Find selectors for the "Unit Changer Combobox" and the "Right Header Committee Button" (data-testid="committees-header-right").

POM Refactor: Based on your discovery, update the CommitteesPage.ts (or relevant POM file). Ensure methods for moveUnit, removeUnit, and addUnit handle the logic described.

Test Scenarios: - Scenario A: Attempt to move a Gdud under a locked Hativa (Expected: Action Blocked).

Scenario B: Move a Gdud from Hativa A to Hativa B and verify aggregation numbers update after "Dispatch".

Scenario C: Simulate a missing parent (via DB/API if possible, or UI flow) and verify the concurrency toast.

Constraints:

Use TypeScript and Page Object Model.

Prioritize ARIA roles and data-testids for selectors.

Verify that incomplete hierarchies (e.g., a Hativa with no Gdud) appear in search but not in reports.


remmeber\, write the test with parameters, all unit 3 . unit 2 . unit 12 are parameters friom test data you will create

before changing hirarcy 
remmber the values of unit 12 and its leafs (children)

change hirarcy
the data test IDs:
unit-hierarchy-header-tabs-indicator - opening the side tree 
data-testid="unit-hierarchy-header-confirmation-popup-trigger" - opening all the units - , click ״אישור״
unit-hierarchy-row-expand-tooltip-3-trigger - for the test i am creating open unit 3 - click
unit-hierarchy-node-combobox-3-input - 
from the dropdown choose unit 12
unit-hierarchy-node-combobox-3-action-button - click 

after changing hirarcy
unit-hierarchy-header-confirmation-popup-trigger. -click to close all units  
click outside the popup to close it, 
open the hirarcy of unit 3, see that unit 12 is there, the values it halds are correct(values we set int unit 2 before the hierarchical change ) ,and that the aggrigation is correct

import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:5173/committees');
  await page.getByTestId('cell-controls-network-m0000001-2').click();
  await page.getByTestId('cell-controls-network-m0000001-12').click();
  await page.getByTestId('cell-controls-network-m0000001-52').click();
  await page.getByTestId('numbered-cell-m0000001-202-increment').click();
  await page.getByTestId('numbered-cell-m0000001-202-increment').click();
  await page.getByTestId('numbered-cell-m0000001-202-increment').click();
  await page.getByTestId('numbered-cell-m0000001-352-increment').click();
  await page.getByTestId('numbered-cell-m0000001-352-increment').click();
  await page.getByTestId('numbered-cell-m0000001-352-increment').click();
  await page.getByTestId('save-button-tooltip-trigger').click();
  await page.getByTestId('unit-hierarchy-drawer-trigger').click();
  await page.getByTestId('unit-hierarchy-header-confirmation-popup-trigger').click();
  await page.getByTestId('unit-hierarchy-header-confirmation-popup-confirm-button').click();
  await page.getByTestId('unit-hierarchy-row-expand-tooltip-3-trigger').click();
  await page.getByTestId('unit-hierarchy-node-combobox-3-input').click();
  await page.getByTestId('unit-hierarchy-node-combobox-3-item-12').click();
  await page.getByTestId('unit-hierarchy-node-combobox-3-action-button').click();
  await page.getByTestId('unit-hierarchy-header-confirmation-popup-trigger').click();
  await page.getByTestId('unit-hierarchy-header-confirmation-popup-confirm-button').click();
  await page.getByTestId('unit-hierarchy-drawer-backdrop').click();
  await page.getByTestId('cell-controls-network-m0000001-3').click();
  await page.getByTestId('cell-controls-network-m0000001-12').click();
  await page.getByTestId('cell-controls-network-m0000001-52').click();
});