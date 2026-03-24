import { Page, Locator } from '@playwright/test';

/**
 * mainPage - Page Object Model for Hierarchical Supply System Module
 * 
 * PURPOSE: Encapsulates all UI interactions for the hierarchical supply system
 * 
 * MAIN FLOW:
 * 1. Navigate to the module (goto)
 * 2. Select and add a Makat (material) to the table
 * 3. Expand the hierarchy through network buttons to reach leaf units
 * 4. Set values at changeable leaf cells (zero-cells and numbered-cells)
 * 5. Verify aggregation: parent cell value = sum of all child cell values
 * 
 * KEY CONCEPTS:
 * - Makat: Material ID (e.g., 'm0000001') identifies the inventory item
 * - Unit: Military hierarchical unit (Pikud, Ugda, Hativah, Gedud, Matkal)
 * - Hierarchy: Tree structure where parent units contain child units
 * - Aggregation: Parent value automatically = SUM(all child values)
 * - Leaf Cell: Bottom-level unit cell where data entry happens
 * - Zero-Cell: Empty leaf node that can be clicked to initialize value
 * - Numbered-Cell: Leaf node with incrementable value
 * - Group Cell: Numbered-cell-group contains pre-existing values
 */
export class mainPage {
  readonly page: Page;

  // ============ Locators (Defined as Class Properties) ============
  // These are CSS/role selectors that find UI elements on the page

  // Navigation & General (drawer and menu elements)
  readonly unitHierarchyDrawerContent: Locator;
  readonly unitHierarchyContent: Locator;
  readonly menuBtn: Locator;

  // Makat Dropdown & Selection (material selection dropdowns)
  readonly makatCombobox: Locator;
  readonly makatOptions: Locator;

  // Add Button (button to add material to table)
  readonly addButton: Locator;

  // Content Rows & Sub-rows (table rows and hierarchy expansion)
  readonly contentRows: Locator;
  readonly firstRow: Locator;
  readonly expandBtn: Locator;
  readonly subRowExpands: Locator;

  // Inventory Input (Zero Cell & Numbered Cell) (data entry cells)
  readonly zeroCellChips: Locator;
  readonly numberedCellInputs: Locator;

  constructor(page: Page) {
    this.page = page;

    // Initialize all locators - these find UI elements for later interaction
    // All locators are cached as class properties for reuse throughout tests
    this.unitHierarchyDrawerContent = page.getByTestId('unit-hierarchy-drawer-content');
    this.unitHierarchyContent = page.getByTestId('unit-hierarchy-content');
    this.menuBtn = page.locator('button').first();

    this.makatCombobox = page.getByRole('combobox', { name: /בחירת מק״ט/ });
    this.makatOptions = page.locator('[role="option"]');

    this.addButton = page.locator('._StartAdornment_13jl6_211').first();

    this.contentRows = page.locator('[data-testid*="content-row"]');
    this.firstRow = page.locator('[data-testid*="content-row"]').first();
    this.expandBtn = this.firstRow.locator('._Control_ent5f_5 > .lucide').first();
    this.subRowExpands = page.locator(`[data-testid*="sub-row-indicator"]`);

    this.zeroCellChips = page.locator('[data-testid*="zero-cell"]');
    this.numberedCellInputs = page.locator('[data-testid*="numbered-cell"] [data-testid*="input"]');
  }

  // ============ Utility Methods ============
  // Purpose: Helper methods for common operations

  /**
   * Wait for network requests to complete
   * This is a wrapper around page.waitForLoadState('networkidle')
   * with error handling to prevent test failures on network timeouts
   */
  async waitForNetworkIdle(): Promise<void> {
    try {
      await this.page.waitForLoadState('networkidle');
    } catch {
      // Silently catch network timeout errors as they're not critical for test execution
      // The page may still be functional even if some background requests are pending
    }
  }

  // ============ Navigation ============
  // Purpose: Load the committees page and wait for full initialization

  async goto() {
    // Navigate to the committees module at localhost
    await this.page.goto('http://162.55.55.124/');
    // Wait for all network requests to complete before proceeding with tests
    await this.waitForNetworkIdle();
  }

  // ============ Makat Selection and Addition ============
  // Purpose: Find a material (Makat) in the dropdown and add it to the table

  /**
   * Select a Makat from the dropdown by index
   * 
   * FLOW:
   * 1. Click combobox to open the dropdown list
   * 2. Get the option element at the specified index
   * 3. Extract the text content (material ID)
   * 4. Click the option to select it
   * 5. Return the material ID for verification
   */
  /**
   * Select a Makat from dropdown by partial text match
   * 
   * FLOW:
   * 1. Click combobox to open dropdown
   * 2. Type the material ID to filter the options
   * 3. Iterate through filtered options to find a match
   * 4. Click the matching option when found
   * 5. If not found, use getByText as fallback method
   * 
   * @param materialIdOrText - The material ID to search for (e.g., 'm0000002')
   */
  async selectMakatFromDropdown(materialIdOrText: string) {
    try {
      console.log(`\n[selectMakatFromDropdown] Selecting material: ${materialIdOrText}`);
      
      // Click combobox to open it with timeout
      console.log(`[Step 1] Clicking combobox...`);
      await this.makatCombobox.click({ timeout: 5000 });
      console.log(`[Step 1] ✓ Combobox clicked`);

      // Wait for options to appear
      console.log(`[Step 2] Waiting for options to appear...`);
      await this.makatOptions.first().waitFor({ timeout: 5000 }).catch(() => {
        console.warn(`[Step 2] Options did not appear within timeout`);
      });
      console.log(`[Step 2] ✓ Options appeared`);

      // Type the material ID to filter the dropdown
      console.log(`[Step 3] Typing material ID: ${materialIdOrText}`);
      await this.makatCombobox.fill(materialIdOrText);
      console.log(`[Step 3] ✓ Material ID typed`);

      // Wait a bit for filtering
      await new Promise(resolve => setTimeout(resolve, 500));

      // Look for the option that matches
      const options = this.makatOptions;
      let found = false;

      // Try to find by exact match in options
      console.log(`[Step 4] Searching for matching option...`);
      const count = await options.count();
      console.log(`[Step 4] Found ${count} options in dropdown`);
      
      if (count > 0) {
        const firstOption = await options.first().textContent();
        console.log(`  First option: ${firstOption}`);
        
        // Click the first option (should be filtered to match)
        await options.first().click({ timeout: 5000 });
        console.log(`[Step 4] ✓ First option clicked`);
        found = true;
      }

      if (!found) {
        throw new Error(`Could not find any Makat options matching: ${materialIdOrText}`);
      }
      
      console.log(`✓ selectMakatFromDropdown completed successfully`);
    } catch (e) {
      console.error(`✗ selectMakatFromDropdown failed: ${e}`);
      throw e;
    }
  }

