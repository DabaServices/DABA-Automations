import { Page, Locator, expect, Response } from '@playwright/test';
import { MainPage } from './MainPage';
import {
  isFailureStatus,
  isServerFailure,
  describeResponseFailure,
} from '../utils/httpFailures';
import { BACKEND_URL } from '../../playwright.config';
import { lockCompleteHierarchy, invalidateTopLevelUnitsCache } from '../api/apiHelpers';

/**
 * Host portion of the configured backend (e.g. "localhost:3000" or
 * "auto-api.162.55.55.124.nip.io"). Used to recognise backend mutation
 * responses regardless of environment, instead of a hardcoded IP. Falls back
 * to the raw string if BACKEND_URL is not a parseable URL.
 */
const BACKEND_HOST = (() => {
  try {
    return new URL(BACKEND_URL).host;
  } catch {
    return BACKEND_URL;
  }
})();

/**
 * Result of {@link ShechelPage.verifyAggregationWithAllVisibleCells}.
 *
 * `ok` is the pass/fail flag (kept so existing boolean checks still read
 * naturally). `report` is a multi-line, human-readable breakdown that is EMPTY
 * on success and, on failure, lists the full captured snapshot plus — for every
 * violating parent — the exact child units (gdudim/leaves) with their values,
 * the computed Σ, the parent value and the signed difference. Callers append
 * `report` to the thrown assertion so the error log alone is enough to debug.
 */
