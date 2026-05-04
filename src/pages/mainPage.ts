import { Page, Locator, expect } from '@playwright/test';

/**
 * MainPage - Base Page Object for the application.
 *
 * Contains shared locators and methods reused across page objects:
 * - The `.committees-header` section (organized as a header object)
 * - The `material-search-combobox-chips` element
 * - Makat (material) selection & addition workflow
 * - Generic cell value capture used by aggregation flows
 *
 * All page classes extend this base.
 */
export class MainPage {
  readonly page: Page;

  /** Organized group of header elements within .committees-header */
  public readonly header: {
    /** The root header container (.committees-header) */
    readonly container: Locator;
    /** Confirmation popup trigger inside the header */
    readonly confirmationPopupTrigger: Locator;
    /** Confirmation popup confirm button inside the header */
    readonly confirmationPopupConfirmBtn: Locator;
    /** Save button in the header area */
    readonly saveBtn: Locator;
    /** Menu / drawer trigger button */
    readonly menuBtn: Locator;
  };

  /** Material search combobox chips element */
  readonly materialSearchChips: Locator;

  /** Makat search field container (.material-search-combobox-container) */
  readonly makatSearchField: Locator;

  /**
   * Comment trigger icon locator – matches all rows.
   * The underlying `data-testid` is dynamic, e.g. `row-comment-trigger-icon-000000001`,
   * so a partial attribute selector (`*=`) is used.
   * Use {@link commentTriggerIconFor} to scope to a specific Makat ID.
   */
  readonly commentTriggerIcon: Locator;

  /** Drawer content area for unit hierarchy */
  protected readonly unitHierarchyDrawerContent: Locator;
  /** Inner content container for unit hierarchy */
  protected readonly unitHierarchyContent: Locator;

  // ──────────────── Makat / Table Locators ────────────────

  /** Makat (material) search combobox */
  protected readonly makatCombobox: Locator;
  /** Dropdown options inside the makat combobox */
  protected readonly makatOptions: Locator;
  /** "Add Makat" submit button */
  protected readonly addMakatButton: Locator;
  /** All content rows in the table */
  protected readonly contentRows: Locator;

  /**
   * Internal hierarchy map populated by {@link captureAllVisibleCellValuesAtEachLevel}
   * and consumed by aggregation verification routines in subclasses.
   */
  protected _hierarchyMap: Map<number, number[]> = new Map();

  constructor(page: Page) {
    this.page = page;

    // Drawer
    this.unitHierarchyDrawerContent = page.getByTestId('unit-hierarchy-drawer-content');
    this.unitHierarchyContent = page.getByTestId('unit-hierarchy-content');

    // Header elements group
    const headerContainer = page.getByTestId('committees-header');
    this.header = {
      container: headerContainer,
      confirmationPopupTrigger: page.locator('[data-testid="dialog-trigger-unit-hierarchy-header-confirmation-popup"]'),
      confirmationPopupConfirmBtn: page.locator('[data-testid="unit-hierarchy-header-confirmation-popup-confirm-button"]'),
      saveBtn: page.getByTestId('save-button-icon'),
      menuBtn: page.getByTestId('drawer-trigger-unit-hierarchy-drawer'),
    };

    // Material search combobox chips
    this.materialSearchChips = page.getByTestId('combobox-chips-material-search-combobox');

    // Makat search field container
    this.makatSearchField = page.getByTestId('material-search');

    // Comment trigger icon (dynamic data-testid: row-comment-trigger-icon-<makatId>)
    this.commentTriggerIcon = page.locator('[data-testid*="row-comment-trigger-icon"]');

    // Makat selection
    this.makatCombobox = page.getByRole('combobox', { name: /בחירת מק״ט/ });
    this.makatOptions = page.locator('[role="option"]');

    // Add Makat button – the "+" button scoped by its StartAdornment class
    this.addMakatButton = page.locator('button[data-testid="button"][class*="StartAdornment"]');

    // Table rows
    this.contentRows = page.locator('[data-testid*="content-row"]');
  }

  // ──────────────── Locator Helpers ────────────────

  /**
   * Returns the comment trigger icon locator for a specific Makat ID.
   * Handles dynamic test IDs such as `row-comment-trigger-icon-000000001`.
   */
  commentTriggerIconFor(makatId: string): Locator {
    return this.page.locator(`[data-testid="row-comment-trigger-icon-${makatId}"]`);
  }

  /** Numbered cell locator for a (materialId, unitId) pair. */
  protected numberedCell(materialId: string, unitId: number): Locator {
    return this.page.locator(`[data-testid*="numbered-cell-${materialId}-${unitId}"]`).first();
  }

