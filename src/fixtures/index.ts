import { test as base } from '@playwright/test';
import { ShechelPage } from '../pages/ShechelPage';
import { lockCompleteHierarchy } from '../api/apiHelpers';
import { ClientError } from '../api/reportUnits';
import aggregationData from '../testData/changeHierarchyData.json';
import regularTestsData from '../testData/regularTestsData.json';

// ─────────────────────────────────────────────────────────────────────────────
// topUnitsByDescription – maps a dataset entry's `description` string to the
// set of TOP-level units that must be locked before any test using it runs.
//
// Tests are expected to name themselves `<testName>[<description>]` so this
// hook can extract the description and find the correct entry, regardless of
// which test (sanity, e2e, etc.) references the data.
//
// For every dataset entry we collect:
//   • unitsToExpand[0]  (top of the original hierarchy)
//   • newHierarchy[0]   (top of the destination hierarchy, if present)
// ─────────────────────────────────────────────────────────────────────────────

const topUnitsByDescription = new Map<string, number[]>();
/** Descriptions whose tests will MOVE a given unit — used to skip locking
 *  the unit-to-move (locking it would block the test's own move). */
const unitToMoveByDescription = new Map<string, number>();

const allDataSources: Record<string, unknown> = {
  ...aggregationData,
  ...regularTestsData,
};

for (const entries of Object.values(allDataSources)) {
  if (!Array.isArray(entries)) continue;
  for (const entry of entries) {
    if (!entry || !entry.description) continue;
    const tops = new Set<number>();
    if (Array.isArray(entry.unitsToExpand) && entry.unitsToExpand.length > 0) {
      tops.add(entry.unitsToExpand[0]);
    }
    if (Array.isArray(entry.newHierarchy) && entry.newHierarchy.length > 0) {
      tops.add(entry.newHierarchy[0]);
    }
    if (tops.size > 0) {
      const existing = topUnitsByDescription.get(entry.description);
      const merged = new Set<number>([...(existing ?? []), ...tops]);
      topUnitsByDescription.set(entry.description, [...merged]);
    }
    if (typeof entry.unitToMove === 'number') {
      unitToMoveByDescription.set(entry.description, entry.unitToMove);
    }
  }
}

/** Extract the `description` from a test title formatted as `name[description]`.
 *
 * Robust against descriptions that themselves contain `[ ]` (e.g. `[OUTSIDE]`).
 * Strategy: strip optional trailing `@tag` markers, then take everything
 * between the FIRST `[` and the LAST `]`. Falls back to undefined.
 */
function descriptionFromTitle(title: string): string | undefined {
  // Strip trailing playwright-style tags like " @smoke @fast"
  const cleaned = title.replace(/(?:\s+@\S+)+\s*$/, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first === -1 || last === -1 || last <= first + 1) return undefined;
  return cleaned.slice(first + 1, last);
}

// ============ Extend Playwright Test with Custom Fixtures ============

export const test = base.extend<{
  hierarchyPage: ShechelPage;
}>({
  
  /**
   * FIXTURE: hierarchyPage
   * 
   * PURPOSE: Initialize and provide the mainPage POM for all tests
   * 
   * NOTE: Page is automatically opened via beforeEach hook
   * 
   * USAGE:
   * test('my test', async ({ hierarchyPage }) => {
   *   // Page is already open!
   *   await hierarchyPage.selectMakatFromDropdown('m0000001');
   * });
   */
  hierarchyPage: async ({ page }, use) => {
    // Setup: Create mainPage instance
    const hierarchyPage = new ShechelPage(page);
    
    // Provide to test
    await use(hierarchyPage);
    
    // Teardown: (if needed)
  },

});

// ============ Global Hooks ============

/**
 * HOOK: beforeEach
 *
 * 1. Locks the top-level units referenced by the current test's data
 *    (unitsToExpand[0] and newHierarchy[0]) via the API.
 *    The Makat combobox in the UI is ONLY rendered when at least one
 *    top-level unit is locked, so this lock is a hard prerequisite for
 *    every test — a failure here must abort the test fast with a clear
 *    error rather than letting the test crawl through ~60 s of combobox
 *    timeouts.
 * 2. Navigates to the page.
 */