export interface AggregationCheckResult {
  ok: boolean;
  report: string;
}

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
    // The "delete current type" confirm control. The per-material test-id now
    // lives on the inner <span> (`row-delete-current-type-label-${materialId}`)
    // while the clickable <button> carries the stable, generic attributes
    // `data-delete-control="action"` + `data-type="confirm"`. Target the
    // button that CONTAINS this material's label span so the click lands on
    // the button (not the span) and stays scoped to the right material.
    return this.page.locator(
      `button[data-delete-control="action"][data-type="confirm"]:has([data-testid="row-delete-current-type-label-${materialId}"])`,
    );
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

  private accordionTrigger(unitId: number): Locator {
    return this.page.locator(`[data-testid="accordion-trigger-unit-hierarchy-node-accordion-${unitId}"]`);
  }

  // Matkal (id=1) uses a DIFFERENT widget in the move drawer: the "anchor"
  // combobox at the top of the drawer, not a node combobox inside an
  // expanded accordion. There is no accordion / expand-tooltip to click —
  // the anchor combobox is rendered unconditionally when the drawer opens.
  private hierarchyAnchorComboboxInput(parentId: number): Locator {
    return this.page.locator(`[data-testid="unit-hierarchy-anchor-combobox-${parentId}-input"]`);
  }

  private hierarchyAnchorComboboxItem(parentId: number, unitId: number): Locator {
    return this.page.locator(`[data-testid="unit-hierarchy-anchor-combobox-${parentId}-item-${unitId}"]`);
  }

  private hierarchyAnchorComboboxActionBtn(parentId: number): Locator {
    return this.page.locator(`[data-testid="button-unit-hierarchy-anchor-combobox-${parentId}-action-button"]`);
  }

  private chipZeroCell(wrapper: Locator, materialId: string, unitId: string): Locator {
    return wrapper.locator(`[data-testid="chip-zero-cell-${materialId}-${unitId}"]`).first();
  }

  private numberedGroupCell(wrapper: Locator, materialId: string, unitId: string): Locator {
    return wrapper.locator(`[data-testid="numberfield-group-numbered-cell-${materialId}-${unitId}"]`).first();
  }

  private incrementButton(wrapper: Locator, materialId: string, unitId: string): Locator {
    return wrapper.locator(`[data-testid="numberfield-increment-numbered-cell-${materialId}-${unitId}"]`).first();
  }

  private cellInputField(cell: Locator): Locator {
    return cell.locator('[data-testid*="input"]').first();
  }

  private subRowCellsWrapperFor(materialId: string, unitId: number): Locator {
    return this.page.locator(`[data-testid="sub-row-cells-wrapper-${materialId}-${unitId}"]`).first();
  }

  private subRowCell(materialId: string, unitId: number): Locator {
    return this.page.locator(`[data-testid="sub-row-cell-${materialId}-${unitId}"]`).first();
  }

  private cellForUnit(materialId: string, unitId: number): Locator {
    return this.page.locator(
      `[data-testid="row-cell-${materialId}-${unitId}"], [data-testid="sub-row-cell-${materialId}-${unitId}"], [data-testid*="numbered-cell-${materialId}-${unitId}"]`
    ).first();
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
      await expect(this.header.saveBtn).toBeEnabled({ timeout: 15000 });

      // Deterministically wait for the SAVE network call to complete before
      // returning. Relying on `networkidle` here is unreliable (the SPA keeps
      // long-poll connections open) AND dangerous: callers reload the page
      // right after save, so if we return before the mutation lands the save
      // is lost.
      //
      // CRITICAL: we must match the save mutation REGARDLESS of status code.
      // A previous version only matched 2xx–3xx, so a backend rejection
      // (e.g. HTTP 502 "ההיררכיה תחתיך השתנתה") never matched, the waiter
      // timed out, and the failure was silently swallowed — surfacing much
      // later as a confusing value mismatch. Now we catch the response, and
      // if it is a failure status we THROW with the full method/URL/status/
      // body so the report says exactly what went wrong.
      const savePromise: Promise<Response | null> = this.page
        .waitForResponse(
          (resp) => {
            const req = resp.request();
            return (
              /POST|PUT|PATCH/.test(req.method()) &&
              resp.url().includes(BACKEND_HOST)
            );
          },
          { timeout: 20000 },
        )
        .catch(() => {
          // No distinct mutation response observed within the window. Some
          // saves may be batched/debounced and not produce a response we can
          // match — that case is genuinely ambiguous, so we proceed and let
          // the post-reload assertion be the ultimate source of truth.
          console.warn(`[saveMaterial] No matching save response observed; proceeding.`);
          return null;
        });

      await this.header.saveBtn.click();
      const saveResponse = await savePromise;

      // If we DID observe the save response and it failed, abort NOW with a
      // detailed message. Continuing here would lose the unsaved value and
      // fail later as a misleading downstream symptom.
      if (saveResponse && isFailureStatus(saveResponse.status())) {
        const detail = await describeResponseFailure(saveResponse, 'saveMaterial');
        throw new Error(
          `${detail}\nThe material was NOT saved — aborting so this surfaces as a save ` +
            `failure rather than a later value mismatch. ` +
            (isServerFailure(saveResponse.status())
              ? `This 5xx often means the hierarchy beneath the unit changed (parallel ` +
                `worker contention); consider serializing overlapping subtrees.`
              : `This 4xx is a permanent client error (bad data or locked unit).`),
        );
      }

      // Brief settle so the backend commit is durable before any reload.
      await this.page.waitForLoadState('domcontentloaded');

      // Save on this app = lock + aggregation recalculation, which keeps the
      // saved units in a "locked / processing" state for a short while after
      // the first response lands. Callers that immediately unlock/move the
      // hierarchy (the HC flows) otherwise get
      //   "יחידת המסך נעולה, אין אפשרות לבצע את הפעולה"
      //   ("the screen unit is locked, action not allowed").
      // Give the backend time to finish settling before returning. Override
      // via SAVE_SETTLE_MS env var (default 3000ms).
      const settleMs = Number(process.env.SAVE_SETTLE_MS ?? 3000);
      if (settleMs > 0) {
        console.info(`[saveMaterial] Waiting ${settleMs}ms for save to settle on the backend...`);
        await this.page.waitForTimeout(settleMs);
      }
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
        await expect(icon).toBeEnabled({ timeout: 15000 });
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
        // Arm a waiter for the DELETE mutation BEFORE clicking confirm, so a
        // backend rejection is surfaced as a clear "delete request failed"
        // error instead of a later "material still in row" symptom. We match
        // any mutating method to the backend host regardless of status, then
        // abort if the observed response is a failure.
        const deletePromise: Promise<Response | null> = this.page
          .waitForResponse(
            (resp) => {
              const req = resp.request();
              return (
                /DELETE|POST|PUT|PATCH/.test(req.method()) &&
                resp.url().includes(BACKEND_HOST)
              );
            },
            { timeout: 15000 },
          )
          .catch(() => {
            // No distinct delete response observed — ambiguous, so continue
            // and let the caller's post-delete assertion be the source of truth.
            console.warn(`[deleteMakat] No matching delete response observed; proceeding.`);
            return null;
          });

        await confirmBtn.click();
        console.log(`[deleteMakat] Delete confirmation button clicked for material ${materialId}`);

        const deleteResponse = await deletePromise;
        if (deleteResponse && isFailureStatus(deleteResponse.status())) {
          const detail = await describeResponseFailure(deleteResponse, 'deleteMakat');
          throw new Error(
            `${detail}\nMaterial ${materialId} was NOT deleted — aborting so this surfaces as a ` +
              `delete-request failure rather than a later "material still present" symptom.`,
          );
        }
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

    // The grid often mounts behind the `AmmoLoading` overlay right after a
    // reload / makat-add. Interacting through it makes carousel clicks and
    // hovers silent no-ops, so settle the page before we touch anything.
    await this.waitForAmmoLoadingGone();

    // Reset the carousel to its leftmost page before we start. Without
    // this, residual pagination state from a previous call (e.g. the
    // BEFORE-move phase scrolled to unit 5's column) leaves us viewing
    // high-numbered units and we never see the low-numbered targets like
    // unit 6 even though they exist in the data.
    await this.resetCarouselToLeftmost().catch(() => undefined);

    for (let i = 0; i < unitsToExpand.length; i++) {
      const unitId = unitsToExpand[i];

      // Resolve the cell for this unit. Top-level units use `row-cell-...`,
      // children of an expanded row use `sub-row-cell-...`, and group/leaf
      // cells use `numbered-cell-...`. Try them in order of likelihood.
      //
      // Rule (per user): we ONLY paginate the carousel "next" arrow as a
      // FALLBACK — i.e. only when none of the three locators resolves a
      // cell at all. If the cell is already in the DOM (whether visible
      // or not), trust it and proceed. We do NOT proactively check
      // header-label visibility here.
      let cell = this.rowCell(materialId, unitId);
      if (!(await cell.count())) {
        cell = this.subRowCell(materialId, unitId);
      }
      if (!(await cell.count())) {
        cell = this.numberedCell(materialId, unitId);
      }

      // If we couldn't find the cell AND this is the FIRST hop (top-level
      // unit under Matkal), the unit may simply be on a later carousel
      // page that isn't rendered yet. Wait briefly for any row-cell of
      // this material to attach (= row hydrated), then if STILL nothing,
      // click the carousel "next" arrow until the unit's cell appears
      // OR the arrow disappears (= end of list).
      if (!(await cell.count()) && i === 0) {
        const anyMaterialCell = this.page.locator(
          `[data-testid^="row-cell-${materialId}-"]`,
        );
        await anyMaterialCell
          .first()
          .waitFor({ state: 'attached', timeout: 5_000 })
          .catch(() => undefined);

        // Re-check after hydration.
        let candidate = this.rowCell(materialId, unitId);
        if (!(await candidate.count())) candidate = this.subRowCell(materialId, unitId);
        if (!(await candidate.count())) candidate = this.numberedCell(materialId, unitId);

        if (await candidate.count()) {
          cell = candidate;
        } else {
          console.info(
            `[expandHierarchyToLeaf] Unit ${unitId} not in DOM — clicking carousel "next" arrow until it appears or arrow is gone…`,
          );
          // Bound the ENTIRE first-hop recovery (pagination + reload retries)
          // to a wall-clock budget. On a slow/unstable backend the reveal +
          // reload loop could otherwise grind until the 270s test timeout,
          // which tears the page down mid-click and surfaces as a confusing
          // "Target page, context or browser has been closed" instead of an
          // actionable message.
          //
          // Size it for the WORST case: the carousel lists up to ~70 locked
          // top-level units and a target can sit at the far right (index ~47+
          // observed for units 200/216/354). Each "next" page-swap waits out
          // the loading overlay (~1s on a slow backend), so reaching the far
          // end alone can take ~60s — a 30s budget aborted those reveals early
          // and the moved unit's gdud was never expanded, surfacing as
          // "before-capture-incomplete". Give pagination room to traverse the
          // whole list while still leaving the OUTER per-phase retry (the
          // BEFORE-phase loop reloads + re-expands up to 3×) comfortably under
          // the 300s per-test budget.
          const FIRST_HOP_BUDGET_MS = 90_000;
          const firstHopDeadline = Date.now() + FIRST_HOP_BUDGET_MS;

          await this.revealUnitInCarousel(materialId, unitId, 80, firstHopDeadline);
          cell = this.rowCell(materialId, unitId);

          // First-hop recovery (carousel render-race).
          // The carousel only lists LOCKED top-level units, and it rebuilds
          // its visible set from a hierarchy fetch on page load. Adding the
          // makat just before this re-renders the carousel; a top unit that
          // WAS locked & on the carousel during `beforeEach` can momentarily
          // drop off the visible pages, so the pagination above exhausts the
          // "next" arrow without ever finding it. That made the BEFORE-phase
          // expand break on hop 0 and the moved unit be reported BEFORE=MISSING
          // (the 126 / [3 → 36 → 126] case), even though the unit was locked.
          //
          // Mirror exactly what the post-move flow already does to recover:
          // reload (re-fetches the hierarchy → the locked top re-appears),
          // re-add the makat (idempotent — skips if already present), reset
          // the carousel, and re-attempt the reveal. This is SAFE in the
          // BEFORE phase because no values have been set/saved yet, so a
          // reload loses nothing. We deliberately keep this scoped to the
          // FIRST hop (a top-level unit); deeper units are never revealed by
          // carousel pagination and must come from a network-button expand.
          //
          // 3 reloads (was 2): now that each recovery first RE-ASSERTS the lock
          // via API (below), the extra attempt is high-value — it gives the
          // backend one more chance to reflect the guaranteed-locked top on the
          // carousel under transient load, rather than giving up one round early.
          const FIRST_HOP_RELOADS = 3;
          for (
            let r = 0;
            r < FIRST_HOP_RELOADS &&
            !(await cell.count()) &&
            Date.now() < firstHopDeadline;
            r++
          ) {
            console.warn(
              `[expandHierarchyToLeaf] Top unit ${unitId} not on carousel after pagination — ` +
                `reloading to re-fetch the hierarchy and re-revealing (attempt ${r + 1}/${FIRST_HOP_RELOADS}). ` +
                `This recovers a locked top unit that dropped off the carousel when the makat was added.`,
            );
            try {
              // ROOT-CAUSE recovery (carousel "next gone after 0 clicks").
              // The carousel renders ONLY locked top units and builds its list
              // from a hierarchy fetch on load. Two things make a freshly-locked
              // top vanish from that list under a loaded backend:
              //   (a) the lock didn't actually persist, or
              //   (b) the carousel's fetch raced the lock and a plain reload
              //       re-raced it (so 2 reloads in a row both miss it).
              // A plain reload only addresses (b) probabilistically. Re-ASSERT
              // the lock via API first (idempotent — fixes (a) and guarantees
              // the top is genuinely locked before we reload), and invalidate
              // the cached top-level set so the next fetch reflects reality.
              // This converts the "0 clicks, never appears" flake into a
              // deterministic recovery instead of a coin-flip on backend load.
              try {
                invalidateTopLevelUnitsCache();
                await lockCompleteHierarchy(this.page.request, [unitId]);
              } catch (relockErr) {
                console.warn(
                  `[expandHierarchyToLeaf] First-hop re-lock of ${unitId} failed (continuing to reload anyway): ${String(relockErr).slice(0, 120)}`,
                );
              }
              await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
              await this.waitForMakatComboboxReady(30_000);
              // Re-add the makat row dropped by the reload (idempotent — the
              // helper returns early if the material is already present).
              await this.addMakatFromDropdown(materialId);
              await this.waitForMaterialRow(materialId, 15_000);
              await this.waitForAmmoLoadingGone();
              await this.resetCarouselToLeftmost().catch(() => undefined);
              await this.revealUnitInCarousel(materialId, unitId, 80, firstHopDeadline);
              cell = this.rowCell(materialId, unitId);
            } catch (e) {
              console.warn(
                `[expandHierarchyToLeaf] First-hop reload recovery attempt ${r + 1} failed: ${e}`,
              );
            }
          }

          // If the locked top unit STILL never surfaced on the carousel within
          // the budget, do NOT keep grinding — break out and let the normal
          // "no cell found" path below stop this expand cleanly. Callers that
          // require the cell (BEFORE/AFTER capture phases) detect the missing
          // unit in their snapshot and run their own bounded reload-retry with
          // a precise, actionable assertion; surfacing here as a fast, logged
          // miss is far better than running out the full test timeout and dying
          // with an opaque "page closed" error.
          if (!(await cell.count())) {
            console.warn(
              `[expandHierarchyToLeaf] Top-level unit ${unitId} never appeared on the ` +
                `carousel within ${FIRST_HOP_BUDGET_MS / 1000}s (pagination + ${FIRST_HOP_RELOADS} ` +
                `reload recoveries). It is in the live top-level set but its carousel column did ` +
                `not render — typically a slow/unstable backend. Stopping this expand early; the ` +
                `caller's capture-retry will handle recovery or report it precisely.`,
            );
          }
        }
      }

      const cellCount = await cell.count();
      if (!cellCount) {
        console.warn(`[expandHierarchyToLeaf] No cell found for unit ${unitId} (material ${materialId}) — stopping.`);
        break;
      }

      // Make sure the cell is in view, then hover to reveal the network button.
      //
      // Three transient conditions broke this in the hierarchy-change tests and
      // are handled here:
      //   1. The `AmmoLoading` overlay (aria-busy) intercepts pointer events,
      //      so the hover times out and the network button never appears
      //      (seen as AFTER=MISSING on the post-move re-expand). Wait it out
      //      BEFORE hovering.
      //   2. The cell can detach from the DOM mid-hover while the grid
      //      re-renders ("Element is not attached to the DOM"). Re-resolve the
      //      cell and retry a couple of times instead of giving up.
      //   3. Under a SATURATED backend the grid keeps re-laying-out, so a fixed
      //      2 000 ms `scrollIntoViewIfNeeded`/`hover` times out even though the
      //      cell is present and on-screen — this is exactly what made the
      //      Gdud(810) BEFORE-capture abort ("Could not hover cell for unit
      //      210 … scrollIntoViewIfNeeded: Timeout 2000ms exceeded"). The
      //      per-attempt timeout therefore GROWS (2s → 4s → 6s) and we settle
      //      the loading overlay between tries, giving a laggy layout room to
      //      quiesce before we conclude the network button is unreachable.
      const HOVER_ATTEMPTS = 3;
      for (let h = 0; h < HOVER_ATTEMPTS; h++) {
        await this.waitForAmmoLoadingGone();
        const hoverTimeout = 2000 * (h + 1); // 2s, 4s, 6s — absorbs backend lag
        try {
          await cell.first().scrollIntoViewIfNeeded({ timeout: hoverTimeout });
          await cell.first().hover({ timeout: hoverTimeout });
          break;
        } catch (e) {
          if (h === HOVER_ATTEMPTS - 1) {
            console.warn(`[expandHierarchyToLeaf] Could not hover cell for unit ${unitId}: ${e}`);
            break;
          }
          // Re-resolve the cell — the previous handle may be stale after a
          // re-render — and wait for it to re-attach before retrying.
          cell = this.cellForUnit(materialId, unitId);
          await cell
            .first()
            .waitFor({ state: 'attached', timeout: 2000 })
            .catch(() => undefined);
        }
      }

      const networkBtn = this.networkButton(materialId, unitId);
      let btnVisible = await networkBtn.isVisible({ timeout: 1500 }).catch(() => false);

      // For a NON-leaf unit the network button MUST appear for the expand to
      // continue. Under a saturated backend the hover above can land just as
      // the grid re-lays-out, so the button hasn't painted within the first
      // 1 500 ms probe — which previously aborted the whole (irreversible)
      // BEFORE-capture with "Network button not visible for unit 210 — cannot
      // continue". Before giving up, re-settle the overlay, re-hover, and
      // re-probe a couple of times with a growing window. (Leaf units skip
      // this: their missing button is the expected end-of-path signal handled
      // below.)
      if (!btnVisible && i !== unitsToExpand.length - 1) {
        const REHOVER_ATTEMPTS = 2;
        for (let rh = 0; rh < REHOVER_ATTEMPTS && !btnVisible; rh++) {
          await this.waitForAmmoLoadingGone();
          cell = this.cellForUnit(materialId, unitId);
          await cell
            .first()
            .hover({ timeout: 3000 })
            .catch(() => undefined);
          btnVisible = await networkBtn
            .isVisible({ timeout: 2500 })
            .catch(() => false);
          if (btnVisible) {
            console.info(
              `[expandHierarchyToLeaf] Network button for unit ${unitId} appeared after re-hover ${rh + 1}/${REHOVER_ATTEMPTS}.`,
            );
          }
        }
      }

      if (!btnVisible) {
        // If this is the leaf in the requested path, that's expected.
        if (i === unitsToExpand.length - 1) {
          console.info(`[expandHierarchyToLeaf] No network button on leaf unit ${unitId} — leaf reached.`);
          // Wait for the parent's sub-row-cells-wrapper to fully render so
          // setLeafCellValues can find the leaf cells immediately after.
          if (i > 0) {
            const parentUnitId = unitsToExpand[i - 1];
            await this.subRowCellsWrapperFor(materialId, parentUnitId)
              .waitFor({ state: 'visible', timeout: 10_000 })
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
      // The grid frequently re-renders while the row hydrates, detaching the
      // network-button SVG mid-click ("element was detached from the DOM").
      // Under a loaded backend that detach+reattach can outlast a single
      // click's auto-retry window and surface as a hard timeout (the unit-478
      // OUTSIDE failure). Retry the click a few times, re-resolving the button
      // and settling the loading overlay between attempts, so a transient
      // re-render no longer fails the whole (irreversible) flow.
      const NET_CLICK_ATTEMPTS = 3;
      let clicked = false;
      for (let c = 0; c < NET_CLICK_ATTEMPTS; c++) {
        try {
          await this.networkButton(materialId, unitId).click({ timeout: 5_000 });
          clicked = true;
          break;
        } catch (e) {
          if (c === NET_CLICK_ATTEMPTS - 1) {
            console.warn(
              `[expandHierarchyToLeaf] Network button click for unit ${unitId} failed after ` +
                `${NET_CLICK_ATTEMPTS} attempts (${String(e).slice(0, 100)}) — stopping this expand.`,
            );
            break;
          }
          // Re-resolve and let the grid settle before retrying — the prior
          // handle is stale after the re-render that detached it.
          await this.waitForAmmoLoadingGone();
          await this.networkButton(materialId, unitId)
            .first()
            .waitFor({ state: 'visible', timeout: 3_000 })
            .catch(() => undefined);
        }
      }
      if (!clicked) break;
      expanded = true;

      // Wait for the next level to render (look for either kind of cell)
      if (i + 1 < unitsToExpand.length) {
        const nextUnit = unitsToExpand[i + 1];
        const nextCell = this.cellForUnit(materialId, nextUnit);
        await nextCell.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
          console.warn(`[expandHierarchyToLeaf] Next-level cell for unit ${nextUnit} did not appear in time.`);
        });
      } else {
        // Last expansion in the path: wait for the leaf's children container
        await this.subRowCellsWrapperFor(materialId, unitId)
          .waitFor({ state: 'visible', timeout: 10_000 })
          .catch(() => {
            console.warn(
              `[expandHierarchyToLeaf] sub-row-cells-wrapper for unit ${unitId} did not appear in time.`
            );
          });
      }
    }

    console.info(`[expandHierarchyToLeaf] Done. expanded=${expanded}`);

    // ── Freestyle continuation ───────────────────────────────────────────
    // If the requested path stopped above the leaf level (e.g. a path
    // ending at Pikud/Ugda/Hativa rather than Gdud), randomly pick visible
    // children to keep expanding until we reach a real leaf. The chosen
    // units are appended to `unitsToExpand` in place so the caller's
    // subsequent setLeafCellValues / captureAllVisibleCellValuesAtEachLevel
    // calls see the complete path.
    if (unitsToExpand.length > 0) {
      await this.continueExpansionToLeaf(materialId, unitsToExpand);
    }

    return expanded;
  }

  /**
   * Helper: from the current leaf-of-path, keep randomly choosing a visible
   * child and clicking its network button until no expandable child remains
   * (i.e. the gdud / leaf level is reached). Mutates `unitsToExpand` by
   * appending each chosen child unit id.
   *
   * Safety:
   *   - Max 10 extra hops (defensive — real depth is at most ~4).
   *   - Bails silently on any timeout / locator error; the original path is
   *     already on screen.
   */
  private async continueExpansionToLeaf(
    materialId: string,
    unitsToExpand: number[]
  ): Promise<void> {
    const MAX_EXTRA_HOPS = 10;

    for (let hop = 0; hop < MAX_EXTRA_HOPS; hop++) {
      const currentUnit = unitsToExpand[unitsToExpand.length - 1];
      const wrapper = this.subRowCellsWrapperFor(materialId, currentUnit);

      // Wrapper not present → current unit is itself a leaf, nothing to do.
      const wrapperVisible = await wrapper
        .isVisible({ timeout: 1500 })
        .catch(() => false);
      if (!wrapperVisible) {
        console.info(
          `[expandHierarchyToLeaf] No sub-row wrapper under unit ${currentUnit} — leaf reached (freestyle).`
        );
        return;
      }

      // Collect all child sub-row cells under the current unit.
      const childCells = wrapper.locator(`[data-testid^="sub-row-cell-${materialId}-"]`);
      const childCount = await childCells.count().catch(() => 0);
      if (childCount === 0) {
        console.info(
          `[expandHierarchyToLeaf] No child cells under unit ${currentUnit} — leaf reached (freestyle).`
        );
        return;
      }

      // Try a random order so different test runs exercise different paths.
      const indices = Array.from({ length: childCount }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      let advanced = false;
      for (const idx of indices) {
        const childCell = childCells.nth(idx);
        const testId = await childCell.getAttribute('data-testid').catch(() => null);
        if (!testId) continue;

        // testid format: sub-row-cell-<materialId>-<unitId>
        const match = testId.match(new RegExp(`^sub-row-cell-${materialId}-(\\d+)$`));
        if (!match) continue;
        const childUnitId = Number(match[1]);
        if (!Number.isFinite(childUnitId) || unitsToExpand.includes(childUnitId)) continue;

        try {
          // Clear any loading overlay first — it intercepts the hover and
          // would make this sibling look un-expandable.
          await this.waitForAmmoLoadingGone();
          await childCell.scrollIntoViewIfNeeded({ timeout: 2000 });
          await childCell.hover({ timeout: 2000 });
        } catch {
          // hover failed — try another sibling
          continue;
        }

        const networkBtn = this.networkButton(materialId, childUnitId);
        const hasNetworkBtn = await networkBtn
          .isVisible({ timeout: 1000 })
          .catch(() => false);

        if (!hasNetworkBtn) {
          // This child is itself a leaf — the whole level is leaves, stop.
          console.info(
            `[expandHierarchyToLeaf] Freestyle: unit ${childUnitId} has no network button — leaf level reached.`
          );
          return;
        }

        console.info(
          `[expandHierarchyToLeaf] Freestyle hop ${hop + 1}: expanding child unit ${childUnitId} under ${currentUnit}.`
        );
        await networkBtn.click();
        unitsToExpand.push(childUnitId);

        // Wait for this child's own sub-row wrapper to appear before continuing.
        await this.subRowCellsWrapperFor(materialId, childUnitId)
          .waitFor({ state: 'visible', timeout: 10_000 })
          .catch(() => {
            console.warn(
              `[expandHierarchyToLeaf] Freestyle: sub-row wrapper for ${childUnitId} did not appear in time.`
            );
          });

        advanced = true;
        break;
      }

      if (!advanced) {
        // Couldn't expand any child at this level — treat as leaf.
        console.info(
          `[expandHierarchyToLeaf] Freestyle: no expandable child under unit ${currentUnit} — stopping.`
        );
        return;
      }
    }

    console.warn(
      `[expandHierarchyToLeaf] Freestyle: hit MAX_EXTRA_HOPS (${MAX_EXTRA_HOPS}) — stopping.`
    );
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
        const candidate = this.subRowCellsWrapperFor(materialId, unitsToExpand[i]);
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
        const childWrapper = this.subRowCellsWrapperFor(materialId, parseInt(uid, 10));
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
          const chipZero = this.chipZeroCell(wrapper!, materialId, unitId);
          const numberedGroup = this.numberedGroupCell(wrapper!, materialId, unitId);

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
            const inputField = this.cellInputField(numberedGroup);
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
          const incrementBtn = this.incrementButton(wrapper!, materialId, unitId);
          const inputField = this.cellInputField(numberedGroup);

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
    newHierarchy: number[],
    opts: { skipConfirmAndLock?: boolean } = {},
  ): Promise<void> {
    const { skipConfirmAndLock = false } = opts;
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

    const ROOT_UNIT_ID = 1;

    // ── Matkal special-case ──────────────────────────────────────────────
    // When the new parent is Matkal (root), the drawer renders a single
    // "anchor" combobox at the top — NOT the per-node accordion+combobox
    // used for every other level. No tooltip/accordion expansion is needed
    // (there is none for the root); we just type into the anchor combobox
    // and click its action button.
    if (newParentId === ROOT_UNIT_ID) {
      console.info(`[unitMoveUI] Matkal target — using anchor combobox`);
      const anchorInput = this.hierarchyAnchorComboboxInput(ROOT_UNIT_ID);
      await anchorInput.waitFor({ state: 'visible', timeout: 10000 });
      const anchorOption = this.hierarchyAnchorComboboxItem(ROOT_UNIT_ID, unitId);

      let pickedAnchor = false;
      for (let attempt = 1; attempt <= 3 && !pickedAnchor; attempt++) {
        try {
          await anchorInput.click();
          await this.waitForNetworkIdle();
          await anchorInput.fill(unitId.toString());

          await anchorOption.waitFor({ state: 'visible', timeout: 8_000 });
          await anchorOption.click();
          pickedAnchor = true;
        } catch (e) {
          console.warn(
            `[unitMoveUI] Matkal anchor item ${unitId} not visible (attempt ${attempt}/3): ${e}`,
          );
          if (attempt === 3) {
            throw new Error(
              `couldnt find target father unit ${newParentId} (Matkal anchor for moving unit ${unitId}) — combobox option never became visible after 3 attempts.`,
            );
          }
          await this.page.waitForTimeout(1000);
        }
      }

      const anchorActionBtn = this.hierarchyAnchorComboboxActionBtn(ROOT_UNIT_ID);
      await anchorActionBtn.waitFor({ state: 'visible', timeout: 3000 });
      await anchorActionBtn.click();
      await this.waitForNetworkIdle();

      if (!skipConfirmAndLock) {
        // Confirm + lock (drawer already open)
        await this.header.confirmationPopupTrigger.waitFor({ state: 'visible', timeout: 3000 });
        await this.header.confirmationPopupTrigger.click();

        await this.header.confirmationPopupConfirmBtn.waitFor({ state: 'visible', timeout: 3000 });
        await this.header.confirmationPopupConfirmBtn.click();
        await this.waitForNetworkIdle();
      } else {
        console.info(`[unitMoveUI] skipConfirmAndLock=true — caller will lock via API.`);
      }

      await this.page.keyboard.press('Escape');
      await this.unitHierarchyDrawerContent
        .waitFor({ state: 'hidden', timeout: 3000 })
        .catch(() => {});

      console.log(`  ✓ unitMoveUI: unit ${unitId} moved to Matkal (anchor flow)`);
      return;
    }

    // ── Non-root parent: expand accordions down to the target parent ─────
    // Build the full ancestor path down to and including the new parent, so
    // each accordion is expanded before we try to interact with the parent's
    // combobox. `newHierarchy` from the data-builder is the path of the
    // MOVED unit at its NEW location, with the ROOT (Matkal=1) dropped:
    //   - INSIDE move to non-root parent: e.g. newHierarchy=[3, 38, 419],
    //     newParentId=3  → ancestors to expand = [3]
    //   - Move to any intermediate node: newHierarchy=[3, 38, 419],
    //     newParentId=38 → ancestors to expand = [3, 38]
    const parentIndex = newHierarchy.indexOf(newParentId);
    const ancestorsToExpand: number[] =
      parentIndex !== -1
        ? newHierarchy.slice(0, parentIndex + 1)
        : [newParentId];

    for (const ancestorId of ancestorsToExpand) {
      // Try the expand tooltip first, then fall back to the accordion trigger.
      const expandTooltip = this.hierarchyExpandTooltip(ancestorId);
      const accordion = this.accordionTrigger(ancestorId);

      const tooltipVisible = await expandTooltip
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (tooltipVisible) {
        await expandTooltip.click();
        await this.page.waitForTimeout(150);
        continue;
      }
      const accordionVisible = await accordion
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (accordionVisible) {
        await accordion.click();
        await this.page.waitForTimeout(150);
      } else {
        console.warn(
          `[unitMoveUI] Could not find expand/accordion trigger for ancestor ${ancestorId} — assuming already expanded.`,
        );
      }
    }

    const comboboxInput = this.hierarchyComboboxInput(newParentId);
    const unitOption = this.hierarchyComboboxItem(newParentId, unitId);

    // Some backend filter responses are slow / the dropdown may render the
    // item with a delay. Retry the type-and-pick cycle up to 3 times before
    // giving up — clearing the input between attempts so the filter re-runs.
    //
    // IMPORTANT: a LOCKED destination parent renders in the drawer (its
    // accordion is visible) but NEVER exposes its combobox input — locked
    // nodes are not editable. Previously this loop would just time out on the
    // missing input and fail with a generic message. We now, on each attempt,
    // (re)expand the parent's accordion and explicitly detect the
    // locked-but-no-input case so the caller can recover (re-unlock + reload).
    let picked = false;
    for (let attempt = 1; attempt <= 3 && !picked; attempt++) {
      try {
        // Re-expand the target parent's accordion each attempt. A reload during
        // a recovery collapses it again, and a freshly-unlocked node may need a
        // second expand before its combobox mounts.
        const accordion = this.accordionTrigger(newParentId);
        if (await accordion.isVisible({ timeout: 1000 }).catch(() => false)) {
          const inputAlreadyThere = await comboboxInput
            .isVisible({ timeout: 500 })
            .catch(() => false);
          if (!inputAlreadyThere) {
            await accordion.click().catch(() => {});
            await this.page.waitForTimeout(200);
          }
        }

        // If the node is present but its input never mounts, it is LOCKED.
        // Surface that precise cause immediately so the caller re-unlocks
        // instead of burning the full retry budget on a generic timeout.
        const inputVisible = await comboboxInput
          .isVisible({ timeout: 4_000 })
          .catch(() => false);
        if (!inputVisible) {
          const nodePresent = await this.accordionTrigger(newParentId)
            .isVisible({ timeout: 500 })
            .catch(() => false);
          throw new Error(
            nodePresent
              ? `target parent ${newParentId} is present in the drawer but its combobox input never rendered — the node is LOCKED (locked nodes are not editable). Re-unlock parent ${newParentId} before retrying the move.`
              : `target parent ${newParentId} did not render in the drawer at all (node missing).`,
          );
        }

        await comboboxInput.click();
        await this.waitForNetworkIdle();
        await comboboxInput.fill('');
        await this.page.waitForTimeout(150);
        await comboboxInput.fill(unitId.toString());

        await unitOption.waitFor({ state: 'visible', timeout: 8_000 });
        await unitOption.click();
        picked = true;
      } catch (e) {
        console.warn(
          `[unitMoveUI] combobox-${newParentId} item ${unitId} not visible (attempt ${attempt}/3): ${e}`,
        );
        if (attempt === 3) {
          throw new Error(
            `couldnt find target father unit ${newParentId} (combobox dropdown for moving unit ${unitId} into parent ${newParentId} never offered the unit after 3 attempts). The parent unit may not be unlocked, may not exist in the drawer, or its accordion may not have expanded.`,
          );
        }
        await this.page.waitForTimeout(1000);
      }
    }

    // Click the action button (labeled "הוספה") to execute the move
    const actionBtn = this.hierarchyComboboxActionBtn(newParentId);
    await actionBtn.waitFor({ state: 'visible', timeout: 3000 });
    await actionBtn.click();
    await this.waitForNetworkIdle();

    if (!skipConfirmAndLock) {
      // Confirm and lock directly (drawer is already open from ensureDrawerOpen above)
      await this.header.confirmationPopupTrigger.waitFor({ state: 'visible', timeout: 3000 });
      await this.header.confirmationPopupTrigger.click();

      await this.header.confirmationPopupConfirmBtn.waitFor({ state: 'visible', timeout: 3000 });
      await this.header.confirmationPopupConfirmBtn.click();
      await this.waitForNetworkIdle();
    } else {
      console.info(`[unitMoveUI] skipConfirmAndLock=true — caller will lock via API.`);
    }

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
  ): Promise<AggregationCheckResult> {
    const hierarchyMap = this._hierarchyMap;
    let allChecksPass = true;

    console.log(`\n[AGGREGATION VERIFICATION]`);

    // ── Full snapshot of every captured cell (unit → value) ───────────────
    // Print the complete list of all units that hold a value (the gdudim/
    // leaves and every parent we captured), sorted by unit id, so the entire
    // calculation is auditable at a glance — you can see exactly which units
    // and values feed into each parent's aggregated total below.
    const capturedEntries = [...allVisibleValues.entries()].sort(
      (a, b) => a[0] - b[0],
    );
    const capturedLine =
      `[ALL CAPTURED VALUES] ${capturedEntries.length} cell(s): ${capturedEntries
        .map(([unitId, value]) => `${unitId}=${value}`)
        .join(', ')}`;
    console.log(`  ${capturedLine}`);

    // Collect a detailed, human-readable breakdown of every FAILING parent so
    // the thrown assertion can carry the exact child units + values + sum that
    // violated the rule — enough to debug from the report alone, without
    // re-running. Each entry lists every child (gdud/leaf) with its value, the
    // computed Σ, the parent's own value, and the signed difference.
    const failureReports: string[] = [];

    for (const parentUnitId of unitsToExpand) {
      const hasParent = allVisibleValues.has(parentUnitId);
      const parentValue = allVisibleValues.get(parentUnitId);
      const children = hierarchyMap.get(parentUnitId) || [];

      if (children.length === 0) continue;

      // Build the per-child value breakdown ONCE so it feeds both the console
      // line and the failure report. A child absent from the snapshot is shown
      // as `MISSING` rather than silently skipped, so a missing cell is never
      // mistaken for a real zero.
      const childBreakdown = children
        .map((c) => `${c}=${allVisibleValues.has(c) ? allVisibleValues.get(c) : 'MISSING'}`)
        .join(', ');

      // If the parent cell isn't in the captured snapshot it means the
      // unit was not rendered when we ran the capture — treat as a clear
      // failure rather than silently using 0, which would mask the real
      // problem behind a confusing "0 ≠ sum" message.
      if (!hasParent) {
        console.log(
          `  ✗ Unit ${parentUnitId}: MISSING from captured snapshot — cannot verify aggregation` +
            `  ← children (${children.length}): [${childBreakdown}]`,
        );
        failureReports.push(
          `Unit ${parentUnitId}: PARENT cell MISSING from captured snapshot — cannot verify ` +
            `aggregation. Children (${children.length}) with values: [${childBreakdown}]`,
        );
        allChecksPass = false;
        continue;
      }

      let childrenSum = 0;
      let missingChild: number | null = null;
      for (const childId of children) {
        if (!allVisibleValues.has(childId)) {
          missingChild = childId;
          break;
        }
        childrenSum += allVisibleValues.get(childId)!;
      }

      if (missingChild !== null) {
        console.log(
          `  ✗ Unit ${parentUnitId}: child ${missingChild} MISSING from captured snapshot — cannot verify aggregation` +
            `  ← children (${children.length}): [${childBreakdown}]`,
        );
        failureReports.push(
          `Unit ${parentUnitId} (parent=${parentValue}): child ${missingChild} MISSING from captured ` +
            `snapshot — cannot verify aggregation. Children (${children.length}) with values: [${childBreakdown}]`,
        );
        allChecksPass = false;
        continue;
      }

      const isPassed = parentValue === childrenSum;
      const status = isPassed ? '✓' : '✗';
      // Always log the full child breakdown (even on PASS) so the surrounding
      // gdud/leaf context is visible when an adjacent parent fails.
      console.log(
        `  ${status} Unit ${parentUnitId}: parent=${parentValue} ${isPassed ? '===' : '≠'} Σchildren=${childrenSum}` +
          `  ← children (${children.length}): [${childBreakdown}]`,
      );

      if (!isPassed) {
        const diff = childrenSum - (parentValue ?? 0);
        failureReports.push(
          `Unit ${parentUnitId}: parent=${parentValue} ≠ Σchildren=${childrenSum} ` +
            `(diff ${diff > 0 ? '+' : ''}${diff}). Children (${children.length}) with values: [${childBreakdown}]`,
        );
        allChecksPass = false;
      }
    }

    // The report is only populated on failure: the full captured snapshot
    // followed by one detailed line per violating parent. Callers append it to
    // the assertion message so the error log alone shows every unit + value +
    // sum (the list of gdudim with values) needed to debug.
    const report = allChecksPass
      ? ''
      : [`  ${capturedLine}`, ...failureReports.map((r) => `  ✗ ${r}`)].join('\n');

    return { ok: allChecksPass, report };
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
