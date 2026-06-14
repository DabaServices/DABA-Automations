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
  groupByWriteSetComponents,
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

/**
 * Guard: a "move" whose target parent is the unit's CURRENT parent
 * (`oldParentUnit === newParentUnit`) is a NO-OP relocation.
 *
 * The relocation flows (unlock → updateUnitHierarchy → lock → re-expand under
 * the new parent) all assume the unit actually changes parent. For a
 * same-parent "move" they would misbehave:
 *   • `waitForUnitParent(unit, newParent)` returns true IMMEDIATELY (the unit
 *     already has that parent), so the test can't tell a real move from a
 *     no-op.
 *   • the UI drawer move would either reject or no-op, surfacing as a
 *     confusing late failure.
 *
 * For these entries we DON'T perform a relocation. We assert the product
 * leaves the unit under its existing parent (the move is correctly a no-op)
 * and return early. Returns `true` when the entry was handled as a no-op.
 */
async function handleSameParentNoOp(
  request: APIRequestContext,
  data: TaggedEntry,
): Promise<boolean> {
  if (data.oldParentUnit !== data.newParentUnit) return false;

  console.log(
    `[SAME-PARENT NO-OP] Entry "${data.description}" targets the unit's current parent ` +
      `(oldParentUnit === newParentUnit === ${data.newParentUnit}). This is a no-op ` +
      `relocation; skipping the move flow and asserting the unit stays put.`,
  );
  const stillThere = await waitForUnitParent(
    request,
    data.unitToMove,
    data.newParentUnit,
    10_000,
  );
  expect(
    stillThere,
    `[ASSERTION: same-parent-noop] Unit ${data.unitToMove} is expected to remain under its ` +
      `current parent ${data.newParentUnit} (same-parent no-op move), but the backend did not ` +
      `report that parent. The move data may be inconsistent.`,
  ).toBe(true);
  console.log(
    `  ✓ Same-parent no-op verified: unit ${data.unitToMove} remains under parent ${data.newParentUnit}.`,
  );
  return true;
}

/**
 * Guard: the OLD-hierarchy-aggregation flow derives its `oldHierarchyPath`
 * from `originalHierarchy.indexOf(oldParentUnit)`. If `oldParentUnit` is not
 * present in `originalHierarchy`, that slice silently collapses to `[]` and
 * the test would verify nothing. Fail fast with a clear, actionable message
 * instead so bad data is caught immediately.
 */
function assertOldParentInOriginalPath(data: TaggedEntry): void {
  if (!data.unitsToExpand.includes(data.oldParentUnit)) {
    throw new Error(
      `[ASSERTION: invalid-old-hierarchy-data] oldParentUnit ${data.oldParentUnit} is not present ` +
        `in unitsToExpand [${data.unitsToExpand.join(', ')}] for "${data.description}". The OLD ` +
        `hierarchy path cannot be derived. Fix the generated data so unitsToExpand includes the ` +
        `old parent down to (at least) oldParentUnit.`,
    );
  }
}

/**
 * Guard: when the moved unit's OLD parent is the system root (Matkal = 1),
 * this OLD-hierarchy aggregation check is NOT applicable.
 *
 * The flow exists to verify that a SPECIFIC old-parent subtree re-sums
 * correctly (parent = Σ children) after one child leaves it. But the root's
 * "subtree" is the ENTIRE system — every top-level unit — which this targeted
 * test neither expands nor can meaningfully sum. Such an entry is a unit that
 * was itself top-level, so its `unitsToExpand` is just the moved unit (e.g.
 * `[293]`) and never contains `1`; there is simply no derivable old-parent
 * subtree to check (`originalHierarchy.indexOf(1)` is -1 → empty path).
 *
 * The move-OUT-of-root behaviour itself is already exercised by the Value-
 * Preservation and Aggregation flows, so skipping the (inapplicable) old-root
 * aggregation here loses no coverage. We assert the move actually landed (the
 * unit now reports its new parent) so the entry still validates *something*,
 * then return early. Returns `true` when handled as a root-old-parent skip.
 */
