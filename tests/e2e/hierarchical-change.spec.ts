import { test, expect } from '../../src/fixtures';
import { withPhase } from '../../src/fixtures/withPhase';
import aggregationData from '../../src/testData/changeHierarchyData.json';
import {
  unlockCompleteHierarchy,
  lockCompleteHierarchy,
} from '../../src/api/apiHelpers';
import { updateUnitHierarchy } from '../../src/api/hierarchychange';
import { waitForUnitParent } from '../../src/api/dynamicHierarchyDiscovery';
import {
  groupByAllComponents,
  clusterLabelAll,
} from '../../src/fixtures/parallelGroups';
import type { ShechelPage } from '../../src/pages/ShechelPage';
import type { APIRequestContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Cross-dataset clustering.
//
// Every entry — regardless of which test function will run it — is tagged with
// a `_kind` and merged into ONE array. We then cluster ONCE using the full
// unit-set of each entry. This guarantees that across the whole file no two
// `describe.serial` blocks share any unit, so different clusters are safe to
// run in parallel across workers.
//
// Inside one cluster: tests may be a mix of VP / AGG / OLD; they share units
// so they run serially. Across clusters: zero unit overlap → full parallelism.
// ─────────────────────────────────────────────────────────────────────────────

type Kind = 'VP' | 'AGG' | 'OLD';
interface TaggedEntry {
  _kind: Kind;
  materialId: string;
  description: string;
  hatunit: number;
  unitsToExpand: number[];
  newHierarchy: number[];
  unitToMove: number;
  newParentUnit: number;
  oldParentUnit: number;
}

const tagged: TaggedEntry[] = [
  ...aggregationData.test_hierarchicalChangeValuePreservation.map(
    (d): TaggedEntry => ({ ...d, _kind: 'VP' }),
  ),
  ...aggregationData.test_hierarchicalChangeAggregation.map(
    (d): TaggedEntry => ({ ...d, _kind: 'AGG' }),
  ),
  ...aggregationData.test_hierarchicalChangeOldHierarchyAggregation.map(
    (d): TaggedEntry => ({ ...d, _kind: 'OLD' }),
  ),
];

// ─── Test bodies (one per kind), extracted so a single cluster can mix kinds ──

async function runValuePreservation(
  hierarchyPage: ShechelPage,
  request: APIRequestContext,
  data: TaggedEntry,
): Promise<void> {
  const {
    materialId: makatId,
    unitsToExpand: originalHierarchy,
    newHierarchy,
    unitToMove,
    newParentUnit,
  } = data;
  const ctx = { makatId, unitToMove, newParentUnit, newHierarchy };

  await withPhase('Add makat from dropdown', ctx, () =>
    hierarchyPage.addMakatFromDropdown(makatId),
  );
  await withPhase('Expand original hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy),
  );
  await withPhase('Set leaf cell values', ctx, () =>
    hierarchyPage.setLeafCellValues(makatId, originalHierarchy, 1),
  );
  const valuesBefore = await withPhase('Capture values BEFORE move', ctx, () =>
    hierarchyPage.captureAllVisibleCellValuesAtEachLevel(
      makatId,
      originalHierarchy,
    ),
  );
  await withPhase('Save material BEFORE move', ctx, () =>
    hierarchyPage.saveMaterial(),
  );

  await withPhase('Unlock complete hierarchy (API)', ctx, () =>
    unlockCompleteHierarchy(request, originalHierarchy, newHierarchy),
  );
  await withPhase('Reload page after unlock', ctx, async () => {
    await hierarchyPage.page.reload();
    await hierarchyPage.page.waitForLoadState('networkidle');
  });
  // Perform the move via the UI but SKIP the in-UI confirm-and-lock step.
  // Locking via the confirmation popup is flaky; we lock via API right after.
  await withPhase('Move unit via UI', ctx, () =>
    hierarchyPage.unitMoveUI(unitToMove, newParentUnit, newHierarchy, {
      skipConfirmAndLock: true,
    }),
  );
  await withPhase('Lock complete hierarchy (API)', ctx, () =>
    lockCompleteHierarchy(request, [originalHierarchy[0], newHierarchy[0]]),
  );

  // Wait for the backend hierarchy to actually reflect the move before we
  // try to read the moved unit's new row.
  await withPhase('Wait for backend to reflect move', ctx, () =>
    waitForUnitParent(request, unitToMove, newParentUnit),
  );

  // AFTER the move: do EXACTLY the same find+open hierarchy steps as BEFORE.
  // (Expand the new hierarchy, then capture values.) No reload, no re-add,
  // no extra waits — keep the two flows symmetric.
  await withPhase('Expand new hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchy),
  );
  const valuesAfter = await withPhase('Capture values AFTER move', ctx, () =>
    hierarchyPage.captureAllVisibleCellValuesAtEachLevel(
      makatId,
      newHierarchy,
    ),
  );

  // ─── Final assertions with explicit, actionable error messages ───────────
  const beforeFound = valuesBefore.has(unitToMove);
  const afterFound = valuesAfter.has(unitToMove);
  const before = beforeFound ? valuesBefore.get(unitToMove) : 'MISSING';
  const after = afterFound ? valuesAfter.get(unitToMove) : 'MISSING';
  const match = beforeFound && afterFound && before === after;
  console.log(`\n[MOVED UNIT HIERARCHY PRESERVATION CHECK]`);
  console.log(
    `  ${match ? '✓' : '✗'} Moved Unit ${unitToMove}: BEFORE=${before}, AFTER=${after}`,
  );

  if (!beforeFound) {
    throw new Error(
      `[ASSERTION: unit-not-found-before] Unit ${unitToMove} was NOT found in the UI BEFORE the move (path [${originalHierarchy.join(
        ' → ',
      )}]). The capture saw no row/sub-row/numbered cell for this unit, so the test data is invalid or the original hierarchy did not render.`,
    );
  }
  if (!afterFound) {
    throw new Error(
      `[ASSERTION: unit-not-found-after] Unit ${unitToMove} was NOT found in the UI AFTER the move to parent ${newParentUnit} (path [${newHierarchy.join(
        ' → ',
      )}]). Either the move did not take effect in the UI, or the UI never re-rendered the moved unit at its new location.`,
    );
  }
  expect(
    match,
    `[ASSERTION: value-mismatch] Unit ${unitToMove} value changed across the move: BEFORE=${before}, AFTER=${after} (expected them to be equal — value preservation violated).`,
  ).toBe(true);
  console.log(`✓ TEST PASSED: Moved unit hierarchy preserved after move!\n`);
}

async function runAggregation(
  hierarchyPage: ShechelPage,
  request: APIRequestContext,
  data: TaggedEntry,
): Promise<void> {
  const {
    materialId: makatId,
    unitsToExpand: originalHierarchy,
    newHierarchy,
    unitToMove,
    newParentUnit,
    hatunit,
  } = data;
  const ctx = { makatId, unitToMove, newParentUnit, newHierarchy };

  await withPhase('Add makat from dropdown', ctx, () =>
    hierarchyPage.addMakatFromDropdown(makatId),
  );
  await withPhase('Expand original hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy),
  );
  await withPhase('Set leaf cell values', ctx, () =>
    hierarchyPage.setLeafCellValues(makatId, originalHierarchy, 1),
  );
  await withPhase('Save material BEFORE move', ctx, () =>
    hierarchyPage.saveMaterial(),
  );

  await withPhase('Unlock complete hierarchy (API)', ctx, () =>
    unlockCompleteHierarchy(request, originalHierarchy, newHierarchy),
  );
  await withPhase('Update unit hierarchy (API)', ctx, () =>
    updateUnitHierarchy(request, unitToMove, newParentUnit, 1, hatunit),
  );
  await withPhase('Lock complete hierarchy (API)', ctx, () =>
    lockCompleteHierarchy(request, [originalHierarchy[0], newHierarchy[0]]),
  );

  await withPhase('Wait for backend to reflect move', ctx, () =>
    waitForUnitParent(request, unitToMove, newParentUnit),
  );

  await withPhase('Reload page after move', ctx, async () => {
    await hierarchyPage.page.reload();
    await hierarchyPage.page.waitForLoadState('networkidle');
  });
  // Reload drops the makat selection — re-add it before expanding.
  await withPhase('Re-add makat after reload', ctx, () =>
    hierarchyPage.addMakatFromDropdown(makatId),
  );
  await withPhase('Expand new hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchy),
  );

  console.log(`\n[CAPTURING ALL VISIBLE CELLS] Including all siblings at each level...`);
  const allVisibleValues = await withPhase(
    'Capture values for new hierarchy',
    ctx,
    () =>
      hierarchyPage.captureAllVisibleCellValuesAtEachLevel(
        makatId,
        newHierarchy,
      ),
  );

  console.log(`\n[AGGREGATION VERIFICATION FOR NEW HIERARCHY]`);
  const aggregationValid = await withPhase(
    'Verify aggregation for new hierarchy',
    ctx,
    () =>
      hierarchyPage.verifyAggregationWithAllVisibleCells(
        makatId,
        newHierarchy,
        allVisibleValues,
      ),
  );
  expect(
    aggregationValid,
    `[ASSERTION: aggregation-invalid-new-hierarchy] Aggregation rule (parent = sum(children)) violated on the NEW hierarchy [${newHierarchy.join(
      ' → ',
    )}] after moving unit ${unitToMove} under ${newParentUnit}.`,
  ).toBe(true);
  console.log(`✓ TEST PASSED: Aggregation verified for entire new hierarchy!\n`);
}

async function runOldHierarchyAggregation(
  hierarchyPage: ShechelPage,
  request: APIRequestContext,
  data: TaggedEntry,
): Promise<void> {
  const {
    materialId: makatId,
    unitsToExpand: originalHierarchy,
    newHierarchy,
    unitToMove,
    newParentUnit,
    oldParentUnit,
    hatunit,
  } = data;
  const ctx = { makatId, unitToMove, newParentUnit, oldParentUnit, newHierarchy };

  await withPhase('Add makat from dropdown', ctx, () =>
    hierarchyPage.addMakatFromDropdown(makatId),
  );
  await withPhase('Expand original hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy),
  );
  await withPhase('Set leaf cell values', ctx, () =>
    hierarchyPage.setLeafCellValues(makatId, originalHierarchy, 1),
  );
  await withPhase('Save material BEFORE move', ctx, () =>
    hierarchyPage.saveMaterial(),
  );

  await withPhase('Unlock complete hierarchy (API)', ctx, () =>
    unlockCompleteHierarchy(request, originalHierarchy, newHierarchy),
  );
  await withPhase('Update unit hierarchy (API)', ctx, () =>
    updateUnitHierarchy(request, unitToMove, newParentUnit, 1, hatunit),
  );
  await withPhase('Lock complete hierarchy (API)', ctx, () =>
    lockCompleteHierarchy(request, [originalHierarchy[0], newHierarchy[0]]),
  );

  await withPhase('Wait for backend to reflect move', ctx, () =>
    waitForUnitParent(request, unitToMove, newParentUnit),
  );

  await withPhase('Reload page after move', ctx, async () => {
    await hierarchyPage.page.reload();
    await hierarchyPage.page.waitForLoadState('networkidle');
  });
  // Reload drops the makat selection — re-add it before expanding.
  await withPhase('Re-add makat after reload', ctx, () =>
    hierarchyPage.addMakatFromDropdown(makatId),
  );

  const oldHierarchyPath = originalHierarchy.slice(
    0,
    originalHierarchy.indexOf(oldParentUnit) + 1,
  );
  await withPhase('Expand OLD hierarchy', { ...ctx, oldHierarchyPath }, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, oldHierarchyPath),
  );

  console.log(`\n[CAPTURING ALL VISIBLE CELLS] For old hierarchy after unit removal...`);
  const oldHierarchyValues = await withPhase(
    'Capture values for OLD hierarchy',
    { ...ctx, oldHierarchyPath },
    () =>
      hierarchyPage.captureAllVisibleCellValuesAtEachLevel(
        makatId,
        oldHierarchyPath,
      ),
  );

  console.log(`\n[MOVED UNIT ABSENCE CHECK]`);
  if (oldHierarchyValues.has(unitToMove)) {
    const staleValue = oldHierarchyValues.get(unitToMove);
    throw new Error(
      `[ASSERTION: moved-unit-still-in-old-hierarchy] Unit ${unitToMove} was NOT removed from the OLD hierarchy path [${oldHierarchyPath.join(
        ' → ',
      )}]. It still appears with value=${staleValue}. The move operation may have failed or the UI never refreshed.`,
    );
  }
  console.log(`  ✓ Unit ${unitToMove} is absent from old hierarchy – move confirmed`);

  console.log(`\n[AGGREGATION VERIFICATION FOR OLD HIERARCHY]`);
  const ok = await withPhase(
    'Verify aggregation for OLD hierarchy',
    { ...ctx, oldHierarchyPath },
    () =>
      hierarchyPage.verifyAggregationWithAllVisibleCells(
        makatId,
        oldHierarchyPath,
        oldHierarchyValues,
      ),
  );
  expect(
    ok,
    `[ASSERTION: aggregation-invalid-old-hierarchy] Aggregation rule (parent = sum(children)) violated on the OLD hierarchy [${oldHierarchyPath.join(
      ' → ',
    )}] after unit ${unitToMove} was moved out from under parent ${oldParentUnit}.`,
  ).toBe(true);
  console.log(
    `✓ TEST PASSED: Aggregation verified for OLD hierarchy after unit removal!\n`,
  );
}

const TEST_NAME: Record<Kind, string> = {
  VP: 'test_hierarchicalChangeValuePreservation',
  AGG: 'test_hierarchicalChangeAggregation',
  OLD: 'test_hierarchicalChangeOldHierarchyAggregation',
};

// ─── One describe per globally-disjoint cluster ─────────────────────────────
// Clusters are unit-disjoint by construction, so different clusters may run
// concurrently across Playwright workers. Inside one cluster entries share
// units (and possibly mix kinds) → run serially.
for (const cluster of groupByAllComponents(tagged)) {
  test.describe.serial(`Mixed@units[${clusterLabelAll(cluster)}]`, () => {
    cluster.forEach((entry) => {
      test(`${TEST_NAME[entry._kind]}[${entry.description}]`, async ({
        hierarchyPage,
        request,
      }) => {
        test.setTimeout(180_000);
        if (entry._kind === 'VP') {
          await runValuePreservation(hierarchyPage, request, entry);
        } else if (entry._kind === 'AGG') {
          await runAggregation(hierarchyPage, request, entry);
        } else {
          await runOldHierarchyAggregation(hierarchyPage, request, entry);
        }
      });
    });
  });
}
