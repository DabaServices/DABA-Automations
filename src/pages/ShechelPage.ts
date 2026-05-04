import { Page, Locator } from '@playwright/test';
import { MainPage } from './MainPage';

/**
 * ShechelPage - Extends {@link MainPage} with workflow-specific logic for the
 * Shechel / Mlai screens: hierarchy expansion, leaf cell editing, aggregation
 * verification, hierarchy unit moves, and per-row comment dialogs.
 *
 * Generic Makat selection/addition and cell value capture live in
 * {@link MainPage} and are reused via inheritance.
 */
export class ShechelPage extends MainPage {

  // ──────────────── Static Locators ────────────────

  /** Sub-row expansion indicators */
  private readonly subRowExpands: Locator;

  /** Zero-cell chips (empty leaf cells) */
  private readonly zeroCellChips: Locator;
  /** Numbered-cell input fields */
  private readonly numberedCellInputs: Locator;

  /** First content row in the table (Shechel-specific shortcut). */
  private readonly firstRow: Locator;

  /** First dialog container on the page */
  private readonly dialogContainer: Locator;

  constructor(page: Page) {
    super(page);

    this.firstRow = page.locator('[data-testid*="content-row"]').first();
    this.subRowExpands = page.locator('[data-testid*="sub-row-indicator"]');

    // Cell locators
    this.zeroCellChips = page.locator('[data-testid*="zero-cell"]');
    this.numberedCellInputs = page.locator('[data-testid*="numbered-cell"] [data-testid*="input"]');

    // Dialogs
    this.dialogContainer = page.locator('[role="dialog"]').first();
  }

  // ──────────────── Dynamic Locator Helpers ────────────────

  private networkButton(materialId: string, unitId: number): Locator {
    return this.page.locator(`[data-testid="cell-controls-network-${materialId}-${unitId}"]`).first();
  }

  private zeroCellsUnder(subRow: Locator, materialId: string): Locator {
    return subRow.locator(`[data-testid*="zero-cell-icon-${materialId}-"]`);
  }

  private numberedCellsUnder(subRow: Locator, materialId: string): Locator {
    return subRow.locator(`[data-testid*="numbered-cell-${materialId}-"]`);
  }

  private deleteIcon(materialId: string): Locator {
    return this.page.getByTestId(`row-delete-trigger-icon-${materialId}`);
  }

  private deleteConfirmBtn(materialId: string): Locator {
    return this.page.getByTestId(`row-delete-current-type-${materialId}`);
  }

  private hierarchyExpandTooltip(unitId: number): Locator {
    return this.page.locator(`[data-testid="tooltip-trigger-unit-hierarchy-row-expand-tooltip-${unitId}"]`);
  }

  private hierarchyComboboxInput(parentId: number): Locator {
    return this.page.locator(`[data-testid="unit-hierarchy-node-combobox-${parentId}-input"]`);
  }

  private hierarchyComboboxItem(parentId: number, unitId: number): Locator {
    return this.page.locator(`[data-testid="unit-hierarchy-node-combobox-${parentId}-item-${unitId}"]`);
  }

  private hierarchyComboboxActionBtn(parentId: number): Locator {
    return this.page.locator(`[data-testid="button-unit-hierarchy-node-combobox-${parentId}-action-button"]`);
  }

  private commentTrigger(materialId: string): Locator {
    return this.page.getByTestId(`dialog-trigger-row-comment-dialog-${materialId}`);
  }

  private commentContent(materialId: string): Locator {
    return this.page.getByTestId(`row-comment-content-${materialId}`);
  }

  private commentSaveBtn(materialId: string): Locator {
    return this.page.getByTestId(`row-comment-save-${materialId}`);
  }

  // ──────────────── Save / Delete ────────────────