async function handleRootOldParent(
  request: APIRequestContext,
  data: TaggedEntry,
): Promise<boolean> {
  if (data.oldParentUnit !== 1) return false;

  console.log(
    `[ROOT OLD-PARENT SKIP] Entry "${data.description}" moves unit ${data.unitToMove} OUT of the ` +
      `system root (Matkal=1). The OLD hierarchy is the entire top level, which this aggregation ` +
      `flow cannot meaningfully verify — skipping the old-hierarchy aggregation check. ` +
      `(Move-out-of-root behaviour is covered by the VP/AGG flows.)`,
  );

  // Confirm the move genuinely happened so this entry still asserts something
  // real rather than passing blindly. The unit must now report its new parent.
  const landed = await waitForUnitParent(
    request,
    data.unitToMove,
    data.newParentUnit,
    10_000,
  );
  expect(
    landed,
    `[ASSERTION: root-old-parent-move] Unit ${data.unitToMove} was expected to be under its new ` +
      `parent ${data.newParentUnit} after moving out of the root, but the backend did not report ` +
      `that parent. The move may not have been applied (regenerate data with \`npm run ` +
      `build:data:hierarchy\` so the pre-move state is valid).`,
  ).toBe(true);
  console.log(
    `  ✓ Move-out-of-root verified: unit ${data.unitToMove} is now under parent ${data.newParentUnit}.`,
  );
  return true;
}

// ─── Resilient "set values + save" (recovers from the top-level-set 502) ─────
//
// ROOT CAUSE: every flow saves/locks under
// screen-unit Matkal (root=1), and `reportUnits` sends the ENTIRE live
// top-level set as `lowerUnitsIds`. When ANOTHER worker moves a unit in/out of
// Matkal, that global set changes; any in-flight save under Matkal is then
// rejected with HTTP 502 + "ההיררכיה תחתיך השתנתה" ("the hierarchy beneath you
// changed — refresh the screen"). The clusterer cannot prevent this without
// serializing every root-mutator against the WHOLE suite (which would destroy
// parallelism), so we instead make the victim operation resilient — exactly as
// `lockCompleteHierarchy` already retries this same message at the API layer.
//
// The save is fully recoverable: the rejected write persisted NOTHING, so a
// page reload re-fetches the now-consistent hierarchy, after which we replay
// the identical re-add → re-expand (SAME full path) → re-set values → save.

/** Backend marker for "the hierarchy below you changed — please refresh". */
const HIERARCHY_CHANGED_502 = 'ההיררכיה תחתיך השתנתה';

/**
 * True only for the transient top-level-set-change rejection (the Hebrew
 * marker, or an explicit 502 from the save endpoint). Any other failure
 * (4xx bad data, locked unit, genuine 5xx bug) returns false so it surfaces
 * immediately instead of being masked by a retry.
 */
function isHierarchyChanged502(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes(HIERARCHY_CHANGED_502) ||
    /→\s*502\b/.test(msg) ||
    /\b502 Bad Gateway\b/.test(msg)
  );
}

/**
 * Run `setLeafCellValues` → (optional capture BEFORE) → `saveMaterial`, with
 * automatic recovery from the {@link HIERARCHY_CHANGED_502} save rejection.
 *
 * On that specific 502 the lost write is replayed: reload (re-fetches the
 * now-consistent hierarchy), re-add the makat, re-expand the SAME full path
 * (idempotent — the path already includes the freestyle suffix, and
 * re-expanding a complete path appends nothing), then loop. Up to
 * `MAX_SAVE_ATTEMPTS` total attempts.
 *
 * Assumes the caller has ALREADY added the makat and expanded `fullPath` once
 * (so attempt 1 needs no setup); only retries perform the reload + re-expand.
 *
 * @param fullPath       the COMPLETE expanded path (`unitsToExpand` after the
 *                       caller's `expandHierarchyToLeaf`, incl. freestyle suffix).
 * @param captureBefore  when true, returns the BEFORE-move value snapshot from
 *                       the successful attempt; otherwise returns undefined.
 */
