Prompt for AI Automation Agent: Hierarchical Supply System
Role: Senior Automation Engineer.
Tooling: Playwright, TypeScript, POM.
Architecture Requirements: Use Test Fixtures for Page Objects and Hooks (beforeEach, afterEach) for setup/teardown.

Important: Selector Precedence Rule
You must scan the page and identify the actual data-testid attributes. If there is a naming mismatch between the IDs provided in this text and what is found on the live page, the names on the page take precedence.
you have access to the frontend and backend of the system, so you can verify the selectors and their functionality directly.
scan the frontend and backend to confirm the presence and functionality of the specified selectors before implementing the test code. If any discrepancies are found, update the selectors in the POM accordingly to ensure accurate interaction with the elements on the page.

System Context & Logic:
The system manages logistics across 5 levels: Gedud -> Hativah -> Ugda -> Pikud -> Matkal.

Pages: Usage, Inventory, Demands (Requirements), Allocations.

Logic: Quantities at a higher level must be the mathematical sum of the units below it.

Submission: Reporting "שגר" (Submit) locks the unit.

Drill-down: Accessing granular data via hover on [data-testid^="cell-controls-network......"].

Specific Task Instructions:
1. if necessary Define the Fixture (test-options.ts):
Create a custom fixture to initialize the SupplyPage POM.

Include a login fixture for session setup to the Hativah -> Ugda -> Pikud -> Matkal view. dont use it in the code yet,
it is just for future use when we need to test the login functionality. For now, we will assume the user is already
logged in as matkal.

2. Implement the Page Object Model (POM):
Selectors (Scan page to confirm):

rootUnitSwitcher: [data-testid="unit-changer-combobox-input-wrapper"]

statusSidebar: [data-testid="committees-header-right"]

drillDownBtn: [data-testid^="cell-controls-network"]

Methods:

switchView(unitName: string): Change perspective via the root unit switcher.

setQuantity(makatId: string, unitColumn: string, value: number): Interact with +/- or inputs.

verifyAggregation(makatId: string, subordinates: string[]): Assert that the sum of subordinates equals the total.

* add more selectors and methods as needed based on the page structure and interactions.