test.beforeEach(async ({ hierarchyPage, request }) => {
  const title = test.info().title;

  // ─── @no-lock escape hatch ────────────────────────────────────────────────
  // A test tagged `@no-lock` (e.g. the CI sanity check) does NOT touch the
  // app UI or the backend hierarchy, so it needs neither a top-unit lock nor
  // a page navigation. Without this early return the hook below would throw
  // for such a test, because its title has no `[description]` to resolve
  // top units from. Honor the tag and skip all setup.
  if (/(^|\s)@no-lock(\s|$)/.test(title) || test.info().tags.includes('@no-lock')) {
    console.info(`[beforeEach] "${title}" is tagged @no-lock — skipping lock + navigation.`);
    return;
  }

  const description = descriptionFromTitle(title);
  const rawTopUnits = description ? topUnitsByDescription.get(description) : undefined;
  const unitToMove = description ? unitToMoveByDescription.get(description) : undefined;

  // HARD REQUIREMENT: every test MUST declare the top units it operates on,
  // so the hook can lock them before the test runs. If a test's data has no
  // `unitsToExpand` / `newHierarchy`, we cannot know what to lock — fail
  // fast with a clear error instead of letting the test crawl through a
  // 60 s combobox timeout.
  if (!description) {
    throw new Error(
      `[beforeEach] Test title "${title}" does not match the required ` +
        `"<name>[<description>]" format — cannot resolve top units to lock.`,
    );
  }
  if (!rawTopUnits || rawTopUnits.length === 0) {
    throw new Error(
      `[beforeEach] No top units found for description "${description}". ` +
        `Every test data entry MUST declare \`unitsToExpand\` (and/or \`newHierarchy\`) ` +
        `so the hook can lock the top unit before the test runs.`,
    );
  }

  // ─── What to lock up front ────────────────────────────────────────────────
  //
  // `rawTopUnits` is built as [ unitsToExpand[0], newHierarchy[0] ] — i.e.
  //   index 0 = SOURCE branch top (where the BEFORE values are set/saved)
  //   index 1 = DESTINATION branch top a.k.a. the "new father" (only relevant
  //             AFTER the move).
  //
  // We only need the SOURCE branch locked before the test runs:
  //   • It is the branch whose leaf values we expand, set and save in the
  //     BEFORE phase, so it must be editable.
  //   • It satisfies the "Makat combobox renders only when ≥1 top unit is
  //     locked" prerequisite on its own.
  //
  // We deliberately DO NOT lock the destination/new father here:
  //   • It is irrelevant until after the move.
  //   • Every flow `unlockCompleteHierarchy(original, new)` right before the
  //     move (which would unlock it anyway) and then re-locks it via
  //     `lockCompleteHierarchy([source[0], new[0]])` AFTER the move, exactly
  //     when it becomes relevant.
  //   • Locking it up front is a wasted lock→unlock round-trip and an extra
  //     chance to hit the backend's 502 "ההיררכיה תחתיך השתנתה" error.
  //
  // Never lock Matkal (unit 1): it is the global root, and locking it
  // contends with every other parallel worker (and the backend frequently
  // returns 502 on /reportUnits for it). Skip it silently.
  //
  // EXCEPTION — "move out of root" (sourceTop === unitToMove):
  //   When the moved unit IS the source top-level unit (its parent is Matkal,
  //   so `unitsToExpand[0] === unitToMove`), we still lock it. Filtering it out
  //   would leave its own branch with NOTHING locked — the UI then can't enter
  //   edit mode for the unit's subtree, so setting/saving its BEFORE values is
  //   unreliable and the test fails late (move not committing, row not
  //   hydrating). The flows unlock the original hierarchy BEFORE the move, so
  //   keeping this unit locked here does NOT block the move under test.
  //
  // Otherwise (sourceTop !== unitToMove) we skip locking the unit-to-move, as
  // locking a deeper moved unit would block the very operation under test.
  const sourceTop = rawTopUnits[0]; // unitsToExpand[0] — top of the source branch
  let topUnits = [sourceTop].filter(
    (u) => u !== 1 && (u !== unitToMove || u === sourceTop),
  );

  // Safety net: if filtering left us with no top units to lock (e.g. the
  // only top unit was Matkal itself, or was the unit-to-move), skip the
  // lock phase entirely. Some other parallel worker will have a non-Matkal
  // top unit locked, which is enough for the Makat combobox to render.
  if (topUnits.length === 0) {
    console.info(
      `[beforeEach] No non-Matkal top units to lock for "${title}" — skipping lock phase.`,
    );
  }

  // Build the lock work as a Promise but DON'T await it yet — we want to
  // run it in parallel with the SPA navigation below. The Makat combobox
  // only renders once a top unit is locked AND React has rendered, so
  // both must complete before `waitForMakatComboboxReady` succeeds — but
  // they don't depend on each other and can run concurrently to save a
  // few seconds per test.
  const lockAttempts = [0, 2000, 4000, 6000, 8000]; // ms to wait BEFORE each attempt
  const lockPromise: Promise<void> = (async () => {
    if (topUnits.length === 0) return; // nothing to lock — proceed
    let lockError: unknown;
    for (let i = 0; i < lockAttempts.length; i++) {
      const waitMs = lockAttempts[i];
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      try {
        console.log(
          `[beforeEach] Locking top units [${topUnits.join(', ')}] for: ${title} (attempt ${i + 1}/${lockAttempts.length})`,
        );
        await lockCompleteHierarchy(request, topUnits);
        console.log(`[beforeEach] Top units locked ✓`);
        return;
      } catch (error) {
        // Only "conflict" style 4xx (409 / 422) means the unit is already in the
        // desired state — those are safe to treat as a soft-success. A 400, 401,
        // 403, 404 etc. is a REAL bug and must NOT be swallowed.
        if (error instanceof ClientError && (error.status === 409 || error.status === 422)) {
          console.info(
            `[beforeEach] Lock for [${topUnits.join(', ')}] returned HTTP ${error.status} — treating as "already locked", proceeding.`,
          );
          return;
        }
        lockError = error;
        console.warn(
          `[beforeEach] Lock attempt ${i + 1}/${lockAttempts.length} for [${topUnits.join(', ')}] failed: ${error}`,
        );
        // Non-conflict 4xx will never succeed on retry — bail out immediately.
        if (error instanceof ClientError) break;
      }
    }
    throw new Error(
      `[beforeEach] Could not lock top units [${topUnits.join(', ')}] after ${lockAttempts.length} attempts — ` +
        `Makat combobox cannot appear without at least one locked unit. ` +
        `Underlying error: ${lockError}`,
    );
  })();

  // Retry navigation if the page doesn't fully load (cold-start flakiness).
  // The lock runs CONCURRENTLY with the goto() so both finish faster.
  const maxNavigationRetries = 2;
  for (let attempt = 1; attempt <= maxNavigationRetries; attempt++) {
    try {
      // Run navigation + lock in parallel. We must await BOTH before
      // checking the combobox: the combobox needs the lock to have
      // landed AND React to have rendered.
      await Promise.all([hierarchyPage.goto(), lockPromise]);
      const perAttemptTimeout = 40_000 + attempt * 10_000;
      await hierarchyPage.waitForMakatComboboxReady(perAttemptTimeout);
      break; // success
    } catch (error) {
      console.warn(`[beforeEach] Page load attempt ${attempt}/${maxNavigationRetries} failed: ${error}`);
      if (attempt === maxNavigationRetries) throw error;
      console.log(`[beforeEach] Retrying with fresh navigation + reload...`);
      // Force a hard reload before retrying so React re-mounts cleanly.
      try {
        await hierarchyPage.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch { /* ignore — next goto() will recover */ }
    }
  }

  // ─── Ensure the locked source top is actually ON the carousel ─────────────
  // The carousel renders ONLY locked top-level units, and it builds its list
  // from a hierarchy fetch that fires on page load. When our lock lands AFTER
  // that fetch (a common race), the freshly-locked source top never appears in
  // the carousel — so the test body's `expandHierarchyToLeaf` paginates to
  // exhaustion, the first hop ("unit not on any carousel page") fails, and the
  // moved unit is reported BEFORE=MISSING (see the 114 / [6 → 24 → 114] case).
  //
  // The remedy is exactly what `isTopUnitOnCarousel` documents: reload so the
  // carousel re-fetches the hierarchy and picks up the lock. This is SAFE here
  // because no makat has been added yet (a reload loses nothing). We
  // deliberately do NOT do this inside `expandHierarchyToLeaf`, where a reload
  // would drop the unsaved makat row mid-test.
  //
  // `topUnits[0]` is the locked source top (when we locked anything). If the
  // lock phase was skipped (no non-Matkal top to lock), there is nothing to
  // verify and some other worker's locked unit keeps the carousel populated.
  const lockedSourceTop = topUnits[0];
  if (lockedSourceTop !== undefined) {
    const CAROUSEL_RELOADS = 3;
    for (let r = 0; r < CAROUSEL_RELOADS; r++) {
      const onCarousel = await hierarchyPage
        .isTopUnitOnCarousel(lockedSourceTop)
        .catch(() => false);
      if (onCarousel) {
        if (r > 0) {
          console.log(
            `[beforeEach] Source top ${lockedSourceTop} now on carousel after ${r} reload(s) ✓`,
          );
        }
        break;
      }
      if (r === CAROUSEL_RELOADS - 1) {
        console.warn(
          `[beforeEach] Source top ${lockedSourceTop} still not on carousel after ${CAROUSEL_RELOADS} reload(s) — ` +
            `proceeding anyway; the test body's carousel pagination is the final fallback.`,
        );
        break;
      }
      console.warn(
        `[beforeEach] Source top ${lockedSourceTop} not yet on carousel — reloading to re-fetch hierarchy (${r + 1}/${CAROUSEL_RELOADS})…`,
      );
      try {
        await hierarchyPage.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        await hierarchyPage.waitForMakatComboboxReady(30_000);
      } catch {
        /* ignore — next loop iteration re-checks, and the test body can still recover */
      }
    }
  }
});

// Export the extended test for use in test files
export { expect } from '@playwright/test';