  async saveMaterial(): Promise<void> {
    console.info(`[saveMaterial] Attempting to save material`);
    try {
      await this.header.saveBtn.waitFor({ state: 'visible', timeout: 10000 });
      await this.header.saveBtn.waitFor({ state: 'attached', timeout: 5000 });
      await this.page.waitForFunction(
        (selector) => {
          const el = document.querySelector(selector);
          if (!el) return false;
          const btn = el.closest('button') || el;
          return !btn.hasAttribute('disabled') && !(btn as HTMLButtonElement).disabled;
        },
        '[data-testid="save-button-icon"]',
        { timeout: 15000 }
      );

      await this.header.saveBtn.click();
      await this.waitForNetworkIdle();
      console.info(`[saveMaterial] Material saved successfully`);
    } catch (error) {
      console.error(`[saveMaterial] Failed to save material: ${error}`);
      throw error;
    }
  }

  async deleteMakat(materialId: string): Promise<boolean> {
    console.info(`[deleteMakat] Attempting to delete material ${materialId}`);
    try {
      const icon = this.deleteIcon(materialId);
      await icon.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

      if (await icon.isVisible({ timeout: 3000 }).catch(() => false)) {
        await this.page.waitForFunction(
          (testId) => {
            const el = document.querySelector(`[data-testid="${testId}"]`);
            if (!el) return false;
            const btn = el.closest('button') || el.parentElement?.closest('button') || el;
            const style = window.getComputedStyle(el);
            return !btn.hasAttribute('disabled') &&
                   !(btn as HTMLButtonElement).disabled &&
                   style.pointerEvents !== 'none';
          },
          `row-delete-trigger-icon-${materialId}`,
          { timeout: 15000 }
        );
        await icon.click();
        console.log(`[deleteMakat] Delete trigger icon clicked for material ${materialId}`);
      } else {
        console.warn(`[deleteMakat] Delete trigger icon not found for material ${materialId}`);
        return false;
      }

      const confirmBtn = this.deleteConfirmBtn(materialId);
      await confirmBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {
        console.warn(`[deleteMakat] Delete confirmation button may not be immediately visible`);
      });

      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
        console.log(`[deleteMakat] Delete confirmation button clicked for material ${materialId}`);
      } else {
        console.warn(`[deleteMakat] Delete confirmation button not found for material ${materialId}`);
        return false;
      }