  /** Top-level row cell locator for a (materialId, unitId) pair. */
  protected rowCell(materialId: string, unitId: number): Locator {
    return this.page.locator(`[data-testid="row-cell-${materialId}-${unitId}"]`);
  }

  /** Sub-row cells wrapper container under a parent unit. */
  protected subRowCellsWrapper(materialId: string, parentUnitId: number): Locator {
    return this.page.locator(`[data-testid="sub-row-cells-wrapper-${materialId}-${parentUnitId}"]`);
  }

  /** Sub-row cells container under a parent unit. */
  protected subRowCells(materialId: string, parentUnitId: number): Locator {
    return this.page.locator(`[data-testid="sub-row-cells-${materialId}-${parentUnitId}"]`);
  }

  /**
   * Resolves a visible sub-row container for a given parent unit, trying the
   * wrapper first and falling back to the inner cells container.
   */
  protected async findVisibleSubRow(materialId: string, parentUnitId: number): Promise<Locator | null> {
    let subRow = this.subRowCellsWrapper(materialId, parentUnitId);
    if (await subRow.first().isVisible({ timeout: 500 }).catch(() => false)) return subRow;

    subRow = this.subRowCells(materialId, parentUnitId);
    if (await subRow.first().isVisible({ timeout: 500 }).catch(() => false)) return subRow;

    return null;
  }

  // ──────────────── Utility Methods ────────────────

  /**
   * Wait for network requests to complete and page to be fully interactive.
   */
  async waitForPageReady(): Promise<void> {
    try {
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForLoadState('networkidle');
    } catch (error) {
      console.warn(`[waitForPageReady] Some network waits timed out, continuing: ${error}`);
    }
  }

  /**
   * Wait for network requests to complete.
   */
  async waitForNetworkIdle(): Promise<void> {
    try {
      await this.page.waitForLoadState('networkidle');
    } catch {
      // Silently catch – page may still be functional
    }
  }

  // ──────────────── Navigation ────────────────