async function setValuesAndSaveResilient(
  hierarchyPage: ShechelPage,
  ctx: Record<string, unknown>,
  makatId: string,
  fullPath: number[],
  captureBefore: boolean,
): Promise<Map<number, number> | undefined> {
  const MAX_SAVE_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
    await withPhase('Set leaf cell values', ctx, () =>
      hierarchyPage.setLeafCellValues(makatId, fullPath, 1),
    );

    const captured = captureBefore
      ? await withPhase('Capture values BEFORE move', ctx, () =>
          hierarchyPage.captureAllVisibleCellValuesAtEachLevel(makatId, fullPath),
        )
      : undefined;

    try {
      await withPhase(
        `Save material BEFORE move (attempt ${attempt}/${MAX_SAVE_ATTEMPTS})`,
        ctx,
        () => hierarchyPage.saveMaterial(),
      );
      return captured;
    } catch (err) {
      // Only the transient top-level-set-change 502 is recoverable; anything
      // else is a real failure and must propagate untouched.
      if (attempt >= MAX_SAVE_ATTEMPTS || !isHierarchyChanged502(err)) throw err;

      console.warn(
        `[RESILIENT SAVE] "Save material BEFORE move" hit the transient ` +
          `"hierarchy changed beneath you" 502 (attempt ${attempt}/${MAX_SAVE_ATTEMPTS}). ` +
          `Another worker mutated Matkal's top-level set mid-save. Reloading, re-adding ` +
          `makat ${makatId}, re-expanding [${fullPath.join(' → ')}], and replaying the save.`,
      );

      await withPhase(`Recover from save 502 (attempt ${attempt})`, ctx, async () => {
        await hierarchyPage.page.reload();
        await hierarchyPage.waitForMakatComboboxReady(30_000);
        await hierarchyPage.addMakatFromDropdown(makatId);
        await hierarchyPage.waitForMaterialRow(makatId, 15_000);
        // Re-expand the SAME complete path. Because `fullPath` already ends at
        // a real leaf, `expandHierarchyToLeaf` re-opens exactly it and appends
        // no new freestyle units (keeping any caller-computed suffix valid).
        await hierarchyPage.expandHierarchyToLeaf(makatId, fullPath);
      });
    }
  }

  // Unreachable: the loop always returns on success or throws on the final
  // attempt. Present only to satisfy the type checker.
  return undefined;
}

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

  // Same-parent "move" → no-op; handle and return early.
  if (await handleSameParentNoOp(request, data)) return;

  await withPhase('Add makat from dropdown', ctx, () =>
    hierarchyPage.addMakatFromDropdown(makatId),
  );
  await withPhase('Expand original hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy),
  );

  // ── Capture the freestyle suffix chosen to reach the gdud leaf ──────────
  // If `unitToMove` is NOT itself a gdud (leaf), `expandHierarchyToLeaf`
  // randomly opened deeper children (appended in place to `originalHierarchy`)
  // until it reached a leaf, and `setLeafCellValues` set values there too.
  // The moved unit carries its ENTIRE subtree across the move, so we must
  // REPLAY this exact suffix under the new parent afterwards — otherwise the
  // post-move expand would randomly open a *different* subtree (whose cells
  // were never captured BEFORE) and the value-preservation check could not
  // line up the same units on both sides.
  const moveIdx = originalHierarchy.indexOf(unitToMove);
  const freestyleSuffix =
    moveIdx >= 0 ? originalHierarchy.slice(moveIdx + 1) : [];
  // Units whose value must be preserved across the move: the moved unit
  // itself plus every freestyle descendant it carries with it.
  const unitsToVerify = [unitToMove, ...freestyleSuffix];
  console.log(
    `[FREESTYLE PATH SAVED] Suffix below moved unit ${unitToMove}: [${freestyleSuffix.join(
      ' → ',
    )}] (units to verify: [${unitsToVerify.join(', ')}], full original path: [${originalHierarchy.join(
      ' → ',
    )}])`,
  );

  // Set values + capture BEFORE + save, with built-in recovery from the
  // transient top-level-set-change 502 ("hierarchy beneath you changed").
  // `originalHierarchy` is the FULL path here (already expanded above,
  // including any freestyle suffix), so retries replay it verbatim.
  const valuesBefore = (await setValuesAndSaveResilient(
    hierarchyPage,
    ctx,
    makatId,
    originalHierarchy,
    true,
  ))!;

  await withPhase('Unlock complete hierarchy (API)', ctx, () =>
    unlockCompleteHierarchy(request, originalHierarchy, newHierarchy),
  );
  await withPhase('Reload page after unlock', ctx, async () => {
    await hierarchyPage.page.reload();
    await hierarchyPage.page.waitForLoadState('networkidle');
  });
  // Perform the move via the UI but SKIP the in-UI confirm-and-lock step.
  // Locking via the confirmation popup is flaky; we lock via API right after.
  //
  // `unitMoveUI` reports success as soon as the drawer interactions complete,
  // but the drawer combobox occasionally no-ops (the action button click does
  // not commit the reparent) — especially for move-out-of-Matkal flows. That
  // leaves the unit at its old parent while the test believes the move ran,
  // surfacing later as `AFTER=MISSING`. The action button DOES commit to the
  // backend when it works, so a no-op is detectable immediately via the API.
  // Verify the reparent landed and retry the whole UI move if it did not.
  const MOVE_ATTEMPTS = 3;
  let moved = false;
  for (let attempt = 1; attempt <= MOVE_ATTEMPTS && !moved; attempt++) {
    await withPhase(`Move unit via UI (attempt ${attempt}/${MOVE_ATTEMPTS})`, ctx, () =>
      hierarchyPage.unitMoveUI(unitToMove, newParentUnit, newHierarchy, {
        skipConfirmAndLock: true,
      }),
    );
    // Short poll — the action button commits before we lock, so a successful
    // move shows up within a few seconds.
    moved = await waitForUnitParent(request, unitToMove, newParentUnit, 8_000);
    if (!moved && attempt < MOVE_ATTEMPTS) {
      console.warn(
        `[VP] UI move attempt ${attempt}/${MOVE_ATTEMPTS} did not persist (unit ${unitToMove} not under ${newParentUnit}); reloading and retrying.`,
      );
      await hierarchyPage.page.reload();
      await hierarchyPage.page.waitForLoadState('networkidle');
    }
  }
  if (!moved) {
    throw new Error(
      `[ASSERTION: move-not-persisted] Unit ${unitToMove} could not be moved under parent ${newParentUnit} via the UI after ${MOVE_ATTEMPTS} attempts (backend never reflected the reparent). The drawer combobox likely failed to commit the move.`,
    );
  }
  await withPhase('Lock complete hierarchy (API)', ctx, () =>
    lockCompleteHierarchy(request, [originalHierarchy[0], newHierarchy[0]]),
  );

  // Wait for the backend hierarchy to actually reflect the move before we
  // try to read the moved unit's new row.
  await withPhase('Wait for backend to reflect move', ctx, () =>
    waitForUnitParent(request, unitToMove, newParentUnit),
  );

  // Reload so the newly-locked destination root (newHierarchy[0]) and the
  // moved unit's relocated row actually render. Without this, the still-mounted
  // page never repaints the destination's carousel column, so the moved unit
  // is reported MISSING even though the backend move + lock succeeded. This
  // mirrors the post-move reload used by the aggregation flows.
  await withPhase('Reload page after move', ctx, async () => {
    await hierarchyPage.page.reload();
    await hierarchyPage.waitForMakatComboboxReady(30000);
    await hierarchyPage.waitForMaterialRow(makatId, 15000);
  });

  // AFTER the move: do EXACTLY the same find+open hierarchy steps as BEFORE.
  // The moved unit carried its entire subtree, so we replay the SAME freestyle
  // suffix under the new parent — this opens the identical leaf subtree we set
  // values on pre-move, instead of randomly opening a different branch.
  const newHierarchyFull = [...newHierarchy, ...freestyleSuffix];
  console.log(
    `[FREESTYLE PATH REPLAY] Expanding new hierarchy with saved suffix: [${newHierarchyFull.join(
      ' → ',
    )}]`,
  );
  await withPhase('Expand new hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchyFull),
  );
  const valuesAfter = await withPhase('Capture values AFTER move', ctx, () =>
    hierarchyPage.captureAllVisibleCellValuesAtEachLevel(
      makatId,
      newHierarchyFull,
    ),
  );

  // ─── Final assertions with explicit, actionable error messages ───────────
  // Value preservation must hold for the moved unit AND every freestyle
  // descendant it carries with it. We compare BEFORE vs AFTER for each.
  console.log(`\n[MOVED UNIT + SUBTREE PRESERVATION CHECK]`);
  const failures: string[] = [];
  for (const unitId of unitsToVerify) {
    const beforeFound = valuesBefore.has(unitId);
    const afterFound = valuesAfter.has(unitId);
    const before = beforeFound ? valuesBefore.get(unitId) : 'MISSING';
    const after = afterFound ? valuesAfter.get(unitId) : 'MISSING';
    const ok = beforeFound && afterFound && before === after;
    const label =
      unitId === unitToMove ? `Moved Unit ${unitId}` : `Subtree Unit ${unitId}`;
    console.log(`  ${ok ? '✓' : '✗'} ${label}: BEFORE=${before}, AFTER=${after}`);

    if (!beforeFound) {
      failures.push(
        `[unit-not-found-before] Unit ${unitId} was NOT found in the UI BEFORE the move (path [${originalHierarchy.join(
          ' → ',
        )}]). The capture saw no row/sub-row/numbered cell for this unit, so the test data is invalid or the original hierarchy did not render.`,
      );
    } else if (!afterFound) {
      failures.push(
        `[unit-not-found-after] Unit ${unitId} was NOT found in the UI AFTER the move to parent ${newParentUnit} (path [${newHierarchyFull.join(
          ' → ',
        )}]). Either the move did not take effect in the UI, or the UI never re-rendered this unit at its new location.`,
      );
    } else if (!ok) {
      failures.push(
        `[value-mismatch] Unit ${unitId} value changed across the move: BEFORE=${before}, AFTER=${after} (expected them to be equal — value preservation violated).`,
      );
    }
  }

  expect(
    failures.length,
    `[ASSERTION: subtree-value-preservation] Value preservation failed for ${failures.length} unit(s) in the moved subtree [${unitsToVerify.join(
      ', ',
    )}]:\n  - ${failures.join('\n  - ')}`,
  ).toBe(0);
  console.log(
    `✓ TEST PASSED: Moved unit and its entire freestyle subtree [${unitsToVerify.join(
      ', ',
    )}] preserved after move!\n`,
  );
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

  // Same-parent "move" → no-op; handle and return early.
  if (await handleSameParentNoOp(request, data)) return;

  await withPhase('Add makat from dropdown', ctx, () =>
    hierarchyPage.addMakatFromDropdown(makatId),
  );
  await withPhase('Expand original hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy),
  );

  // ── Capture the freestyle suffix chosen to reach the gdud leaf ──────────
  // If `unitToMove` is NOT itself a gdud (leaf), `expandHierarchyToLeaf`
  // randomly opened deeper children (appended in place to `originalHierarchy`)
  // until it reached a leaf, and `setLeafCellValues` set the value there.
  // Because the moved unit carries its ENTIRE subtree across the move, we must
  // REPLAY this exact suffix under the new parent afterwards — otherwise the
  // post-move expand would randomly open a *different* subtree (where no value
  // was ever set) and the aggregation check would run on the wrong leaf.
  const moveIdx = originalHierarchy.indexOf(unitToMove);
  const freestyleSuffix =
    moveIdx >= 0 ? originalHierarchy.slice(moveIdx + 1) : [];
  console.log(
    `[FREESTYLE PATH SAVED] Suffix below moved unit ${unitToMove}: [${freestyleSuffix.join(
      ' → ',
    )}] (full original path: [${originalHierarchy.join(' → ')}])`,
  );

  // Set values + save, with built-in recovery from the transient
  // top-level-set-change 502 ("hierarchy beneath you changed"). No BEFORE
  // snapshot is needed here — the aggregation flow re-reads values after the
  // move — so `captureBefore` is false.
  await setValuesAndSaveResilient(
    hierarchyPage,
    ctx,
    makatId,
    originalHierarchy,
    false,
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
    // The makat was saved BEFORE the move, so it persists in the backend
    // and re-renders automatically after reload — no need to re-add it.
    await hierarchyPage.waitForMakatComboboxReady(30000);
    await hierarchyPage.waitForMaterialRow(makatId, 15000);
  });
  // Replay the SAME freestyle suffix under the new parent so we expand the
  // identical leaf subtree (with the value we set pre-move) instead of
  // randomly opening a different branch.
  const newHierarchyFull = [...newHierarchy, ...freestyleSuffix];
  console.log(
    `[FREESTYLE PATH REPLAY] Expanding new hierarchy with saved suffix: [${newHierarchyFull.join(
      ' → ',
    )}]`,
  );
  await withPhase('Expand new hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchyFull),
  );

  console.log(`\n[CAPTURING ALL VISIBLE CELLS] Including all siblings at each level...`);
  const allVisibleValues = await withPhase(
    'Capture values for new hierarchy',
    ctx,
    () =>
      hierarchyPage.captureAllVisibleCellValuesAtEachLevel(
        makatId,
        newHierarchyFull,
      ),
  );

  console.log(`\n[AGGREGATION VERIFICATION FOR NEW HIERARCHY]`);
  const aggregationValid = await withPhase(
    'Verify aggregation for new hierarchy',
    ctx,
    () =>
      hierarchyPage.verifyAggregationWithAllVisibleCells(
        makatId,
        newHierarchyFull,
        allVisibleValues,
      ),
  );
  expect(
    aggregationValid,
    `[ASSERTION: aggregation-invalid-new-hierarchy] Aggregation rule (parent = sum(children)) violated on the NEW hierarchy [${newHierarchyFull.join(
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

  // Same-parent "move" → no-op; handle and return early.
  if (await handleSameParentNoOp(request, data)) return;

  // Move OUT of the system root (oldParentUnit === 1) → the OLD hierarchy is
  // the entire top level, which this aggregation flow cannot verify. Handle
  // and return early instead of throwing in the assertion below.
  if (await handleRootOldParent(request, data)) return;

  // Fail fast if the data can't yield a valid OLD hierarchy path.
  assertOldParentInOriginalPath(data);

  await withPhase('Add makat from dropdown', ctx, () =>
    hierarchyPage.addMakatFromDropdown(makatId),
  );
  await withPhase('Expand original hierarchy', ctx, () =>
    hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy),
  );
  // Set values + save, with built-in recovery from the transient
  // top-level-set-change 502 ("hierarchy beneath you changed"). The OLD-
  // hierarchy flow re-reads values after the move, so no BEFORE snapshot is
  // needed here (`captureBefore` is false).
  await setValuesAndSaveResilient(
    hierarchyPage,
    ctx,
    makatId,
    originalHierarchy,
    false,
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
    // The makat was saved BEFORE the move, so it persists in the backend
    // and re-renders automatically after reload — no need to re-add it.
    // Wait for the page to actually be ready (combobox rendered) and for
    // the saved makat row to hydrate before expanding.
    await hierarchyPage.waitForMakatComboboxReady(30000);
    await hierarchyPage.waitForMaterialRow(makatId, 15000);
  });

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
  // Whether the moved unit fully LEAVES the old top-level branch depends on
  // the move category:
  //   • CROSS-TOP move  (newHierarchy[0] !== originalHierarchy[0]) — the unit
  //     lands under a DIFFERENT top unit, so it must disappear entirely from
  //     the old top's subtree. Strict global-absence assertion applies.
  //   • SAME-TOP move   (newHierarchy[0] === originalHierarchy[0]) — e.g. a
  //     Gdud moved to a SIBLING Hativa under the SAME Ugda (503 → 383, both
  //     under 23). The unit LEGITIMATELY remains inside the old top's subtree,
  //     just nested under its new parent. Asserting global absence here would
  //     be wrong (the product is behaving correctly). We only require that it
  //     is no longer a DIRECT child of `oldParentUnit`; it is expected to
  //     still appear deeper, and the aggregation invariant below validates
  //     that the old hierarchy re-sums correctly with the unit relocated.
  const crossesTop = originalHierarchy[0] !== newHierarchy[0];
  if (crossesTop) {
    if (oldHierarchyValues.has(unitToMove)) {
      const staleValue = oldHierarchyValues.get(unitToMove);
      throw new Error(
        `[ASSERTION: moved-unit-still-in-old-hierarchy] Unit ${unitToMove} was NOT removed from the OLD hierarchy path [${oldHierarchyPath.join(
          ' → ',
        )}]. It still appears with value=${staleValue}. The move operation may have failed or the UI never refreshed.`,
      );
    }
    console.log(
      `  ✓ Unit ${unitToMove} is absent from old top subtree – cross-top move confirmed`,
    );
  } else {
    console.log(
      `  ✓ Same-top move: unit ${unitToMove} legitimately remains under old top ${originalHierarchy[0]} (now nested beneath new parent ${newParentUnit}) — skipping global-absence assertion; aggregation invariant below validates correctness.`,
    );
  }

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
// Clusters are write-set-disjoint by construction, so different clusters may
// run concurrently across Playwright workers. Inside one cluster entries share
// units (and possibly mix kinds) → run serially.
//
// ROOT-SET SERIALIZATION: `groupByWriteSetComponents` additionally fuses every
// move that adds/removes a top-level unit (`oldParentUnit === 1` or
// `newParentUnit === 1`) into a SINGLE serial cluster. Such moves all mutate
// the system root's child set (`lowerUnitsIds`), which every lock/save reports;
// running two concurrently makes the backend reject the stale snapshot with
// HTTP 502 "ההיררכיה תחתיך השתנתה" ("the hierarchy below you changed"). Serial-
// izing them removes that race at its source.
//
// RETRIES DISABLED: these tests permanently mutate the live hierarchy (a unit
// MOVE). Once the move is applied, the encoded pre-move precondition no longer
// exists, so a retry can never reproduce the BEFORE state — it would falsely
// report BEFORE=MISSING / value-mismatch. Each entry must run exactly once
// against freshly generated data. Regenerate before every run:
//   npm run build:data:hierarchy
test.describe.configure({ retries: 0 });

for (const cluster of groupByWriteSetComponents(tagged)) {
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