      await this.waitForNetworkIdle();
      console.info(`[deleteMakat] Material ${materialId} deleted successfully`);
      return true;
    } catch (error) {
      console.error(`[deleteMakat] Failed to delete material ${materialId}: ${error}`);
      throw error;
    }
  }

  // ──────────────── Row Expansion ────────────────

  async expandHierarchyToLeaf(materialId: string, unitsToExpand: number[]): Promise<boolean> {
    console.info(`[expandHierarchyToLeaf] Expanding path for ${materialId}: ${unitsToExpand.join(' -> ')}`);
    let expanded = false;

    for (let i = 0; i < unitsToExpand.length; i++) {
      const unitId = unitsToExpand[i];

      // Resolve the cell for this unit. Top-level units use `row-cell-...`,
      // children of an expanded row use `sub-row-cell-...`, and group/leaf
      // cells use `numbered-cell-...`. Try them in order of likelihood.
      let cell = this.page.locator(`[data-testid="row-cell-${materialId}-${unitId}"]`).first();
      if (!(await cell.count())) {
        cell = this.page.locator(`[data-testid="sub-row-cell-${materialId}-${unitId}"]`).first();
      }
      if (!(await cell.count())) {
        cell = this.numberedCell(materialId, unitId);
      }

      const cellCount = await cell.count();
      if (!cellCount) {
        console.warn(`[expandHierarchyToLeaf] No cell found for unit ${unitId} (material ${materialId}) — stopping.`);
        break;
      }

      // Make sure the cell is in view, then hover to reveal the network button
      try {
        await cell.first().scrollIntoViewIfNeeded({ timeout: 2000 });
        await cell.first().hover({ timeout: 2000 });
      } catch (e) {
        console.warn(`[expandHierarchyToLeaf] Could not hover cell for unit ${unitId}: ${e}`);
      }

      const networkBtn = this.networkButton(materialId, unitId);
      const btnVisible = await networkBtn.isVisible({ timeout: 1500 }).catch(() => false);

      if (!btnVisible) {
        // If this is the leaf in the requested path, that's expected.
        if (i === unitsToExpand.length - 1) {
          console.info(`[expandHierarchyToLeaf] No network button on leaf unit ${unitId} — leaf reached.`);
          // Wait for the parent's sub-row-cells-wrapper to fully render so
          // setLeafCellValues can find the leaf cells immediately after.
          if (i > 0) {
            const parentUnitId = unitsToExpand[i - 1];
            await this.page
              .waitForSelector(
                `[data-testid="sub-row-cells-wrapper-${materialId}-${parentUnitId}"]`,
                { state: 'visible', timeout: 10_000 }
              )
              .catch(() => {
                console.warn(
                  `[expandHierarchyToLeaf] sub-row-cells-wrapper for parent ${parentUnitId} did not appear in time.`
                );
              });
          }
          break;
        }
        console.warn(`[expandHierarchyToLeaf] Network button not visible for unit ${unitId} — cannot continue.`);
        break;
      }

      console.info(`[expandHierarchyToLeaf] Clicking network button for unit ${unitId} (step ${i + 1}/${unitsToExpand.length})`);
      await networkBtn.click();
      expanded = true;

      // Wait for the next level to render (look for either kind of cell)
      if (i + 1 < unitsToExpand.length) {
        const nextUnit = unitsToExpand[i + 1];
        const nextCell = this.page.locator(
          `[data-testid="row-cell-${materialId}-${nextUnit}"], [data-testid="sub-row-cell-${materialId}-${nextUnit}"], [data-testid*="numbered-cell-${materialId}-${nextUnit}"]`
        ).first();
        await nextCell.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
          console.warn(`[expandHierarchyToLeaf] Next-level cell for unit ${nextUnit} did not appear in time.`);
        });
      } else {
        // Last expansion in the path: wait for the leaf's children container
        // (`sub-row-cells-wrapper-${mat}-${unit}`) to actually render.
        // Without this, setLeafCellValues runs against an empty subtree and
        // silently finds 0 cells.
        await this.page
          .waitForSelector(
            `[data-testid="sub-row-cells-wrapper-${materialId}-${unitId}"]`,
            { state: 'visible', timeout: 10_000 }
          )
          .catch(() => {
            console.warn(
              `[expandHierarchyToLeaf] sub-row-cells-wrapper for unit ${unitId} did not appear in time.`
            );
          });
      }
    }

    console.info(`[expandHierarchyToLeaf] Done. expanded=${expanded}`);
    return expanded;
  }

  // ──────────────── Aggregation Workflow ────────────────

  /**
   * Sets values on every leaf cell that became visible after the hierarchy
   * was expanded down `unitsToExpand`.
   *
   * Real testids emitted by the app:
   *   - `sub-row-cells-wrapper-${mat}-${parentUnit}` — container holding the
   *     children of an expanded parent.
   *   - `sub-row-cell-${mat}-${unitId}` — one cell per child unit. All leaves
   *     are now rendered as `sub-row-cell` (no second leaf type), so every
   *     `sub-row-cell` inside the deepest wrapper that isn't itself a unit
   *     on the expanded path is treated as a leaf and incremented
   *     `incrementValue` times. Inside each cell:
   *       * `[data-testid="increment"]` – the increment button.
   *       * `[data-testid="input"]`     – the numeric value (read-only).
   */
  async setLeafCellValues(
    materialId: string,
    unitsToExpand: number[],
    incrementValue: number = 4
  ): Promise<Map<string, number>> {
    const setLeafValues = new Map<string, number>();
    // Only exclude units that are actual ancestors (i.e. appear *before* the
    // deepest wrapper parent in the path).  Siblings of the last unit in the
    // path (like 401 and 701 under 101) should NOT be excluded.
    const clicks = Math.max(0, incrementValue);

    try {
      console.log(
        `[setLeafCellValues] Path: ${unitsToExpand.join(' -> ')}, increment=${clicks}`
      );

      // 1. Locate the deepest sub-row-cells-wrapper that actually rendered.
      //    Use a longer timeout on the first pass to handle slow renders after expansion.
      let parentUnitId: number | null = null;
      let wrapper: Locator | null = null;
      for (let i = unitsToExpand.length - 1; i >= 0; i--) {
        const candidate = this.page
          .locator(`[data-testid="sub-row-cells-wrapper-${materialId}-${unitsToExpand[i]}"]`)
          .first();
        if (await candidate.count()) {
          if (await candidate.isVisible({ timeout: 5000 }).catch(() => false)) {
            parentUnitId = unitsToExpand[i];
            wrapper = candidate;
            break;
          }
        }
      }

      if (!wrapper || parentUnitId === null) {
        console.warn(
          `[setLeafCellValues] No sub-row-cells-wrapper rendered for path [${unitsToExpand.join(' -> ')}]`
        );
        return setLeafValues;
      }

      console.log(`[setLeafCellValues] Using parent unit ${parentUnitId} as leaf-children container`);

      // 2. Enumerate child unit IDs from leaf cells inside the wrapper.
      //    Two types of leaf cells exist:
      //      - chip-zero-cell-${mat}-${unitId}            : never clicked (zero state)
      //      - numberfield-group-numbered-cell-${mat}-${unitId} : already has a value;
      //        exposes numberfield-increment-... / numberfield-decrement-... buttons.
      //    Fall back to the legacy `sub-row-cell-${mat}-${unitId}` wrapper test-id
      //    so older UI builds keep working.
      const childUnitIds: string[] = await wrapper.evaluate(
        (root: Element, mat: string) => {
          const ids = new Set<string>();
          const patterns = [
            new RegExp(`^chip-zero-cell-${mat}-(\\d+)$`),
            new RegExp(`^numberfield-group-numbered-cell-${mat}-(\\d+)$`),
            new RegExp(`^sub-row-cell-${mat}-(\\d+)$`),
          ];
          const selector = [
            `[data-testid^="chip-zero-cell-${mat}-"]`,
            `[data-testid^="numberfield-group-numbered-cell-${mat}-"]`,
            `[data-testid^="sub-row-cell-${mat}-"]`,
          ].join(', ');
          root.querySelectorAll(selector).forEach((el) => {
            const tid = el.getAttribute('data-testid') || '';
            for (const re of patterns) {
              const m = tid.match(re);
              if (m) {
                ids.add(m[1]);
                break;
              }
            }
          });
          return Array.from(ids);
        },
        materialId
      );

      // Only exclude units that have their own visible sub-row-cells-wrapper
      // (i.e. they are actual parent nodes, not leaf siblings).
      const actualParents = new Set<string>();
      for (const uid of childUnitIds) {
        const childWrapper = wrapper!.locator(
          `[data-testid="sub-row-cells-wrapper-${materialId}-${uid}"]`
        ).first();
        if (await childWrapper.count() && await childWrapper.isVisible({ timeout: 500 }).catch(() => false)) {
          actualParents.add(uid);
        }
      }
      const leafChildren = childUnitIds.filter((u) => !actualParents.has(u));
      console.log(
        `[setLeafCellValues] Discovered ${leafChildren.length} leaf cell(s) under ${parentUnitId}: [${leafChildren.join(', ')}]`
      );

      // 3. For each leaf cell, perform `clicks` increments, handling cell types.
      //    Two types exist:
      //      - chip-zero-cell: zero state, clickable to activate
      //      - numberfield-group-numbered-cell: numbered cell. If it has an increment
      //        button we can change its value; if not, it's a fixed-value cell — skip it.
      for (const unitId of leafChildren) {
        try {
          const chipZero = wrapper
            .locator(`[data-testid="chip-zero-cell-${materialId}-${unitId}"]`)
            .first();
          const numberedGroup = wrapper
            .locator(`[data-testid="numberfield-group-numbered-cell-${materialId}-${unitId}"]`)
            .first();

          // Determine which variant is currently rendered.
          const isChipZero = await chipZero.isVisible({ timeout: 500 }).catch(() => false);
          const isNumbered = !isChipZero && await numberedGroup.isVisible({ timeout: 500 }).catch(() => false);

          let remainingClicks = clicks;
          let currentValue = 0;

          if (isChipZero) {
            // Chip-zero cell: a single click converts it into a numbered cell (value becomes 1).
            await chipZero.scrollIntoViewIfNeeded().catch(() => undefined);
            console.log(
              `[setLeafCellValues] Unit ${unitId}: chip-zero-cell -> click 1/${clicks} to activate`
            );
            if (remainingClicks > 0) {
              await chipZero.click();
              remainingClicks -= 1;
              currentValue = 1;
              // Allow the chip to rerender as a numberfield-group before continuing.
              await this.page.waitForTimeout(150);
            }
          } else if (isNumbered) {
            // Already a numbered cell – read current value.
            const inputField = numberedGroup
              .locator('[data-testid*="input"]')
              .first();
            try {
              currentValue = parseInt(
                (await inputField.inputValue().catch(() => '0')) || '0',
                10
              );
            } catch {
              currentValue = 0;
            }
          } else {
            console.log(`[setLeafCellValues] Unit ${unitId}: no chip-zero or numbered cell found, skipping`);
            continue;
          }

          // After (optional) activation, the cell should be a numberfield-group.
          const incrementBtn = wrapper
            .locator(`[data-testid="numberfield-increment-numbered-cell-${materialId}-${unitId}"]`)
            .first();
          const inputField = numberedGroup
            .locator('[data-testid*="input"]')
            .first();

          // If the increment button isn't actually visible, skip this cell.
          const incrementVisible = await incrementBtn.isVisible({ timeout: 500 }).catch(() => false);
          if (!incrementVisible) {
            console.log(`[setLeafCellValues] Unit ${unitId}: increment button not visible, skipping`);
            setLeafValues.set(unitId, currentValue);
            continue;
          }

          console.log(
            `[setLeafCellValues] Unit ${unitId}: current=${currentValue}, +${remainingClicks} increment click(s)`
          );
          for (let i = 0; i < remainingClicks; i++) {
            await incrementBtn.click();
          }

          // Small settle so the input reflects the final state.
          await this.page.waitForTimeout(150);
          let finalValue = currentValue + remainingClicks;
          try {
            finalValue = parseInt(
              (await inputField.inputValue().catch(() => `${finalValue}`)) || `${finalValue}`,
              10
            );
          } catch {
            /* fall back to computed value */
          }

          setLeafValues.set(unitId, finalValue);
          console.log(`[setLeafCellValues] Unit ${unitId}: final=${finalValue}`);
        } catch (err) {
          console.warn(`[setLeafCellValues] Unit ${unitId} failed: ${err}`);
        }
      }

      console.log(
        `[setLeafCellValues] Completed. Set values for ${setLeafValues.size} cells: ${Array.from(
          setLeafValues.entries()
        )
          .map(([id, val]) => `${id}=${val}`)
          .join(', ')}`
      );
      return setLeafValues;
    } catch (error) {
      console.error(`[setLeafCellValues] Fatal: ${error}`);
      return setLeafValues;
    }
  }

    async confirmAndLockHierarchyViaDrawer(): Promise<void> {
    console.log(`\n[Confirming and locking hierarchy via drawer]`);

    // Only open the drawer if it's not already visible
    const drawerAlreadyOpen = await this.unitHierarchyDrawerContent.isVisible({ timeout: 1000 }).catch(() => false);
    if (!drawerAlreadyOpen) {
      console.log(`  Opening drawer...`);
      await this.header.menuBtn.click();
      await this.unitHierarchyDrawerContent.waitFor({ state: 'visible', timeout: 5000 });
      await this.page.waitForLoadState('domcontentloaded');
    } else {
      console.log(`  Drawer already open, skipping open step`);
    }

    console.log(`  Clicking confirmation trigger...`);
    await this.header.confirmationPopupTrigger.waitFor({ state: 'visible', timeout: 3000 });
    await this.header.confirmationPopupTrigger.click();
    await this.page.waitForLoadState('domcontentloaded');

    console.log(`  Confirming the action...`);
    await this.header.confirmationPopupConfirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await this.header.confirmationPopupConfirmBtn.click();
    await this.waitForNetworkIdle();

    console.log(`  Closing drawer...`);
    await this.page.keyboard.press('Escape');

    await this.unitHierarchyDrawerContent.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {
      console.warn(`Drawer did not close within timeout, continuing anyway`);
    });

    console.log(`  ✓ Hierarchy confirmed and locked\n`);
  }
  // ──────────────── Hierarchy Management ────────────────

  async unitMoveUI(
    unitId: number,
    newParentId: number,
    newHierarchy: number[]
  ): Promise<void> {
    console.info(`[unitMoveUI] Moving unit ${unitId} to parent ${newParentId}`);

    // Ensure the drawer is open, handling cases where it may already be visible
    // or the trigger needs a moment to become interactive.
    await this.ensureDrawerOpen();
    await this.unitHierarchyDrawerContent.waitFor({ state: 'visible', timeout: 10000 });

    const drawerVisible = await this.unitHierarchyDrawerContent.isVisible({ timeout: 3000 }).catch(() => false);
    if (!drawerVisible) {
      // Retry: sometimes the first click doesn't register
      console.warn(`[unitMoveUI] Drawer not visible after first attempt, retrying...`);
      await this.page.waitForTimeout(500);
      await this.header.menuBtn.click();
      await this.unitHierarchyDrawerContent.waitFor({ state: 'visible', timeout: 10000 });
    }

    console.info(`[unitMoveUI] Drawer is open`);

    const parentIndex = newHierarchy.indexOf(newParentId);
    if (parentIndex !== -1) {
      for (let i = 0; i <= parentIndex; i++) {
        // Try the expand tooltip first, then fall back to the accordion trigger
        const expandTooltip = this.hierarchyExpandTooltip(newHierarchy[i]);
        const accordionTrigger = this.page.locator(
          `[data-testid="accordion-trigger-unit-hierarchy-node-accordion-${newHierarchy[i]}"]`
        );

        const tooltipVisible = await expandTooltip.isVisible({ timeout: 2000 }).catch(() => false);
        if (tooltipVisible) {
          await expandTooltip.click();
          await this.page.waitForTimeout(500);
        } else {
          const accordionVisible = await accordionTrigger.isVisible({ timeout: 2000 }).catch(() => false);
          if (accordionVisible) {
            await accordionTrigger.click();
            await this.page.waitForTimeout(500);
          }
        }
      }
    }

    const comboboxInput = this.hierarchyComboboxInput(newParentId);
    await comboboxInput.click();
    await this.waitForNetworkIdle();

    await comboboxInput.fill(unitId.toString());

    const unitOption = this.hierarchyComboboxItem(newParentId, unitId);
    await unitOption.waitFor({ state: 'visible', timeout: 3000 });
    await unitOption.click();

    // Click the action button (labeled "הוספה") to execute the move
    const actionBtn = this.hierarchyComboboxActionBtn(newParentId);
    await actionBtn.waitFor({ state: 'visible', timeout: 3000 });
    await actionBtn.click();
    await this.waitForNetworkIdle();

    // Confirm and lock directly (drawer is already open from ensureDrawerOpen above)
    const closeTrigger = this.page.getByTestId('dialog-trigger-unit-hierarchy-header-confirmation-popup');
    await closeTrigger.waitFor({ state: 'visible', timeout: 3000 });
    await closeTrigger.click();

    const confirmBtn = this.page.getByTestId('unit-hierarchy-header-confirmation-popup-confirm-button');
    await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await confirmBtn.click();
    await this.waitForNetworkIdle();

    // Close the drawer
    await this.page.keyboard.press('Escape');
    await this.unitHierarchyDrawerContent.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

    console.log(`  ✓ unitMoveUI: unit ${unitId} moved to parent ${newParentId}`);
  }



  // ──────────────── Aggregation Verification (Shechel / Mlai) ────────────────

  /**
   * Verifies the aggregation rule "parent = sum(children)" for every parent
   * unit on the requested path, using the snapshot produced by
   * {@link captureAllVisibleCellValuesAtEachLevel} (inherited from
   * {@link MainPage}).
   *
   * The snapshot map should be obtained immediately before calling this
   * method – it is built using `this.getCellValue(...)` for every visible
   * cell at each level.
   */
  async verifyAggregationWithAllVisibleCells(
    _materialId: string,
    unitsToExpand: number[],
    allVisibleValues: Map<number, number>
  ): Promise<boolean> {
    const hierarchyMap = this._hierarchyMap;
    let allChecksPass = true;

    console.log(`\n[AGGREGATION VERIFICATION]`);

    for (const parentUnitId of unitsToExpand) {
      const parentValue = allVisibleValues.get(parentUnitId) ?? 0;
      const children = hierarchyMap.get(parentUnitId) || [];

      if (children.length === 0) continue;

      let childrenSum = 0;
      for (const childId of children) {
        childrenSum += allVisibleValues.get(childId) ?? 0;
      }

      const isPassed = parentValue === childrenSum;
      const status = isPassed ? '✓' : '✗';
      console.log(`  ${status} Unit ${parentUnitId}: ${parentValue} ${isPassed ? '===' : '≠'} ${childrenSum}`);

      if (!isPassed) allChecksPass = false;
    }

    return allChecksPass;
  }

  // ──────────────── Comments ────────────────

  async openCommentDialog(materialId: string): Promise<boolean> {
    try {
      const trigger = this.commentTrigger(materialId);

      if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
        await trigger.click();
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

  async addCommentToMaterial(materialId: string, commentText: string): Promise<boolean> {
    try {
      const commentInput = this.commentContent(materialId);

      await commentInput.waitFor({ state: 'visible', timeout: 3000 });
      console.log(`[addCommentToMaterial] Comment input found for material ${materialId}`);

      await commentInput.scrollIntoViewIfNeeded();
      await commentInput.click();

      await commentInput.evaluate((el: HTMLElement, text: string) => {
        el.textContent = '';
        el.innerText = text;

        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
        el.focus();
      }, commentText);

      const selector = `[data-testid="row-comment-content-${materialId}"]`;
      await this.page.waitForFunction(
        (args: string[]) => {
          const [sel, expectedText] = args;
          const element = document.querySelector(sel);
          return (element?.textContent || '').includes(expectedText);
        },
        [selector, commentText],
        { timeout: 2000 }
      ).catch(() => {
        console.warn(`[addCommentToMaterial] Timeout waiting for comment text to appear, but continuing`);
      });

      console.log(`✓ Comment text entered for material ${materialId}: "${commentText}"`);
      return true;
    } catch (error) {
      console.error(`Failed to add comment: ${error}`);
      return false;
    }
  }

  async saveComment(materialId: string): Promise<boolean> {
    try {
      const btn = this.commentSaveBtn(materialId);

      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
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

  async closeCommentDialog(): Promise<boolean> {
    try {
      await this.page.keyboard.press('Escape');

      await this.dialogContainer.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {
        console.warn(`[closeCommentDialog] Dialog did not hide within timeout, continuing anyway`);
      });

      console.log('✓ Comment dialog closed');
      return true;
    } catch (error) {
      console.error(`Failed to close comment dialog: ${error}`);
      return false;
    }
  }

  async verifyCommentExists(materialId: string, expectedCommentText: string): Promise<boolean> {
    try {
      const dialogOpened = await this.openCommentDialog(materialId);
      if (!dialogOpened) {
        console.warn(`Could not open comment dialog for verification`);
        return false;
      }

      const commentInput = this.commentContent(materialId);
      const commentValue = await commentInput.inputValue();

      if (commentValue?.includes(expectedCommentText)) {
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
