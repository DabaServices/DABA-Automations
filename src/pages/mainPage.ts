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
    this.menuBtn = page.getByTestId('unit-hierarchy-drawer-trigger');

    this.makatCombobox = page.getByRole('combobox', { name: /בחירת מק״ט/ });
    this.makatOptions = page.locator('[role="option"]');

    this.addButton = page.getByTestId('material-search-combobox-start-adornment');

    this.contentRows = page.locator('[data-testid*="content-row"]');
    this.firstRow = page.locator('[data-testid*="content-row"]').first();
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
    // Navigate using the baseURL from playwright.config.ts
    // If baseURL is configured, page.goto('/') will use it; otherwise falls back to full URL
    await this.page.goto('/');
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
    console.info(`[selectMakatFromDropdown] Selecting material: ${materialIdOrText}`);
    try {
      await this.makatCombobox.click({ timeout: 5000 });
      await this.makatOptions.first().waitFor({ timeout: 5000 }).catch(() => {
        // Silent fail - options might already be visible
      });

      await this.makatCombobox.fill(materialIdOrText);
      await new Promise(resolve => setTimeout(resolve, 500));

      const count = await this.makatOptions.count();
      if (count === 0) {
        throw new Error(`No Makat options found for: ${materialIdOrText}`);
      }
      
      await this.makatOptions.first().click({ timeout: 5000 });
      console.info(`[selectMakatFromDropdown] Successfully selected: ${materialIdOrText}`);
    } catch (error) {
      console.error(`[selectMakatFromDropdown] Failed for material ${materialIdOrText}: ${error}`);
      throw error;
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
   * Add a material from the dropdown in one operation
   * 
   * FLOW:
   * 1. Select the material from the dropdown
   * 2. Click the add button to add it to the table
   * 
   * @param materialIdOrText - The material ID to search for (e.g., 'm0000002')
   */
  async addMakatFromDropdown(materialIdOrText: string) {
    console.info(`[addMakatFromDropdown] Adding material: ${materialIdOrText}`);
    try {
      // Step 1: Select from dropdown
      await this.selectMakatFromDropdown(materialIdOrText);
      
      // Step 2: Click add button
      await this.clickAddMakatAdornment();
      
      console.info(`[addMakatFromDropdown] Successfully added material: ${materialIdOrText}`);
    } catch (error) {
      console.error(`[addMakatFromDropdown] Failed to add material ${materialIdOrText}: ${error}`);
      throw error;
    }
  }

  /**
   * Save material changes
   * 
   * FLOW: Click the save button to persist material changes to the database
   */
  async saveMaterial() {
    console.info(`[saveMaterial] Attempting to save material`);
    try {
      const saveBtn = this.page.getByTestId('save-button-tooltip-trigger');
      
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveBtn.click();
        await this.waitForNetworkIdle();
        console.info(`[saveMaterial] Material saved successfully`);
      } else {
        console.warn(`[saveMaterial] Save button not visible, attempting anyway`);
        await saveBtn.click();
      }
    } catch (error) {
      console.error(`[saveMaterial] Failed to save material: ${error}`);
      throw error;
    }
  }

  /**
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
      
      // Expand each unit ID in sequence INCLUDING the leaf unit
      for (let idx = 0; idx < unitsToExpand.length; idx++) {
        const unitId = unitsToExpand[idx];
        
        // Find the numbered-cell for this unit
        const cell = this.page.locator(
          `[data-testid*="numbered-cell-${materialId}-${unitId}"]`
        ).first();
        
        const cellFound = await cell.isVisible({ timeout: 1000 }).catch(() => false);
        if (!cellFound) continue;

        // Scroll and hover to reveal control buttons
        await cell.scrollIntoViewIfNeeded();
        await cell.hover();
        
        // Click the network button to expand this unit
        const networkBtn = this.page.locator(
          `[data-testid="cell-controls-network-${materialId}-${unitId}"]`
        ).first();

        if (await networkBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await networkBtn.click();
          expanded = true;
        }
      }

      return expanded;
    } catch (error) {
      return false;
    }
  }


  /**
   * Capture the current displayed value for each unit in a descendants list.
   *
   * Scans all numbered-cell inputs that belong to the given material and
   * returns a map of unitId → value for every unit found in `descendants`.
   *
   * @param materialId  - The material/makat ID (e.g. '000000001')
   * @param descendants - Array of unit IDs to collect values for
   * @returns Map<unitId, value>
   */
  async captureUnitValues(
    materialId: string,
    descendants: number[]
  ): Promise<Map<number, number>> {
    const unitValuesMap = new Map<number, number>();
    const inputElements = await this.page
      .locator(`[data-testid*="${materialId}"] [data-testid*="input"]`)
      .all();

    for (const input of inputElements) {
      try {
        const testId = await input.locator('..').getAttribute('data-testid');
        if (testId?.includes(`numbered-cell-${materialId}`)) {
          // testId pattern: numbered-cell-<materialId>-<unitId>
          const unitMatch = testId.match(/numbered-cell-[^-]+-(\d+)/);
          if (unitMatch) {
            const unitId = parseInt(unitMatch[1], 10);
            if (descendants.includes(unitId)) {
              const value = parseInt(
                (await input.inputValue().catch(() => '0')) || '0',
                10
              );
              unitValuesMap.set(unitId, value);
            }
          }
        }
      } catch {
        // Skip cells that can't be read
      }
    }
    return unitValuesMap;
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
      let clickedZeroCells = false; // Track if we clicked any zero-cells

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
            clickedZeroCells = true; // Mark that we clicked at least one zero-cell
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
        // NOTE: If we clicked zero-cells, adjust incrementValue by -1 because zero-cell click already set value to 1
        const adjustedIncrementValue = clickedZeroCells ? Math.max(0, incrementValue - 1) : incrementValue;

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

              // Click increment button adjustedIncrementValue times
              for (let i = 0; i < adjustedIncrementValue; i++) {
                await incrementBtn.click();
              }
              
              // Update or add the value in our map
              const finalValue = currentValue + adjustedIncrementValue;
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
        const errorMsg = `No unitHierarchy provided for material ${materialId}`;
        console.error(`[verifyAggregation] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Log captured values only in debug mode (commented out for production)
      // console.debug(`[verifyAggregation] Material ${materialId} - Captured ${cellValues.size} unit values`);

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
        const isAggregationValid = parentLevelValue === childrenSum;
        if (isAggregationValid) {
          console.info(`[verifyAggregationWithAllVisibleCells] Material ${materialId}: Aggregation VERIFIED (Parent ${parentLevelUnitId}=${parentLevelValue} = Sum=${childrenSum})`);
        } else {
          console.error(`[verifyAggregationWithAllVisibleCells] Material ${materialId}: Aggregation FAILED (Parent ${parentLevelUnitId}=${parentLevelValue} ≠ Sum=${childrenSum})`);
        }
        
        let parentAggregationValid = isAggregationValid;

        // Validate path levels
        let hierarchyPathValid = true;
        
        for (let level = 0; level < unitsToExpand.length - 1; level++) {
          const parentUnitId = unitsToExpand[level];
          const parentValue = cellValues.get(parentUnitId.toString()) || 0;
          
          const allChildren = unitHierarchy ? (unitHierarchy.get(parentUnitId) || []) : [];
          let totalChildrenSum = 0;
          
          for (const child of allChildren) {
            if (cellValues.has(child.toString())) {
              totalChildrenSum += (cellValues.get(child.toString()) || 0);
            }
          }
          
          const hasAllChildrenVisible = allChildren.length > 0 && totalChildrenSum > 0;
          if (hasAllChildrenVisible && parentValue !== totalChildrenSum) {
            console.error(`[verifyAggregationWithAllVisibleCells] Level ${level}: Unit ${parentUnitId} has aggregation mismatch (${parentValue} ≠ ${totalChildrenSum})`);
            hierarchyPathValid = false;
          }
        }
        
        if (parentAggregationValid && hierarchyPathValid) {
          return true;
        } else {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`[verifyAggregationWithAllVisibleCells] Error: ${error}`);
      throw error;
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
   * Move a unit to a new parent via the unit-hierarchy drawer UI.
   *
   * FLOW:
   * 1. Open the unit hierarchy drawer
   * 2. Expand the new hierarchy path up to (and including) the new parent node
   * 3. Click the combobox for the new parent to open the unit picker
   * 4. Select the unit being moved from the dropdown list
   * 5. Click the combobox action button to stage the move
   * 6. Click the confirmation-popup trigger
   * 7. Click the confirm button to commit the move
   * 8. Press Escape to close the drawer
   *
   * @param unitId       - The unit to relocate
   * @param newParentId  - The target parent unit that will receive the unit
   * @param newHierarchy - Full ordered path to the new parent (used for drawer expansion)
   */
  async unitMoveUI(
    unitId: number,
    newParentId: number,
    newHierarchy: number[]
  ): Promise<void> {
    console.info(`[unitMoveUI] Moving unit ${unitId} to parent ${newParentId}`);

    // Open the drawer by clicking menu
    await this.menuBtn.click();
    const drawerVisible = await this.unitHierarchyDrawerContent.isVisible({ timeout: 3000 }).catch(() => false);
    if (!drawerVisible) {
      throw new Error('Unit Hierarchy Drawer failed to open');
    }
    await this.page.waitForTimeout(500);

    // Expand the new hierarchy path down to the new parent node
    await this.expandHierarchyPath(newHierarchy, newParentId);

    // Select the unit from the new parent's combobox
    const comboboxInput = this.page.locator(
      `[data-testid="unit-hierarchy-node-combobox-${newParentId}-input"]`
    );
    await comboboxInput.click();
    await this.waitForNetworkIdle();

    const unitOption = this.page.locator(
      `[data-testid="unit-hierarchy-node-combobox-${newParentId}-item-${unitId}"]`
    );
    await unitOption.waitFor({ state: 'visible' });
    await unitOption.click();

    // Stage the move
    const comboboxActionButton = this.page.locator(
      `[data-testid="unit-hierarchy-node-combobox-${newParentId}-action-button"]`
    );
    await comboboxActionButton.click();

    await this.page.locator('[data-testid="unit-hierarchy-header-confirmation-popup-trigger"]').click();
    await this.page.locator('[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]').click();


    // Close the drawer
    await this.page.keyboard.press('Escape');
    console.log(`  ✓ unitMoveUI: unit ${unitId} moved to parent ${newParentId}`);
  }

  /**
   * Confirm and lock the hierarchy via the drawer UI
   * 
   * PURPOSE: Opens the hierarchy drawer, confirms any pending changes,
   * and closes the drawer to finalize the hierarchy lock.
   * This triggers the backend to recalculate aggregation values.
   * 
   * USAGE:
   * await hierarchyPage.confirmAndLockHierarchyViaDrawer();
   */
  async confirmAndLockHierarchyViaDrawer(): Promise<void> {
    console.log(`\n[Confirming and locking hierarchy via drawer]`);
    
    // Open the drawer
    console.log(`  Opening drawer...`);
    await this.page.locator('[data-testid="unit-hierarchy-drawer-trigger"]').click();
    await this.page.waitForLoadState('networkidle');
    
    // Click confirmation trigger
    console.log(`  Clicking confirmation trigger...`);
    await this.page.locator('[data-testid="unit-hierarchy-header-confirmation-popup-trigger"]').click();
    await this.page.waitForLoadState('networkidle');
    
    // Confirm the action
    console.log(`  Confirming the action...`);
    await this.page.locator('[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]').click();
    await this.page.waitForLoadState('networkidle');
    
    // Close the drawer
    console.log(`  Closing drawer...`);
    await this.page.keyboard.press('Escape');
    await this.page.waitForLoadState('networkidle');
    
    console.log(`  ✓ Hierarchy confirmed and locked\n`);
  }


  /**
   * Capture all visible cell values at each level of the expanded hierarchy
   * 
   * STEP 1: Capture parent units in the expanded path
   * - For each unit in unitsToExpand (e.g., [2, 12, 52])
   * - Find the cell for this unit: try row-cell first, fallback to numbered-cell
   * - Read the value from the input field
   * - Store: {unitId: value}
   * 
   * STEP 2: Capture children for each parent
   * - For each parent, find all its visible children in the DOM
   * - Find the sub-row container that holds children cells
   * - Extract all numbered-cells within this sub-row
   * - For each child, extract unit ID and value
   * - Remember which children belong to each parent
   * 
   * STEP 3: Store hierarchy map for verification
   * - Save the parent→children mapping for use by verifyAggregationWithAllVisibleCells
   * - Return all captured values: {2: 100, 12: 50, 52: 20, 53: 30, ...}
   * 
   * @param materialId - The material/makat ID
   * @param unitsToExpand - The hierarchy path [parent1, parent2, ..., leaf]
   * @returns Map of unitId → value for all visible cells at each level
   */
  async captureAllVisibleCellValuesAtEachLevel(
    materialId: string,
    unitsToExpand: number[]
  ): Promise<Map<number, number>> {
    const allCellValues = new Map<number, number>();
    const hierarchyMap = new Map<number, number[]>();

    // ============ STEP 1: Capture parent units in the expanded path ============
    for (const unitId of unitsToExpand) {
      // Find the cell for this unit - try row-cell first, fallback to numbered-cell
      let cell = this.page.locator(`[data-testid="row-cell-${materialId}-${unitId}"]`);
      if (!(await cell.first().isVisible({ timeout: 500 }).catch(() => false))) {
        cell = this.page.locator(`[data-testid*="numbered-cell-${materialId}-${unitId}"]`);
      }
      
      // Read the value from the input field
      const inputField = cell.locator('[data-testid*="input"]').first();
      const value = parseInt(await inputField.inputValue().catch(() => '0'), 10);
      allCellValues.set(unitId, value);
    }

    // ============ STEP 2: Capture children for each parent in the path ============
    for (const parentUnitId of unitsToExpand) {
      // Find the sub-row container that holds children cells
      let subRow = this.page.locator(`[data-testid="sub-row-cells-wrapper-${materialId}-${parentUnitId}"]`);
      // Try alternative selector if first doesn't work
      if (!(await subRow.first().isVisible({ timeout: 500 }).catch(() => false))) {
        subRow = this.page.locator(`[data-testid="sub-row-cells-${materialId}-${parentUnitId}"]`);
      }
      
      if (await subRow.first().isVisible({ timeout: 500 }).catch(() => false)) {
        // Extract all numbered-cells within this sub-row
        const testIds = await subRow.locator(`[data-testid*="numbered-cell-${materialId}-"]`)
          .evaluateAll((els: any[]) => els.map(e => e.getAttribute('data-testid')).filter(id => id && !id.includes('increment') && !id.includes('decrement')))
          .catch(() => []);
        
        // For each child found, extract its unit ID and value
        const children: number[] = [];
        for (const testId of testIds) {
          const match = testId?.match(/numbered-cell-[^-]+-(\d+)/);  // Extract unit ID
          if (match) {
            const unitId = parseInt(match[1], 10);
            // Skip if it's the parent itself or already added
            if (unitId !== parentUnitId && !children.includes(unitId)) {
              children.push(unitId);
              // Get the child's value and store it
              const val = parseInt(
                await this.page.locator(`[data-testid="${testId}"]`).locator('[data-testid*="input"]').first().inputValue().catch(() => '0'),
                10
              );
              allCellValues.set(unitId, val);
            }
          }
        }
        // Remember which children belong to this parent
        hierarchyMap.set(parentUnitId, children);
      } else {
        hierarchyMap.set(parentUnitId, []);
      }
    }

    // ============ STEP 3: Store hierarchy map for verification ============
    (this as any)._hierarchyMap = hierarchyMap;
    return allCellValues;
  }

  /**
   * Verify that parent values equal the sum of their visible children
   * 
   * AGGREGATION RULE: Parent cell value = SUM(all visible child cell values)
   * 
   * STEP 1: Get parent value and its children
   * - For each parent unit in the expanded path
   * - Get the parent's cell value from allVisibleValues
   * - Get the list of visible children from hierarchyMap
   * 
   * STEP 2: Sum the children values
   * - For each child of this parent
   * - Add the child's value to the running sum
   * 
   * STEP 3: Compare parent === sum(children)
   * - Check if parent value equals the sum of all children values
   * - Log result: ✓ if equal, ✗ if not equal
   * - Return false if ANY parent fails the check
   * 
   * EXAMPLE:
   * Unit 2 (parent) = 50
   *   └─ Unit 12 (parent) = 50
   *       ├─ Unit 52 (child) = 20
   *       └─ Unit 53 (child) = 30
   * 
   * Verification:
   * ✓ Unit 2: 50 === 50 (sum of [12])
   * ✓ Unit 12: 50 === 50 (20 + 30)
   * 
   * @param materialId - The material/makat ID
   * @param unitsToExpand - The hierarchy path that was expanded
   * @param allVisibleValues - Map of all captured unitId → value pairs
   * @returns boolean - True if all parent-child aggregations are valid, false otherwise
   */
  async verifyAggregationWithAllVisibleCells(
    materialId: string,
    unitsToExpand: number[],
    allVisibleValues: Map<number, number>
  ): Promise<boolean> {
    // Retrieve the hierarchy map that was stored during capture phase
    const hierarchyMap: Map<number, number[]> = (this as any)._hierarchyMap || new Map();
    let allChecksPass = true;

    console.log(`\n[AGGREGATION VERIFICATION]`);
    
    // For each parent in the expanded path
    for (const parentUnitId of unitsToExpand) {
      // STEP 1: Get parent value and its children
      const parentValue = allVisibleValues.get(parentUnitId) ?? 0;
      const children = hierarchyMap.get(parentUnitId) || [];
      
      // Skip if this parent has no children (it's a leaf)
      if (children.length === 0) continue;

      // STEP 2: Sum all children values
      let childrenSum = 0;
      for (const childId of children) {
        childrenSum += allVisibleValues.get(childId) ?? 0;
      }

      // STEP 3: Compare parent === sum(children)
      const isPassed = parentValue === childrenSum;
      const status = isPassed ? '✓' : '✗';
      console.log(`  ${status} Unit ${parentUnitId}: ${parentValue} ${isPassed ? '===' : '≠'} ${childrenSum}`);
      
      if (!isPassed) allChecksPass = false;
    }

    return allChecksPass;
  }

  /**
   * Open comment dialog for a specific row (material)
   * 
   * FLOW: Click the row-comment-dialog trigger button to open the comment dialog
   * 
   * @param materialId - The material ID to add comment for
   * @returns true if dialog opened successfully
   */
  async openCommentDialog(materialId: string): Promise<boolean> {
    try {
      // Find the trigger button for this material's comment dialog
      // Format: row-comment-dialog-{materialId}-trigger
      const commentTrigger = this.page.getByTestId(`row-comment-dialog-${materialId}-trigger`);
      
      if (await commentTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
        await commentTrigger.click();
        await this.page.waitForLoadState('networkidle');
        console.log(`✓ Comment dialog opened for material ${materialId}`);
        return true;
      } else {
        console.warn(`Comment trigger not visible for material ${materialId}`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to open comment dialog: ${error}`);
      return false;
    }
  }

  /**
   * Add a comment to a material row
   * 
   * FLOW: Type comment in the comment text area and save
   * 
   * @param materialId - The material ID to add comment for
   * @param commentText - The comment text to add
   * @returns true if comment was added successfully
   */
  async addCommentToMaterial(materialId: string, commentText: string): Promise<boolean> {
    try {
      // Format: row-comment-content-{materialId}
      const commentInput = this.page.getByTestId(`row-comment-content-${materialId}`);
      
      if (await commentInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Clear any existing text
        await commentInput.fill('');
        // Type the new comment
        await commentInput.fill(commentText);
        console.log(`✓ Comment text entered for material ${materialId}: "${commentText}"`);
        return true;
      } else {
        console.warn(`Comment input not visible for material ${materialId}`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to add comment: ${error}`);
      return false;
    }
  }

  /**
   * Save comment and close the comment dialog
   * 
   * FLOW: Click the save button to persist the comment
   * 
   * @param materialId - The material ID to save comment for
   * @returns true if comment was saved successfully
   */
  async saveComment(materialId: string): Promise<boolean> {
    try {
      // Format: row-comment-save-{materialId}
      const saveBtn = this.page.getByTestId(`row-comment-save-${materialId}`);
      
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveBtn.click();
        await this.waitForNetworkIdle();
        console.log(`✓ Comment saved for material ${materialId}`);
        return true;
      } else {
        console.warn(`Save button not visible for material ${materialId}`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to save comment: ${error}`);
      return false;
    }
  }

  /**
   * Close comment dialog by pressing Escape
   * 
   * FLOW: Press Escape to close the comment dialog
   * 
   * @returns true if dialog was closed successfully
   */
  async closeCommentDialog(): Promise<boolean> {
    try {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500); // Small delay for dialog to close
      console.log('✓ Comment dialog closed');
      return true;
    } catch (error) {
      console.error(`Failed to close comment dialog: ${error}`);
      return false;
    }
  }

  /**
   * Verify that a comment was saved for a material
   * 
   * FLOW: Open the comment dialog and check if the comment text is present
   * 
   * @param materialId - The material ID to check
   * @param expectedCommentText - The expected comment text
   * @returns true if comment is present and matches expected text
   */
  async verifyCommentExists(materialId: string, expectedCommentText: string): Promise<boolean> {
    try {
      // Open the comment dialog
      const dialogOpened = await this.openCommentDialog(materialId);
      if (!dialogOpened) {
        console.warn(`Could not open comment dialog for verification`);
        return false;
      }

      // Get the comment input and check its value
      const commentInput = this.page.getByTestId(`row-comment-content-${materialId}`);
      const commentValue = await commentInput.inputValue();
      
      if (commentValue && commentValue.includes(expectedCommentText)) {
        console.log(`✓ Comment verified for material ${materialId}: "${commentValue}"`);
        await this.closeCommentDialog();
        return true;
      } else {
        console.warn(`Comment not found or does not match. Found: "${commentValue}"`);
        await this.closeCommentDialog();
        return false;
      }
    } catch (error) {
      console.error(`Failed to verify comment: ${error}`);
      return false;
    }
  }
}
