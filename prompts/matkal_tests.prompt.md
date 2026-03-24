this is a test prompt for matkal user 


Test Scenario (The User Story):
Hooks: Use beforeEach to navigate to the "דרישות" page and ensure environment reset.

Test Steps:

Matkal Input: As Matkal, add an SKU (Makat) and input quantities for Hativah -> Ugda -> Pikud -> Matkal.

Aggregation Check: Assert that the Total Demand for the SKU correctly sums up the individual inputs.

Persistence & Switching:

Use switchView to move to a Pikud view.

Verify the numbers match exactly what was entered by Matkal.

Switch down to Ugda and Hativah levels and repeat the verification.

Drill-down Verification: Hover over a cell, click the "cell-controls-network" button, and verify that the modal shows the correct breakdown down to the Gedud level.

Expected Output:
Clean TypeScript code using Playwright Fixtures.

Robust assertions using expect.

Handling of hover actions for buttons visible only on mouse-over.

keep refactoring the test until it passes, is clean, efficient, and follows best practices for maintainability and readability.