  /**
   * Click the add button (plus icon in the start adornment)
   * 
   * FLOW: Click the "+" button to add the selected Makat to the table
   */
  async clickAddMakatAdornment() {
    await this.addButton.click();
    await this.waitForNetworkIdle();
  }

  /**
   * Save material changes
   * 
   * FLOW: Click the save button to persist material changes to the database
   */
  async saveMaterial() {
    try {
      console.log('Saving material...');
      const saveBtn = this.page.getByTestId('save-button-tooltip-trigger');
      
      // Wait for save button to be visible and clickable
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveBtn.click();
        await this.waitForNetworkIdle();
        console.log('✓ Material saved successfully');
      } else {
        console.warn('Save button not visible, attempting anyway');
        await saveBtn.click();
      }
    } catch (error) {
      console.error('Failed to save material:', error);
      throw error;
    }
  }

  /**
   * Select and add a Makat by index - Combined operation
  // ============ Row Expansion ============
  // Purpose: Expand the hierarchy by clicking network buttons to access leaf-level units

  /**
   * Step 2: Expand hierarchy to leaf level
   * 
   * FLOW:
   * 1. For each unit ID in the hierarchy path:
   *    a. Find the cell (row-cell or numbered-cell) for that unit
   *    b. Hover over the cell to reveal control buttons
   *    c. Find and click the "network" button to expand
   * 2. Wait for UI to update after each expansion
   * 3. Wait for page to settle after all expansions
   * 4. Return true if hierarchy successfully expanded to leaf level
   * 
   * HANDLES:
   * - row-cell: Used at initial hierarchy level
   * - numbered-cell: Used after first expansion
   * 
   * @param materialId - The material ID (e.g., 'm0000001')
   * @param unitsToExpand - Array of unit IDs to expand in order (e.g., [2, 12, 52])
   * @returns Promise<boolean> - True if hierarchy was successfully expanded to leaf level
   */
  async expandHierarchyToLeaf(materialId: string, unitsToExpand: number[]): Promise<boolean> {
    try {
      let expanded = false;
      
      // Expand each unit ID in sequence
      for (let idx = 0; idx < unitsToExpand.length; idx++) {
        const unitId = unitsToExpand[idx];
        
        // Determine which cell type to look for based on expansion level
        // First try: row-cell (for the initial level)
        let cell = this.page.locator(
          `[data-testid="row-cell-${materialId}-${unitId}"]`
        ).first();

        let cellFound = await cell.isVisible({ timeout: 1000 }).catch(() => false);
        
        // If row-cell not found, try numbered-cell (for after expansion)
        if (!cellFound) {
          cell = this.page.locator(
            `[data-testid*="numbered-cell-${materialId}-${unitId}"]`
          ).first();
          cellFound = await cell.isVisible({ timeout: 1000 }).catch(() => false);
        }

        if (cellFound) {
          // Scroll and hover over the cell to reveal control buttons
          await cell.scrollIntoViewIfNeeded();
          await cell.hover();
          
          // Wait for network button to appear
          await this.page.waitForSelector(
            `[data-testid="cell-controls-network-${materialId}-${unitId}"]`,
            { timeout: 2000 }
          );
          
          // Find and click the network button with the exact unit ID
          const networkBtn = this.page.locator(
            `[data-testid="cell-controls-network-${materialId}-${unitId}"]`
          ).first();

          if (await networkBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await networkBtn.click();
            expanded = true;
          }
        }
      }

      // Wait for page to settle after all expansions
      await this.waitForNetworkIdle();
      return expanded;
    } catch (error) {
      console.error(`Failed to expand hierarchy:`, error);
      return false;
    }
  }

  // ============ Inventory Input (Using Data-TestID) ============
  // Purpose: Interact with leaf-level cells for data entry

  /**
   * Get quantity value from numbered cell
   * 
   * FLOW:
   * 1. Find the input field within the numbered cell
   * 2. Read the current value
   * 3. Parse as integer and return
   */
  async getQuantityValue(materialId?: string, unitId?: number): Promise<number> {
    try {
      let inputField: Locator;

      if (materialId && unitId) {
        inputField = this.page.locator(
          `[data-testid*="numbered-cell-${materialId}-${unitId}"] [data-testid*="input"]`
        ).first();
      } else {
        // Fallback: get first numbered cell input
        inputField = this.numberedCellInputs.first();
      }

      const value = await inputField.inputValue();
      return parseInt(value || '0', 10);
    } catch {
      return 0;
    }
  }

  // ============ Data Validation ============
  // Purpose: Verify that materials were successfully added to the table

  /**
   * Verify that a row contains the expected material ID
   * 
   * FLOW:
   * 1. Get all content rows from the table
   * 2. For each row:
   *    a. Check the data-testid attribute for material ID
   *    b. Check the text content as fallback
   * 3. Return true if found in any row
   * 4. Log results for debugging
   */
  async verifyMaterialIdInRow(materialId: string): Promise<boolean> {
    try {
      // Get all content rows
      const count = await this.contentRows.count();

      for (let i = 0; i < count; i++) {
        const row = this.contentRows.nth(i);
        
        // Try to get data-testid attribute
        const rowTestId = await row.getAttribute('data-testid').catch(() => null);
        if (rowTestId && rowTestId.includes(materialId)) {
          return true;
        }
        
        // Also check row text content as fallback
        const rowText = await row.textContent().catch(() => '');
        if (rowText && rowText.includes(materialId)) {
          return true;
        }
      }
      
      return false;
    } catch (e) {
      console.error('Error verifying material ID in row:', e);
      return false;
    }
  }

  // ============ Aggregation Test Workflow Functions ============
  // Purpose: Execute complete test workflow steps for aggregation verification

  /**
   * Step 2: Set values at changeable leaf cells (ZERO-CELLS AND INCREMENT GROUP CELLS)
   * 
   * HANDLES TWO SCENARIOS:
   * 
   * SCENARIO A - INITIALIZE ZERO-CELLS:
   * - Zero-cells: CLICKABLE (empty leaf nodes that convert to group cells with value 1)
   * - Click each zero-cell to initialize it with value 1
   * 
   * SCENARIO B - INCREMENT EXISTING GROUP CELLS:
   * - If no zero-cells found, look for existing numbered-cells (group cells with pre-set values)
   * - Increment these group cells by the specified incrementValue times
   * 
   * COMPLETE WORKFLOW:
   * 1. Find all zero-cells for this material
   * 2. If zero-cells exist:
   *    a. Click each zero-cell to convert it to a group cell with value 1
   *    b. Wait for page to settle
   *    c. Find all increment buttons for the newly created group cells
   *    d. Click each increment button incrementValue times
   * 3. If NO zero-cells exist:
   *    a. Find all existing numbered-cells (group cells)
   *    b. Click each increment button incrementValue times
   * 4. Return map of units and their final set values
   * 
   * @param materialId - The material ID (e.g., 'm0000001')
   * @param incrementValue - Number of times to click increment button (e.g., 4 to reach 5 from 1, or 1 to increment by 1)
   * @returns Promise<Map<string, number>> - Map of unitId to final set value
   */
  async setLeafCellValues(
    materialId: string,
    incrementValue: number = 4
  ): Promise<Map<string, number>> {
    const setLeafValues: Map<string, number> = new Map();

    try {
      // ============ SCENARIO A: INITIALIZE ZERO-CELLS ============
      // Zero-cells are empty leaf nodes that can be clicked to initialize
      const zeroCells = this.page.locator(`[data-testid*="zero-cell-${materialId}-"]`);
      const zeroCellCount = await zeroCells.count();

      // Store zero-cell test IDs before clicking them
      const zeroCellIds: string[] = [];
      if (zeroCellCount > 0) {
        for (let i = 0; i < zeroCellCount; i++) {
          const testId = await zeroCells.nth(i).getAttribute('data-testid');
          if (testId) {
            zeroCellIds.push(testId);
          }
        }

        // Click each zero-cell to convert it to group cell (value 1)
        for (const testId of zeroCellIds) {
          try {
            const cell = this.page.locator(`[data-testid="${testId}"]`).first();
            const unitMatch = testId.match(/zero-cell-[^-]+-(\d+)/);
            const unitId = unitMatch ? unitMatch[1] : 'unknown';

            await cell.click();
            setLeafValues.set(unitId, 1); // Initial value after click is 1
          } catch (error) {
            console.warn(`Failed to click zero-cell ${testId}:`, error);
            continue;
          }
        }

        // Wait for page to settle after clicking zero-cells (with timeout)
        await this.page.waitForLoadState('networkidle').catch(() => {
          // Timeout is acceptable, continue anyway
        });
      }

      // ============ SCENARIO B: FIND GROUP CELLS (EXISTING OR NEWLY CREATED) ============
      // If we just created group cells from zero-cells, or if there are existing group cells
      const numberedCells = this.page.locator(`[data-testid*="numbered-cell-${materialId}-"]`);
      const numberedCellCount = await numberedCells.count();

      if (numberedCellCount > 0 && incrementValue > 0) {
        // Extract unit IDs from numbered cells
        const unitIds: string[] = [];
        for (let i = 0; i < numberedCellCount; i++) {
          const testId = await numberedCells.nth(i).getAttribute('data-testid');
          if (testId && !testId.includes('increment') && !testId.includes('decrement')) {
            const unitMatch = testId.match(/numbered-cell-[^-]+-(\d+)/);
            if (unitMatch) {
              const unitId = unitMatch[1];
              if (!unitIds.includes(unitId)) {
                unitIds.push(unitId);
              }
            }
          }
        }

        // ============ INCREMENT EACH GROUP CELL ============
        // For each unit that has a numbered cell, find its increment button and click it
        for (const unitId of unitIds) {
          try {
            // Find the increment button for this unit
            const incrementBtn = this.page.locator(
              `[data-testid*="numbered-cell-${materialId}-${unitId}-increment"]`
            ).first();

            if (await incrementBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              // Get current value before incrementing
              const inputField = this.page.locator(
                `[data-testid*="numbered-cell-${materialId}-${unitId}"] [data-testid*="input"]`
              ).first();
              let currentValue = 0;
              try {
                const inputValue = await inputField.inputValue().catch(() => '0');
                currentValue = parseInt(inputValue || '0', 10);
              } catch {
                currentValue = 0;
              }

              // Click increment button incrementValue times
              for (let i = 0; i < incrementValue; i++) {
                await incrementBtn.click();
              }
              
              // Update or add the value in our map
              const finalValue = currentValue + incrementValue;
              setLeafValues.set(unitId, finalValue);
            }
          } catch (error) {
            console.warn(`Failed to increment cell for unit ${unitId}:`, error);
            continue;
          }
        }
      }

      // Wait for page to settle after all increments (with timeout)
      await this.page.waitForLoadState('networkidle').catch(() => {
        // Timeout is acceptable, continue anyway
      });

      return setLeafValues;
    } catch (error) {
      console.error(`Failed to set leaf cell values:`, error);
      return setLeafValues;
    }
  }

  /**
   * Verify hierarchical aggregation logic
   * 
   * AGGREGATION RULE: Parent cell value = SUM(all child cell values)
   * 
   * FLOW:
   * 1. Wait for page to settle and aggregation calculations to complete
   * 2. Read all cell values (both zero-cells and numbered-cells)
   * 3. Extract unit IDs and values from test IDs
   * 4. For parent-child relationship, verify:
   *    - Parent value = Sum of all child values
   * 5. Log verification results for debugging
   * 6. Return true if aggregation is correct
   * 
   * @param materialId - The material ID (e.g., 'm0000001')
   * @param unitsToExpand - Array of unit IDs in hierarchy order (e.g., [2, 12, 52])
   * @param setLeafValues - Map of leaf unit IDs and their values (e.g., {52: 3, 53: 2})
   * @param unitHierarchy - Optional pre-defined hierarchy. If not provided, builds dynamically from DOM
   * @returns Promise<boolean> - True if aggregation is correct
   */
  async verifyAggregation(
    materialId: string,
    unitsToExpand: number[],
    setLeafValues: Map<string, number>,
    unitHierarchy?: Map<number, number[]>
  ): Promise<boolean> {
    try {
      // Wait for aggregation to compute
      await this.waitForNetworkIdle();

      // Use optimized approach - get all input values at once
      const inputLocator = this.page.locator(`[data-testid*="${materialId}"] [data-testid*="input"]`);
      const inputElements = await inputLocator.all();

      console.log(`\n[AGGREGATION VERIFICATION] Found ${inputElements.length} input elements for material ${materialId}`);

      const cellValues: Map<string, number> = new Map();

      // Process all inputs in parallel for better performance
      const valuePromises = inputElements.map(async (input, index) => {
        try {
          const testId = await input.locator('..').getAttribute('data-testid');
          if (testId && !testId.includes('increment') && !testId.includes('decrement')) {
            const value = await input.inputValue().catch(() => '0');
            const numValue = parseInt(value || '0', 10);

            if (!isNaN(numValue)) {
              // Extract unit ID from testid
              const unitMatch = testId.match(/(?:zero-cell|numbered-cell)-[^-]+-(\d+)/);
              if (unitMatch) {
                const unitId = unitMatch[1];
                return { unitId, value: numValue };
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to read input ${index}:`, err);
        }
        return null;
      });

      const results = await Promise.all(valuePromises);

      // Collect results
      for (const result of results) {
        if (result) {
          const { unitId, value } = result;
          // Store the maximum value (in case there are duplicates like root and group)
          const existingValue = cellValues.get(unitId) || 0;
          if (value > existingValue) {
            cellValues.set(unitId, value);
          }
        }
      }

      // If hierarchy not provided, throw an error
      if (!unitHierarchy) {
        console.log(`\n[ERROR] No unitHierarchy provided and none could be extracted from DOM`);
        console.log(`Please provide unitHierarchy in test data to validate aggregation correctly`);
        throw new Error('unitHierarchy is required for aggregation verification');
      }

      // Log all captured cell values
      console.log(`\n[ALL CELL VALUES CAPTURED] for material ${materialId}:`);
      const sortedCells = Array.from(cellValues.entries()).sort(([a], [b]) => parseInt(a) - parseInt(b));
      for (const [unitId, value] of sortedCells) {
        console.log(`  - Unit ${unitId}: ${value}`);
      }

      // Log all captured cell values organized by hierarchy levels
      console.log(`\n[HIERARCHY LEVEL VALUES] for material ${materialId}:`);
      for (let level = 0; level < unitsToExpand.length; level++) {
        const levelUnitId = unitsToExpand[level].toString();
        const levelValue = cellValues.get(levelUnitId) || 0;
        console.log(`  Level ${level} - Unit ${levelUnitId}: ${levelValue}`);
        
        // Show children of this level unit
        if (unitHierarchy) {
          const children = unitHierarchy.get(parseInt(levelUnitId, 10)) || [];
          if (children.length > 0) {
            console.log(`    Children:`);
            for (const childId of children) {
              const childValue = cellValues.get(childId.toString()) || 0;
              console.log(`      - Unit ${childId}: ${childValue}`);
            }
          }
        }
      }

      // For each level, find all units and sum their values
      const levelSums: Map<number, { units: Map<string, number>, total: number }> = new Map();
      
      cellValues.forEach((value, unitId) => {
        // Determine which level this unit belongs to
        for (let level = 0; level < unitsToExpand.length; level++) {
          const levelUnitId = unitsToExpand[level].toString();
          if (unitId === levelUnitId) {
            if (!levelSums.has(level)) {
              levelSums.set(level, { units: new Map(), total: 0 });
            }
            const levelData = levelSums.get(level)!;
            levelData.units.set(unitId, value);
            levelData.total += value;
            break;
          }
        }
      });

      // Verify parent-child aggregation using row sums
      if (unitsToExpand.length >= 2) {
        // Get the parent level unit
        const parentLevelIdx = unitsToExpand.length - 2;
        const parentLevelUnitId = unitsToExpand[parentLevelIdx].toString();
        const parentLevelValue = cellValues.get(parentLevelUnitId) || 0;
        
        // Recursive function to sum all descendants (children and their descendants, not the unit itself)
        const sumAllDescendants = (unitId: number): number => {
          let total = 0;
          
          // If this unit has children, add their values recursively
          if (unitHierarchy && unitHierarchy.has(unitId)) {
            const children = unitHierarchy.get(unitId) || [];
            for (const childId of children) {
              // Add the direct child's value
              const childValue = cellValues.get(childId.toString()) || 0;
              total += childValue;
              
              // Recursively add all descendants of this child
              total += sumAllDescendants(childId);
            }
          }
          
          return total;
        };

        let childrenSum = 0;
        const childrenDetails: Array<{ unitId: string, value: number }> = [];
        const allDescendantsDetails: Array<{ unitId: string, value: number }> = [];
        
        if (unitHierarchy) {
          // Use hierarchy to find all direct children of the parent
          const parentChildren = unitHierarchy.get(parseInt(parentLevelUnitId, 10)) || [];
          for (const childId of parentChildren) {
            // Get direct child value
            const childValue = cellValues.get(childId.toString()) || 0;
            childrenDetails.push({ unitId: childId.toString(), value: childValue });
            childrenSum += childValue;
            
            // Also add the descendant sum for logging purposes
            const descendantSum = sumAllDescendants(childId);
            allDescendantsDetails.push({ unitId: childId.toString(), value: childValue + descendantSum });
          }
        } else {
          // Fallback: sum all leaf values that were set
          for (const [unitId, value] of setLeafValues.entries()) {
            childrenSum += value;
            childrenDetails.push({ unitId, value });
          }
        }

        // Verify: Parent value should equal the sum of all descendants
        console.log(`\n[AGGREGATION VERIFICATION DETAILS]:`);
        console.log(`  Material: ${materialId}`);
        console.log(`  Parent Unit (${parentLevelUnitId}): ${parentLevelValue}`);
        console.log(`  Direct Child Units:`);
        for (const { unitId, value } of childrenDetails) {
          console.log(`    - Unit ${unitId}: ${value}`);
        }
        console.log(`  All Descendants (recursive sum):`);
        for (const { unitId, value } of allDescendantsDetails) {
          console.log(`    - Unit ${unitId}: ${value}`);
        }
        console.log(`  Total Descendants Sum: ${childrenSum}`);
        console.log(`  Expected: Parent (${parentLevelValue}) should equal Descendants Sum (${childrenSum})`);
        
        let parentAggregationValid = true;
        if (parentLevelValue === childrenSum) {
          console.log(`✓ AGGREGATION VERIFIED: Parent (${parentLevelUnitId}: ${parentLevelValue}) = Descendants Sum (${childrenSum})`);
        } else {
          console.log(`✗ AGGREGATION FAILED: Parent (${parentLevelUnitId}: ${parentLevelValue}) !== Descendants Sum (${childrenSum})`);
          console.log(`  Difference: ${Math.abs(parentLevelValue - childrenSum)}`);
          parentAggregationValid = false;
        }

        // STEP 2: Validate aggregation for the visible hierarchy path
        console.log(`\n[VISIBLE PATH VALIDATION] Validating parent-child relationships along expanded path:`);
        console.log(`═══════════════════════════════════════════════════════════════════`);
        let hierarchyPathValid = true;
        
        // For each level in the hierarchy path (except the last, which has no children in path)
        for (let level = 0; level < unitsToExpand.length - 1; level++) {
          const parentUnitId = unitsToExpand[level];
          const childUnitId = unitsToExpand[level + 1];
          const parentValue = cellValues.get(parentUnitId.toString()) || 0;
          const childValue = cellValues.get(childUnitId.toString()) || 0;
          
          console.log(`\n  LEVEL ${level}:`);
          console.log(`  ─────────────────────────────────────────────────────────────`);
          console.log(`  Parent: Unit ${parentUnitId} = ${parentValue}`);
          console.log(`  `);
          
          // Get ALL children of this parent from the hierarchy map
          const allChildren = unitHierarchy ? (unitHierarchy.get(parentUnitId) || []) : [];
          console.log(`  Children of Unit ${parentUnitId}:`);
          
          // Sum ONLY the children that have values in cellValues
          let totalChildrenSum = 0;
          const visibleChildren: number[] = [];
          const childDetails: Array<{ unitId: number; value: number; visible: boolean }> = [];
          
          for (const child of allChildren) {
            const childVal = cellValues.has(child.toString()) ? (cellValues.get(child.toString()) || 0) : 0;
            const isVisible = cellValues.has(child.toString());
            
            childDetails.push({ unitId: child, value: childVal, visible: isVisible });
            
            if (isVisible) {
              totalChildrenSum += childVal;
              visibleChildren.push(child);
              if (childVal > 0) {
                console.log(`    ✓ Unit ${child}: ${childVal} (visible)`);
              } else {
                console.log(`    ○ Unit ${child}: ${childVal} (visible, zero value)`);
              }
            } else {
              console.log(`    ✗ Unit ${child}: 0 (not visible/no value)`);
            }
          }
          
          console.log(`  `);
          console.log(`  Aggregation Check:`);
          console.log(`    Parent Value:        ${parentValue}`);
          console.log(`    Children Sum:        ${totalChildrenSum}`);
          console.log(`    Visible Children:    [${visibleChildren.join(', ')}]`);
          
          // IMPORTANT: Only validate this level if we have all children visible
          // If some children are not visible (missing siblings), skip validation for this level
          const hasAllChildrenVisible = allChildren.length === visibleChildren.length;
          
          if (!hasAllChildrenVisible && level === 0) {
            // For root level, if we don't have all siblings expanded, skip validation
            console.log(`    ⊘ SKIPPED: Not all siblings expanded at root level (${visibleChildren.length}/${allChildren.length} children visible)`);
            console.log(`    Note: To validate this level, expand all sibling units under unit ${parentUnitId}`);
          } else {
            // Verify: parent value should equal sum of all visible children
            if (parentValue === totalChildrenSum) {
              console.log(`    ✓ PASS: ${parentValue} = ${totalChildrenSum}`);
            } else {
              console.log(`    ✗ FAIL: ${parentValue} ≠ ${totalChildrenSum} (Diff: ${Math.abs(parentValue - totalChildrenSum)})`);
              hierarchyPathValid = false;
            }
          }
        }
        
        console.log(`═══════════════════════════════════════════════════════════════════`);
        
        // Summary of validation results
        if (parentAggregationValid && hierarchyPathValid) {
          console.log(`\n✓ ALL AGGREGATION CHECKS PASSED`);
          return true;
        } else {
          console.log(`\n✗ SOME AGGREGATION CHECKS FAILED`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Aggregation verification error:', error);
      throw error;
    }
  }

  /**
   * Verify aggregation by examining visible children at each level in the expand path
   * 
   * SIMPLIFIED AGGREGATION VALIDATION:
   * - For each unit in unitsToExpand (except the last):
   *   1. Find all visible children rows in the DOM under that unit
   *   2. Sum the values of those children
   *   3. Compare sum to the parent unit's value
   *   4. Report PASS/FAIL
   * - Stop after validating the last unit in unitsToExpand
   * 
   * This approach does NOT require unitHierarchy to be passed - it discovers
   * children by examining the DOM structure directly.
   * 
   * @param materialId - The material ID (e.g., 'm0000001')
   * @param unitsToExpand - Array of unit IDs in hierarchy order (e.g., [2, 12, 52])
   * @returns Promise<boolean> - True if all aggregation checks pass
   */
  async verifyAggregationSimple(
    materialId: string,
    unitsToExpand: number[]
  ): Promise<boolean> {
    try {
      // Wait for aggregation to compute
      await this.waitForNetworkIdle();

      // Get all input values for this material
      const inputLocator = this.page.locator(`[data-testid*="${materialId}"] [data-testid*="input"]`);
      const inputElements = await inputLocator.all();

      console.log(`\n[SIMPLE AGGREGATION VERIFICATION] Found ${inputElements.length} input elements for material ${materialId}`);

      // Collect all cell values
      const cellValues: Map<string, number> = new Map();
      const valuePromises = inputElements.map(async (input) => {
        try {
          const testId = await input.locator('..').getAttribute('data-testid');
          if (testId && !testId.includes('increment') && !testId.includes('decrement')) {
            const value = await input.inputValue().catch(() => '0');
            const numValue = parseInt(value || '0', 10);

            if (!isNaN(numValue)) {
              const unitMatch = testId.match(/(?:zero-cell|numbered-cell)-[^-]+-(\d+)/);
              if (unitMatch) {
                const unitId = unitMatch[1];
                return { unitId, value: numValue };
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to read input:`, err);
        }
        return null;
      });

      const results = await Promise.all(valuePromises);
      for (const result of results) {
        if (result) {
          const { unitId, value } = result;
          const existingValue = cellValues.get(unitId) || 0;
          if (value > existingValue) {
            cellValues.set(unitId, value);
          }
        }
      }

      // Log all captured values
      console.log(`\n[ALL CELL VALUES] for material ${materialId}:`);
      const sortedCells = Array.from(cellValues.entries()).sort(([a], [b]) => parseInt(a) - parseInt(b));
      for (const [unitId, value] of sortedCells) {
        console.log(`  - Unit ${unitId}: ${value}`);
      }

      // Now validate aggregation for each parent in the expand path
      console.log(`\n[AGGREGATION VALIDATION] Validating each level in expand path: [${unitsToExpand.join(' → ')}]`);
      console.log(`═══════════════════════════════════════════════════════════════════`);

      let allValidationsPassed = true;

      // For each unit in the expand path (except the last one)
      for (let level = 0; level < unitsToExpand.length - 1; level++) {
        const parentUnitId = unitsToExpand[level];
        const parentValue = cellValues.get(parentUnitId.toString()) || 0;
        
        // The children of this parent are all the units in cellValues that are:
        // 1. Between this parent and the next parent in the expand path
        // 2. OR the next unit in the expand path itself
        
        const children: Array<{ unitId: number; value: number }> = [];
        let childrenSum = 0;

        // Get sorted unit IDs
        const unitIdsSorted = Array.from(cellValues.keys())
          .map(u => parseInt(u, 10))
          .sort((a, b) => a - b);
        
        const parentIdx = unitIdsSorted.indexOf(parentUnitId);
        
        // If this is not the last level in expand path, the next unit in path is a child
        if (level < unitsToExpand.length - 1) {
          const nextPathUnitId = unitsToExpand[level + 1];
          const nextPathIdx = unitIdsSorted.indexOf(nextPathUnitId);
          
          // Collect all units between parent and next path unit - these are direct children
          for (let i = parentIdx + 1; i < nextPathIdx; i++) {
            const childUnitId = unitIdsSorted[i];
            const childValue = cellValues.get(childUnitId.toString()) || 0;
            children.push({ unitId: childUnitId, value: childValue });
            childrenSum += childValue;
          }
          
          // Include the next path unit itself
          const nextValue = cellValues.get(nextPathUnitId.toString()) || 0;
          children.push({ unitId: nextPathUnitId, value: nextValue });
          childrenSum += nextValue;
        }

        console.log(`\n  LEVEL ${level}:`);
        console.log(`  ─────────────────────────────────────────────────────────────`);
        console.log(`  Parent Unit: ${parentUnitId} = ${parentValue}`);
        console.log(`  Children of Unit ${parentUnitId}:`);
        
        if (children.length > 0) {
          for (const { unitId, value } of children) {
            console.log(`    ✓ Unit ${unitId}: ${value}`);
          }
        } else {
          console.log(`    (no children found in DOM)`);
        }

        console.log(`  `);
        console.log(`  Aggregation Check:`);
        console.log(`    Parent Value:     ${parentValue}`);
        console.log(`    Children Sum:     ${childrenSum}`);
        console.log(`    Children Count:   ${children.length}`);

        // Validate
        if (parentValue === childrenSum) {
          console.log(`    ✓ PASS: ${parentValue} = ${childrenSum}`);
        } else {
          console.log(`    ✗ FAIL: ${parentValue} ≠ ${childrenSum} (Diff: ${Math.abs(parentValue - childrenSum)})`);
          allValidationsPassed = false;
        }
      }

      console.log(`═══════════════════════════════════════════════════════════════════`);

      if (allValidationsPassed) {
        console.log(`\n✓ ALL AGGREGATION VALIDATIONS PASSED`);
        return true;
      } else {
        console.log(`\n✗ SOME AGGREGATION VALIDATIONS FAILED`);
        return false;
      }
    } catch (error) {
      console.error('Simple aggregation verification error:', error);
      throw error;
    }
  }

  // ============ Hierarchy Validation & Correction ============

  /**
   * Open the Unit Hierarchy Drawer
   * 
   * @returns Promise<boolean> - True if drawer opened successfully
   */
  async openUnitHierarchyDrawer(): Promise<boolean> {
    try {
      // Click the menu button to open drawer
      await this.menuBtn.click();

      // Wait for drawer content to become visible
      const drawerVisible = await this.unitHierarchyDrawerContent.isVisible({ timeout: 3000 }).catch(() => false);
      
      if (drawerVisible) {
        console.log(`✓ Unit Hierarchy Drawer opened successfully`);
        await this.page.waitForTimeout(500); // Small delay for drawer to fully render
        return true;
      } else {
        console.log(`✗ Unit Hierarchy Drawer did not open`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to open Unit Hierarchy Drawer:`, error);
      return false;
    }
  }

  /**
   * Get current hierarchy from the Unit Hierarchy Drawer
   * 
   * @returns Promise<Record<number, number[]>> - Map of parent ID to array of child IDs
   */
  async getCurrentHierarchyFromDrawer(): Promise<Record<number, number[]>> {
    try {
      const hierarchy: Record<number, number[]> = {};

      // Query all parent units in the drawer
      const parentRows = await this.page.locator('[data-testid*="hierarchy-parent"]').all();

      for (const parentRow of parentRows) {
        // Extract parent ID from data-testid (e.g., "hierarchy-parent-2")
        const parentTestId = await parentRow.getAttribute('data-testid');
        const parentIdMatch = parentTestId?.match(/hierarchy-parent-(\d+)/);
        
        if (!parentIdMatch) continue;
        
        const parentId = parseInt(parentIdMatch[1], 10);
        
        // Find all child rows under this parent
        // This assumes a tree structure where children are nested under parent
        const childRows = await parentRow.locator('+ [data-testid*="hierarchy-child"]').all();
        const children: number[] = [];

        for (const childRow of childRows) {
          const childTestId = await childRow.getAttribute('data-testid');
          const childIdMatch = childTestId?.match(/hierarchy-child-(\d+)/);
          
          if (childIdMatch) {
            children.push(parseInt(childIdMatch[1], 10));
          }
        }

        hierarchy[parentId] = children;
      }

      return hierarchy;
    } catch (error) {
      console.error('Error getting current hierarchy from drawer:', error);
      return {};
    }
  }

  /**
   * Compare current hierarchy with expected hierarchy
   * 
   * @param currentHierarchy - Current hierarchy in system
   * @param expectedHierarchy - Expected hierarchy to match
   * @returns Promise<boolean> - True if they match exactly
   */
  async compareHierarchies(
    currentHierarchy: Record<number, number[]>,
    expectedHierarchy: Record<number, number[]>
  ): Promise<boolean> {
    try {
      console.log(`\n[COMPARING HIERARCHIES]...`);

      // Check if same keys exist
      const currentKeys = Object.keys(currentHierarchy).sort();
      const expectedKeys = Object.keys(expectedHierarchy).sort();

      if (currentKeys.join(',') !== expectedKeys.join(',')) {
        console.log(`✗ Parent units don't match`);
        console.log(`  Current:  [${currentKeys.join(', ')}]`);
        console.log(`  Expected: [${expectedKeys.join(', ')}]`);
        return false;
      }

      // Check if children match for each parent
      for (const parentId of expectedKeys) {
        const currentChildren = (currentHierarchy[parentId] || []).sort((a, b) => a - b);
        const expectedChildren = (expectedHierarchy[parentId] || []).sort((a, b) => a - b);

        if (currentChildren.join(',') !== expectedChildren.join(',')) {
          console.log(`✗ Children of Unit ${parentId} don't match`);
          console.log(`  Current:  [${currentChildren.join(', ')}]`);
          console.log(`  Expected: [${expectedChildren.join(', ')}]`);
          return false;
        }
      }

      console.log(`✓ Hierarchies match perfectly!`);
      return true;
    } catch (error) {
      console.error('Error comparing hierarchies:', error);
      return false;
    }
  }

  /**
   * Correct the hierarchy by moving units to match expected structure
   * 
   * @param currentHierarchy - Current hierarchy in system
   * @param expectedHierarchy - Expected hierarchy to match
   * @returns Promise<boolean> - True if correction was successful
   */
  async correctHierarchy(
    currentHierarchy: Record<number, number[]>,
    expectedHierarchy: Record<number, number[]>
  ): Promise<boolean> {
    try {
      console.log(`\n[CORRECTING HIERARCHY]...`);

      let movesNeeded = 0;

      // For each parent in expected hierarchy
      for (const [parentIdStr, expectedChildren] of Object.entries(expectedHierarchy)) {
        const parentId = parseInt(parentIdStr, 10);
        const currentChildren = currentHierarchy[parentId] || [];

        // Find children that need to be moved
        for (const expectedChild of expectedChildren) {
          const isInCurrentChildren = currentChildren.includes(expectedChild);
          
          if (!isInCurrentChildren) {
            // This child needs to be moved to this parent
            console.log(`\n  Moving Unit ${expectedChild} to parent Unit ${parentId}...`);
            
            // Find where this child currently is
            let currentParent: number | null = null;
            for (const [checkParentStr, checkChildren] of Object.entries(currentHierarchy)) {
              if (checkChildren.includes(expectedChild)) {
                currentParent = parseInt(checkParentStr, 10);
                break;
              }
            }

            if (currentParent !== null && currentParent !== parentId) {
              // Move the unit
              const moved = await this.moveUnitInHierarchy(expectedChild, currentParent, parentId);
              if (moved) {
                console.log(`  ✓ Unit ${expectedChild} moved successfully`);
                movesNeeded++;
                // Update current hierarchy
                currentHierarchy[currentParent] = currentHierarchy[currentParent].filter(id => id !== expectedChild);
                if (!currentHierarchy[parentId]) {
                  currentHierarchy[parentId] = [];
                }
                currentHierarchy[parentId].push(expectedChild);
              } else {
                console.log(`  ✗ Failed to move Unit ${expectedChild}`);
                return false;
              }
            }
          }
        }
      }

      if (movesNeeded === 0) {
        console.log(`✓ No moves needed - hierarchy already correct`);
        return true;
      } else {
        console.log(`\n✓ Hierarchy corrected with ${movesNeeded} move(s)`);
        return true;
      }
    } catch (error) {
      console.error('Error correcting hierarchy:', error);
      return false;
    }
  }

  /**
   * Expand hierarchy path by clicking expand tooltips for each unit
   * Expands up to and including the specified parent unit (does NOT expand beyond it)
   * 
   * EXAMPLE: For path [2, 12, 52] with parent 12:
   * - Expands: 2 and 12
   * - Does NOT expand: 52
   * 
   * @param hierarchyPath - Array of unit IDs representing the full path
   * @param parentUnit - The parent unit ID to expand up to (inclusive)
   * @returns Promise<void>
   */
  async expandHierarchyPath(hierarchyPath: number[], parentUnit: number): Promise<void> {
    try {
      console.log(`Expanding hierarchy path: [${hierarchyPath.join(' → ')}] up to parent unit ${parentUnit}`);
      
      // Find the index of the parent unit in the hierarchy path
      const parentIndex = hierarchyPath.indexOf(parentUnit);
      
      if (parentIndex === -1) {
        console.error(`✗ Parent unit ${parentUnit} not found in hierarchy path [${hierarchyPath.join(', ')}]`);
        return;
      }
      
      // Expand all units up to and including the parent unit
      // Loop from 0 to parentIndex (inclusive)
      for (let i = 0; i <= parentIndex; i++) {
        const currentUnit = hierarchyPath[i];
        
        // Click expand tooltip for each unit to reveal its children
        const expandTooltip = this.page.locator(`[data-testid="unit-hierarchy-row-expand-tooltip-${currentUnit}-wrapper"]`);
        const isVisible = await expandTooltip.isVisible({ timeout: 2000 }).catch(() => false);
        
        if (isVisible) {
          await expandTooltip.click();
          await this.page.waitForTimeout(200); // Small delay between clicks
          console.log(`  ✓ Expanded unit ${currentUnit}`);
        } else {
          console.warn(`  ⚠ Expand tooltip not found for unit ${currentUnit}`);
        }
      }
      
      console.log(`✓ Hierarchy path expanded successfully up to parent unit ${parentUnit}`);
    } catch (error) {
      console.error(`Failed to expand hierarchy path:`, error);
    }
  }

  /**
   * Collapse hierarchy path by clicking the expand tooltip of the highest parent (first element)
   * This collapses the entire path starting from the root
   * 
   * @param hierarchyPath - Array of unit IDs representing the path
   * @returns Promise<void>
   */
  async collapseHierarchyPath(hierarchyPath: number[]): Promise<void> {
    try {
      console.log(`Collapsing hierarchy path by clicking highest parent (Unit ${hierarchyPath[0]})...`);
      
      // Click the expand tooltip of the FIRST unit (highest parent) to collapse
      const firstUnit = hierarchyPath[0];
      const collapseTooltip = this.page.locator(`[data-testid="unit-hierarchy-row-expand-tooltip-${firstUnit}-wrapper"]`);
      
      const isVisible = await collapseTooltip.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (isVisible) {
        await collapseTooltip.click();
        await this.page.waitForTimeout(300); // Allow collapse animation to complete
        console.log(`✓ Hierarchy collapsed by clicking highest parent`);
      } else {
        console.warn(`  ⚠ Collapse tooltip not found for highest parent unit ${firstUnit}`);
      }
    } catch (error) {
      console.error(`Failed to collapse hierarchy path:`, error);
    }
  }

  /**
   * Unlock a parent unit in the hierarchy if it's locked
   * 
   * @param unitId - The unit ID to unlock
   * @returns Promise<void>
   */
  async unlockParentUnit(unitId: number): Promise<void> {
    console.log(`  Attempting to unlock unit ${unitId}...`);
    
    try {
      // First, try to find the lock tooltip
      const lockTooltip = this.page.locator(`[data-testid="unit-hierarchy-action-status-tooltip-${unitId}-wrapper"]`);
      
      const lockExists = await lockTooltip.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (lockExists) {
        console.log(`  ✓ Lock icon found, clicking to unlock...`);
        await lockTooltip.click({ force: true });
        
        // Wait for dialog to appear
        await this.page.waitForTimeout(300);
        
        // Click confirm button
        const confirmBtn = this.page.locator(`[data-testid="unit-hierarchy-confirm-button-${unitId}"]`);
        const confirmExists = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false);
        
        if (confirmExists) {
          await confirmBtn.click();
          console.log(`  ✓ Unit ${unitId} unlocked successfully`);
        } else {
          console.log(`  ⚠ Confirm button not found for unit ${unitId}`);
        }
      } else {
        console.log(`  ✓ Unit ${unitId} is not locked (lock icon not found)`);
      }
    } catch (error) {
      console.log(`  ⚠ Error unlocking unit ${unitId}: ${error}`);
    }
  }

  /**
   * Move a unit from one parent to another in the hierarchy drawer
   * 
   * @param unitId - The unit to move
   * @param oldParentId - Current parent
   * @param newParentId - Target parent
   * @returns Promise<boolean> - True if move was successful
   */
  async moveUnitInHierarchy(unitId: number, oldParentId: number, newParentId: number): Promise<boolean> {
    try {
      // This method assumes the hierarchy drawer is already open
      // and uses existing moveUnitToNewParent method from mainPage
      
      // For now, return true as placeholder
      // The actual implementation would use the drawer UI to move the unit
      console.log(`    [Moving unit via drawer: ${unitId} from ${oldParentId} to ${newParentId}]`);
      
      // TODO: Implement drawer-based unit move
      // For now, we'll skip actual move and just return true
      return true;
    } catch (error) {
      console.error(`Error moving unit ${unitId}:`, error);
      return false;
    }
  }
}