  /**
   * Navigate to the application root and wait for full initialisation.
   */
  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.waitForPageReady();
  }

  /**
   * Open the unit hierarchy drawer if it is not already open.
   */
  async ensureDrawerOpen(): Promise<void> {
    try {
      const isVisible = await this.unitHierarchyDrawerContent.isVisible({ timeout: 2000 }).catch(() => false);

      if (!isVisible) {
        console.info(`[ensureDrawerOpen] Drawer not visible, opening it...`);
        await this.header.menuBtn.click();
        await this.unitHierarchyDrawerContent.waitFor({ state: 'visible', timeout: 5000 });
        console.info(`[ensureDrawerOpen] Drawer opened successfully`);
      }
    } catch (error) {
      console.warn(`[ensureDrawerOpen] Failed to open drawer: ${error}`);
    }
  }

  // ──────────────── Makat Management (search field) ────────────────

  /**
   * Searches for a Makat by ID in the search field and adds it.
   *
   * Flow:
   *  1. Click into the `.material-search-combobox-container` input.
   *  2. Type the Makat ID.
   *  3. Pick the matching dropdown option.
   *
   * @param makatId The material/Makat identifier to search for and add.
   */
  async addMakat(makatId: string): Promise<void> {
    console.info(`[addMakat] Adding Makat: ${makatId}`);
    try {
      await this.makatSearchField.waitFor({ state: 'visible', timeout: 10_000 });

      const input = this.makatSearchField.locator('input').first();
      await input.click();
      await input.fill(makatId);

      // Wait for the dropdown option matching the makat ID and click it.
      const option = this.page
        .locator('[role="option"], [data-testid*="material-search-option"]')
        .filter({ hasText: makatId })
        .first();

      await option.waitFor({ state: 'visible', timeout: 10_000 });
      await option.click();

      await this.waitForNetworkIdle();
      console.info(`[addMakat] Successfully added Makat: ${makatId}`);
    } catch (error) {
      console.error(`[addMakat] Failed to add Makat ${makatId}: ${error}`);
      throw error;
    }
  }

  /**
   * Finds the row for a given Makat and clicks its comment trigger icon,
   * then writes the supplied comment text.
   *
   * Handles dynamic test IDs such as `row-comment-trigger-icon-000000001`
   * via {@link commentTriggerIconFor}.
   *
   * @param makatId The Makat identifier whose row should receive the comment.
   * @param text    The comment text to enter.
   */
  async addComment(makatId: string, text: string): Promise<void> {
    console.info(`[addComment] Adding comment to Makat ${makatId}`);
    try {
      const icon = this.commentTriggerIconFor(makatId);
      await icon.waitFor({ state: 'visible', timeout: 10_000 });
      await icon.click();

      // Locate the comment editor that appears after clicking the icon.
      const commentField = this.page
        .locator(
          '[data-testid*="comment-input"], [data-testid*="comment-textarea"], textarea[placeholder*="comment" i], input[placeholder*="comment" i]'
        )
        .first();

      await commentField.waitFor({ state: 'visible', timeout: 5_000 });
      await commentField.fill(text);

      console.info(`[addComment] Comment added to Makat ${makatId}`);
    } catch (error) {
      console.error(`[addComment] Failed to add comment to Makat ${makatId}: ${error}`);
      throw error;
    }
  }

  // ──────────────── Makat Selection & Addition (combobox) ────────────────

  /**
   * Wait until the Makat combobox is visible and enabled.
   */
  async waitForMakatComboboxReady(timeout: number = 15000): Promise<void> {
    console.info(`[waitForMakatComboboxReady] Waiting for makat combobox to be ready (${timeout}ms)...`);
    try {
      // The combobox can briefly disappear/remount while React rehydrates
      // after the lock & hierarchy fetches finish. Use waitForSelector to
      // poll the DOM until the element exists, then assert visibility.
      await this.page.waitForSelector('[role="combobox"]', {
        state: 'visible',
        timeout,
      });

      await expect(this.makatCombobox).toBeVisible({ timeout: 10_000 });
      await expect(this.makatCombobox).toBeEnabled({ timeout: Math.min(10_000, timeout) });

      // Let React finish any in-flight remount before consumers click.
      await this.page.waitForTimeout(500);
      await expect(this.makatCombobox).toBeVisible({ timeout: 5_000 });

      await this.makatCombobox.scrollIntoViewIfNeeded();
      console.info(`[waitForMakatComboboxReady] Makat combobox is ready`);
    } catch (error) {
      console.error(`[waitForMakatComboboxReady] Failed: ${error}`);
      throw error;
    }
  }

  /**
   * Open the Makat combobox, type the material ID, and pick the first match.
   */
  async selectMakatFromDropdown(materialIdOrText: string): Promise<void> {
    console.info(`[selectMakatFromDropdown] Selecting material: ${materialIdOrText}`);
    try {
      await this.waitForMakatComboboxReady(30000);

      const isDisabled = await this.makatCombobox.evaluate((el: any) => el.hasAttribute('disabled'));
      if (isDisabled) {
        throw new Error(`Combobox is disabled for material ${materialIdOrText}`);
      }

      console.info(`[selectMakatFromDropdown] Clicking combobox...`);
      await this.makatCombobox.click({ timeout: 5000, force: false });

      console.info(`[selectMakatFromDropdown] Waiting for dropdown options to appear...`);
      await this.makatOptions.first().waitFor({ state: 'visible', timeout: 8000 });

      console.info(`[selectMakatFromDropdown] Typing material ID: ${materialIdOrText}`);
      await this.makatCombobox.fill(materialIdOrText);

      await this.page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length > 0,
        '[role="option"]',
        { timeout: 6000 }
      );

      const count = await this.makatOptions.count();
      if (count === 0) {
        throw new Error(`No Makat options found for: ${materialIdOrText}`);
      }

      console.info(`[selectMakatFromDropdown] Found ${count} option(s), clicking first one...`);
      await this.makatOptions.first().click({ timeout: 5000 });

      console.info(`[selectMakatFromDropdown] Successfully selected: ${materialIdOrText}`);
    } catch (error) {
      console.error(`[selectMakatFromDropdown] Failed for material ${materialIdOrText}: ${error}`);
      throw error;
    }
  }

  /** Click the "+" button that adds the currently selected material. */
  async clickAddMakatAdornment(): Promise<void> {
    await this.addMakatButton.click();
  }

  /**
   * High-level helper: select a Makat from the dropdown and add it to the table.
   * Skips the operation if the material is already present.
   */
  async addMakatFromDropdown(materialIdOrText: string): Promise<void> {
    console.info(`[addMakatFromDropdown] Checking if material already exists: ${materialIdOrText}`);
    try {
      const alreadyAdded = await this.verifyMaterialIdInRow(materialIdOrText);
      if (alreadyAdded) {
        console.info(`[addMakatFromDropdown] Material ${materialIdOrText} already exists in table, skipping add`);
        return;
      }

      console.info(`[addMakatFromDropdown] Material not found, adding: ${materialIdOrText}`);

      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await this.selectMakatFromDropdown(materialIdOrText);
          break;
        } catch (error) {
          if (attempt === maxRetries) throw error;
          console.warn(`[addMakatFromDropdown] Selection attempt ${attempt} failed, retrying...`);
          await this.goto();
          await this.page.waitForLoadState('networkidle');
          await this.waitForMakatComboboxReady(30000);
        }
      }

      await this.addMakatButton.click();
      await this.waitForMaterialRow(materialIdOrText);

      console.info(`[addMakatFromDropdown] Successfully added material: ${materialIdOrText}`);
    } catch (error) {
      console.error(`[addMakatFromDropdown] Failed to add material ${materialIdOrText}: ${error}`);
      throw error;
    }
  }

  /** Waits until a row containing the given material ID is rendered. */
  async waitForMaterialRow(materialId: string, timeout = 15000): Promise<void> {
    console.info(`[waitForMaterialRow] Waiting for material ${materialId} to appear in table...`);
    await this.page.waitForFunction(
      (id) => {
        const rows = document.querySelectorAll('[data-testid*="content-row"]');
        return Array.from(rows).some(
          (row) =>
            row.getAttribute('data-testid')?.includes(id) ||
            row.textContent?.includes(id)
        );
      },
      materialId,
      { timeout }
    );
    console.info(`[waitForMaterialRow] Material ${materialId} is now visible in table`);
  }

  /** Returns true if any rendered row references the given material ID. */
  async verifyMaterialIdInRow(materialId: string): Promise<boolean> {
    try {
      const count = await this.contentRows.count();
      for (let i = 0; i < count; i++) {
        const row = this.contentRows.nth(i);
        const rowTestId = await row.getAttribute('data-testid').catch(() => null);
        if (rowTestId?.includes(materialId)) return true;
        const rowText = await row.textContent().catch(() => '');
        if (rowText?.includes(materialId)) return true;
      }
      return false;
    } catch (e) {
      console.error('Error verifying material ID in row:', e);
      return false;
    }
  }

  // ──────────────── Cell Value Capture ────────────────

  /**
   * Reads the numeric value displayed for a given (materialId, unitId) cell.
   * Tries the top-level `row-cell-*` first and falls back to `numbered-cell-*`.
   * Returns 0 when the cell is not present or has no input value.
   *
   * Optimised: performs the visibility / fallback resolution inside a single
   * `page.evaluate` call so we don't pay for two sequential Playwright
   * round-trips with 500ms timeouts.
   */
  async getCellValue(materialId: string, unitId: number): Promise<number> {
    const raw = await this.page.evaluate(
      ({ materialId, unitId }) => {
        const readInput = (root: Element | null): string | null => {
          if (!root) return null;
          const input = root.querySelector('[data-testid*="input"]') as HTMLInputElement | null;
          if (!input) return null;
          return input.value ?? null;
        };

        // Try top-level row-cell first.
        const rowCell = document.querySelector(
          `[data-testid="row-cell-${materialId}-${unitId}"]`
        );
        const fromRow = readInput(rowCell);
        if (fromRow != null && fromRow !== '') return fromRow;

        // Fallback: any numbered-cell match.
        const numbered = document.querySelector(
          `[data-testid*="numbered-cell-${materialId}-${unitId}"]`
        );
        const fromNumbered = readInput(numbered);
        return fromNumbered ?? '0';
      },
      { materialId, unitId }
    );
    return parseInt(raw || '0', 10);
  }

  /**
   * Walks the requested unit path and captures the value of every visible
   * cell at each level (parents and any rendered children).
   *
   * Side-effect: populates {@link _hierarchyMap} with the parent → children
   * relationship discovered while traversing, so subclasses can perform
   * aggregation checks against the captured snapshot.
   *
   * PERFORMANCE: The previous implementation issued dozens of sequential
   * Playwright calls (each with 500ms visibility timeouts) which made this
   * step the dominant cost of `test_aggregationVerification`. This version
   * gathers everything we need from the DOM in a single `page.evaluate`,
   * reducing the cost from many seconds to a few milliseconds.
   */
  async captureAllVisibleCellValuesAtEachLevel(
    materialId: string,
    unitsToExpand: number[]
  ): Promise<Map<number, number>> {
    const snapshot = await this.page.evaluate(
      ({ materialId, unitsToExpand }) => {
        // Helpers ────────────────────────────────────────────────────────
        const isVisible = (el: Element | null): boolean => {
          if (!el) return false;
          const he = el as HTMLElement;
          if (he.offsetParent === null && getComputedStyle(he).position !== 'fixed') {
            return false;
          }
          const rect = he.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const readInputValue = (root: Element | null): string => {
          if (!root) return '0';
          const input = root.querySelector('[data-testid*="input"]') as HTMLInputElement | null;
          return input?.value ?? '0';
        };

        const getCellValueDom = (unitId: number): number => {
          const rowCell = document.querySelector(
            `[data-testid="row-cell-${materialId}-${unitId}"]`
          );
          let raw = readInputValue(rowCell);
          if (!raw || raw === '0') {
            const numbered = document.querySelector(
              `[data-testid*="numbered-cell-${materialId}-${unitId}"]`
            );
            const altRaw = readInputValue(numbered);
            // Prefer numbered value if rowCell missing/empty.
            if (!rowCell) raw = altRaw;
            else if (altRaw && altRaw !== '0') raw = altRaw;
          }
          return parseInt(raw || '0', 10);
        };

        const findVisibleSubRow = (parentUnitId: number): Element | null => {
          const wrapper = document.querySelector(
            `[data-testid="sub-row-cells-wrapper-${materialId}-${parentUnitId}"]`
          );
          if (isVisible(wrapper)) return wrapper;

          const inner = document.querySelector(
            `[data-testid="sub-row-cells-${materialId}-${parentUnitId}"]`
          );
          if (isVisible(inner)) return inner;
          return null;
        };

        // Capture path values ────────────────────────────────────────────
        const allCellValues: Array<[number, number]> = [];
        for (const unitId of unitsToExpand) {
          allCellValues.push([unitId, getCellValueDom(unitId)]);
        }

        // For each parent, find visible numbered children + their values.
        const hierarchy: Array<[number, number[]]> = [];
        const seenChildren = new Set<number>(unitsToExpand);

        for (const parentUnitId of unitsToExpand) {
          const subRow = findVisibleSubRow(parentUnitId);
          if (!subRow) {
            hierarchy.push([parentUnitId, []]);
            continue;
          }

          const cellEls = Array.from(
            subRow.querySelectorAll(`[data-testid*="numbered-cell-${materialId}-"]`)
          );

          const children: number[] = [];
          for (const el of cellEls) {
            const tid = el.getAttribute('data-testid') ?? '';
            if (tid.includes('increment') || tid.includes('decrement')) continue;

            const m = tid.match(/numbered-cell-[^-]+-(\d+)/);
            if (!m) continue;
            const childUnitId = parseInt(m[1], 10);
            if (childUnitId === parentUnitId) continue;
            if (children.includes(childUnitId)) continue;

            children.push(childUnitId);
            if (!seenChildren.has(childUnitId)) {
              seenChildren.add(childUnitId);
              allCellValues.push([childUnitId, getCellValueDom(childUnitId)]);
            }
          }
          hierarchy.push([parentUnitId, children]);
        }

        return { allCellValues, hierarchy };
      },
      { materialId, unitsToExpand }
    );

    const allCellValues = new Map<number, number>(snapshot.allCellValues);
    const hierarchyMap = new Map<number, number[]>(snapshot.hierarchy);

    this._hierarchyMap = hierarchyMap;
    return allCellValues;
  }

  // ──────────────── Hierarchy Navigation ────────────────

  /**
   * Recursively expands the unit hierarchy tree until every visible branch
   * reaches a leaf node (i.e. no more collapsed/expandable nodes remain).
   *
   * A node is considered expandable if it exposes an aria-expanded="false"
   * attribute or a generic expand/toggle test-id.
   *
   * @param maxDepth Safety guard against infinite recursion (default: 20).
   */
  async expandToLeaf(maxDepth: number = 20): Promise<void> {
    if (maxDepth <= 0) {
      console.warn(`[expandToLeaf] Max recursion depth reached, stopping.`);
      return;
    }

    const collapsedNodes = this.page.locator(
      '[aria-expanded="false"], [data-testid*="expand-trigger"], [data-testid*="toggle-expand"]'
    );

    const count = await collapsedNodes.count().catch(() => 0);
    if (count === 0) {
      console.info(`[expandToLeaf] No more collapsed nodes – fully expanded.`);
      return;
    }

    console.info(`[expandToLeaf] Expanding ${count} node(s) at depth ${21 - maxDepth}`);

    for (let i = 0; i < count; i++) {
      const node = collapsedNodes.nth(i);
      try {
        if (await node.isVisible({ timeout: 500 }).catch(() => false)) {
          await node.click({ timeout: 2_000 }).catch(() => {});
        }
      } catch {
        // Node may have been replaced by re-render – ignore and continue.
      }
    }

    await this.waitForNetworkIdle();
    // Recurse to expand any newly revealed children.
    await this.expandToLeaf(maxDepth - 1);
  }
}
