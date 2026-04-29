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
    return this.page.locator(`[data-testid="unit-hierarchy-row-expand-tooltip-${unitId}-wrapper"]`);
  }

  private hierarchyComboboxInput(parentId: number): Locator {
    return this.page.locator(`[data-testid="unit-hierarchy-node-combobox-${parentId}-input"]`);
  }

  private hierarchyComboboxItem(parentId: number, unitId: number): Locator {
    return this.page.locator(`[data-testid="unit-hierarchy-node-combobox-${parentId}-item-${unitId}"]`);
  }

  private hierarchyComboboxActionBtn(parentId: number): Locator {
    return this.page.locator(`[data-testid="unit-hierarchy-node-combobox-${parentId}-action-button"]`);
  }

  private commentTrigger(materialId: string): Locator {
    return this.page.getByTestId(`row-comment-dialog-${materialId}-trigger`);
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
    const parentUnits = new Set(unitsToExpand.map(String));
    const clicks = Math.max(0, incrementValue);

    try {
      console.log(
        `[setLeafCellValues] Path: ${unitsToExpand.join(' -> ')}, increment=${clicks}`
      );

      // 1. Locate the deepest sub-row-cells-wrapper that actually rendered.
      let parentUnitId: number | null = null;
      let wrapper: Locator | null = null;
      for (let i = unitsToExpand.length - 1; i >= 0; i--) {
        const candidate = this.page
          .locator(`[data-testid="sub-row-cells-wrapper-${materialId}-${unitsToExpand[i]}"]`)
          .first();
        if (await candidate.count()) {
          if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
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

      // 2. Enumerate child unit IDs from the sub-row-cell testids inside the wrapper.
      const childUnitIds: string[] = await wrapper.evaluate(
        (root: Element, mat: string) => {
          const ids: string[] = [];
          root
            .querySelectorAll(`[data-testid^="sub-row-cell-${mat}-"]`)
            .forEach((el) => {
              const tid = el.getAttribute('data-testid') || '';
              const m = tid.match(/^sub-row-cell-[^-]+-(\d+)$/);
              if (m) ids.push(m[1]);
            });
          return Array.from(new Set(ids));
        },
        materialId
      );

      const leafChildren = childUnitIds.filter((u) => !parentUnits.has(u));
      console.log(
        `[setLeafCellValues] Discovered ${leafChildren.length} leaf cell(s) under ${parentUnitId}: [${leafChildren.join(', ')}]`
      );

      // 3. For each leaf cell, click the increment button `clicks` times.
      for (const unitId of leafChildren) {
        try {
          const cell = wrapper.locator(`[data-testid="sub-row-cell-${materialId}-${unitId}"]`).first();
          const incrementBtn = cell.locator('[data-testid="increment"]').first();
          const inputField = cell.locator('[data-testid="input"]').first();

          await cell.scrollIntoViewIfNeeded().catch(() => undefined);

          let currentValue = 0;
          try {
            currentValue = parseInt(
              (await inputField.inputValue().catch(() => '0')) || '0',
              10
            );
          } catch {
            currentValue = 0;
          }

          console.log(
            `[setLeafCellValues] Unit ${unitId}: current=${currentValue}, +${clicks} click(s)`
          );
          for (let i = 0; i < clicks; i++) {
            await incrementBtn.click();
          }

          // Small settle so the input reflects the final state.
          await this.page.waitForTimeout(150);
          let finalValue = currentValue + clicks;
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

  // ──────────────── Hierarchy Management ────────────────

  async unitMoveUI(
    unitId: number,
    newParentId: number,
    newHierarchy: number[]
  ): Promise<void> {
    console.info(`[unitMoveUI] Moving unit ${unitId} to parent ${newParentId}`);

    await this.header.menuBtn.click();
    await this.unitHierarchyDrawerContent.waitFor({ state: 'visible', timeout: 3000 });

    const drawerVisible = await this.unitHierarchyDrawerContent.isVisible({ timeout: 3000 }).catch(() => false);
    if (!drawerVisible) {
      throw new Error('Unit Hierarchy Drawer failed to open');
    }

    const parentIndex = newHierarchy.indexOf(newParentId);
    if (parentIndex !== -1) {
      for (let i = 0; i <= parentIndex; i++) {
        const expandTooltip = this.hierarchyExpandTooltip(newHierarchy[i]);
        const isVisible = await expandTooltip.isVisible({ timeout: 2000 }).catch(() => false);

        if (isVisible) {
          await expandTooltip.click();
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
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

    const transferBtn = this.page.getByRole('button', { name: 'העבר' });
    await transferBtn.waitFor({ state: 'visible', timeout: 3000 });
    await transferBtn.click();
    await this.waitForNetworkIdle();

    await this.waitForNetworkIdle();

    const closeTrigger = this.page.getByTestId('unit-hierarchy-header-confirmation-popup-trigger');
    await closeTrigger.waitFor({ state: 'visible', timeout: 3000 });
    await closeTrigger.click();

    const confirmBtn = this.page.getByTestId('unit-hierarchy-header-confirmation-popup-confirm-button');
    await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await confirmBtn.click();

    await this.waitForNetworkIdle();
    console.log(`  ✓ unitMoveUI: unit ${unitId} moved to parent ${newParentId}`);
  }

  async confirmAndLockHierarchyViaDrawer(): Promise<void> {
    console.log(`\n[Confirming and locking hierarchy via drawer]`);

    console.log(`  Opening drawer...`);
    await this.header.menuBtn.click();
    await this.page.waitForLoadState('domcontentloaded');

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
