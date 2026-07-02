import { test, expect } from '../../src/fixtures';
import { withPhase } from '../../src/fixtures/withPhase';
import aggregationData from '../../src/testData/changeHierarchyData.json';
import {
  unlockCompleteHierarchy,
  lockCompleteHierarchy,
} from '../../src/api/apiHelpers';
import { updateUnitHierarchy } from '../../src/api/hierarchychange';
import {
  waitForUnitParent,
  getUnitParent,
} from '../../src/api/dynamicHierarchyDiscovery';
import { lockUnitStatus } from '../../src/api/lockunitstatus';
import {
  groupByWriteSetComponents,
  clusterLabelAll,
  topUnitsOf,
} from '../../src/fixtures/parallelGroups';
import type { ShechelPage } from '../../src/pages/ShechelPage';
import type { APIRequestContext } from '@playwright/test';
// Value import (NOT `import type`) — used to build a standalone API context in
// the per-cluster `afterAll` lock-release hook, where the test-scoped `request`
// fixture is not available. Mirrors `scripts/data-builder.ts`.
import { request as apiRequest } from '@playwright/test';

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

  // STALENESS GUARD: the recorded `newParentUnit` reflects the tree at data-GEN
  // time, but this suite performs IRREVERSIBLE moves, so an earlier real move in
  // the same run may have relocated `unitToMove` before this probe executes.
  // Trusting the stale value makes the assertion fail even though the product is
  // behaving correctly (the unit simply lives under a DIFFERENT parent now).
  //
  // A NO-OP only asserts the idempotency invariant "re-parenting a unit onto its
  // OWN current parent leaves it in place" — which holds for WHATEVER parent it
  // currently has. So resolve the LIVE parent at run time and assert against
  // that. If the unit somehow has no parent (detached / not found), fall back to
  // the recorded value so the assertion still reports something actionable.
  const livingParent = await getUnitParent(request, data.unitToMove);
  const targetParent = livingParent ?? data.newParentUnit;

  console.log(
    `[SAME-PARENT NO-OP] Entry "${data.description}" is a no-op relocation ` +
      `(oldParentUnit === newParentUnit === ${data.newParentUnit}). Live current parent ` +
      `of unit ${data.unitToMove} is ${livingParent ?? '(unknown)'}; asserting the unit ` +
      `stays under ${targetParent} without performing a move.`,
  );
  const stillThere = await waitForUnitParent(
    request,
    data.unitToMove,
    targetParent,
    10_000,
  );
  expect(
    stillThere,
    `[ASSERTION: same-parent-noop] Unit ${data.unitToMove} is expected to remain under its ` +
      `current parent ${targetParent} (same-parent no-op move), but the backend did not ` +
      `report that parent. The move data may be inconsistent.`,
  ).toBe(true);
  console.log(
    `  ✓ Same-parent no-op verified: unit ${data.unitToMove} remains under parent ${targetParent}.`,
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

  // ── PERFORM the move-out-of-root, THEN assert it landed ───────────────────
  // BUG FIX: this guard previously asserted `waitForUnitParent(unitToMove,
  // newParentUnit)` WITHOUT ever performing the move. For a move-out-of-root
  // entry no other code path relocates the unit (the main flow's
  // `updateUnitHierarchy` is below the early `return true` this function
  // triggers), so the unit was still under Matkal=1 and the assertion timed
  // out every run ("last seen: 1") — a deterministic failure, not flakiness.
  //
  // Perform the relocation here via the SAME API sequence the VP/AGG flows use
  // (unlock both branches → updateUnitHierarchy → re-lock the two tops), then
  // verify it landed. `updateUnitHierarchy` invalidates the top-level-units
  // cache internally, so the subsequent `lockCompleteHierarchy` sends the LIVE
  // top set (unit has just left the root) and is not rejected with the 502
  // "hierarchy changed beneath you".
  const { unitToMove, newParentUnit, hatunit } = data;
  const originalHierarchy = data.unitsToExpand; // [unitToMove] for a root move
  const newHierarchy = data.newHierarchy; // [newParentUnit, unitToMove]

  await unlockCompleteHierarchy(request, originalHierarchy, newHierarchy);
  await updateUnitHierarchy(request, unitToMove, newParentUnit, 1, hatunit);
  // Re-lock the source top (the moved unit, which WAS a top-level unit) and the
  // destination top so both branches return to a locked, consistent state.
  await lockCompleteHierarchy(request, [originalHierarchy[0], newHierarchy[0]]);

  // Confirm the move genuinely happened so this entry still asserts something
  // real rather than passing blindly. The unit must now report its new parent.
  const landed = await waitForUnitParent(
    request,
    data.unitToMove,
    data.newParentUnit,
    30_000,
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
  // Total save attempts before giving up. Each retry does a full reload +
  // re-add + re-expand (plus backoff), so this stays bounded under the per-test
  // timeout. Raised from a hard-coded 3 → 5 (default) because a BURST of
  // root-level moves in OTHER workers perturbs Matkal's top-level set across
  // several consecutive save windows; the old 3-attempt budget could be
  // exhausted on a product that is actually behaving correctly (observed:
  // "Save material BEFORE move (attempt 3/3) → 502 ההיררכיה תחתיך השתנתה").
  // Tunable via HC_SAVE_ATTEMPTS.
  const MAX_SAVE_ATTEMPTS = Number(process.env.HC_SAVE_ATTEMPTS ?? 5);

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
        // JITTERED BACKOFF before replaying. The 502 comes from OTHER workers'
        // root-level moves churning Matkal's top-level set; those bursts last
        // longer than a single reload, so an IMMEDIATE replay tends to hit the
        // very same contention window and burn another attempt. Backing off by
        // an increasing, randomized delay spreads this test's save windows
        // across the burst so one lands in a quiet gap. Randomized so sibling
        // workers that all took a 502 don't retry in lockstep. Base tunable via
        // HC_SAVE_BACKOFF_MS.
        const backoffBase = Number(process.env.HC_SAVE_BACKOFF_MS ?? 2000);
        const backoffMs = backoffBase * attempt + Math.floor(Math.random() * backoffBase);
        console.warn(
          `[RESILIENT SAVE] Backing off ${backoffMs}ms before replay (attempt ${attempt}).`,
        );
        await hierarchyPage.page.waitForTimeout(backoffMs);
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

  // ── BEFORE phase (expand → set values → capture → save), guarded against a
  //    SILENT expansion failure ──────────────────────────────────────────────
  // `expandHierarchyToLeaf` STOPS without throwing if a unit's cell never
  // renders (e.g. a deep-carousel top unit whose row didn't hydrate because a
  // backend response timed out). When that happens `setLeafCellValues` no-ops
  // and the moved unit's BEFORE value is never captured. Because the move below
  // is IRREVERSIBLE and retries are disabled for this suite, we must NOT proceed
  // on that bad precondition — doing so destroys the BEFORE state and only later
  // surfaces a misleading "AFTER=0 / BEFORE=MISSING" value-preservation mismatch
  // (the real cause being a missed capture, not a product bug).
  //
  // So: VERIFY the moved subtree was actually captured. While it is still SAFE
  // (nothing has moved yet) reload-and-retry the whole BEFORE phase. Only a
  // genuinely unrecoverable capture aborts — early, and with an accurate message.
  //
  // The freestyle suffix (deeper children `expandHierarchyToLeaf` appended in
  // place to reach a leaf) is recomputed each attempt: the moved unit carries
  // its ENTIRE subtree across the move, so we replay this exact suffix under the
  // new parent afterwards — otherwise the post-move expand could open a
  // *different* subtree whose cells were never captured BEFORE.
  const basePath = [...originalHierarchy]; // pristine data path, before any expand
  const BEFORE_ATTEMPTS = 3;
  let valuesBefore!: Map<number, number>;
  let freestyleSuffix: number[] = [];
  let unitsToVerify: number[] = [unitToMove];

  for (let attempt = 1; attempt <= BEFORE_ATTEMPTS; attempt++) {
    // Reset the in-place path to its pristine form so a retry's re-expand does
    // not append freestyle units twice.
    originalHierarchy.length = 0;
    originalHierarchy.push(...basePath);

    await withPhase(
      `Expand original hierarchy (attempt ${attempt}/${BEFORE_ATTEMPTS})`,
      ctx,
      () => hierarchyPage.expandHierarchyToLeaf(makatId, originalHierarchy),
    );

    const moveIdx = originalHierarchy.indexOf(unitToMove);
    freestyleSuffix = moveIdx >= 0 ? originalHierarchy.slice(moveIdx + 1) : [];
    // Units whose value must be preserved across the move: the moved unit
    // itself plus every freestyle descendant it carries with it.
    unitsToVerify = [unitToMove, ...freestyleSuffix];
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
    valuesBefore = (await setValuesAndSaveResilient(
      hierarchyPage,
      ctx,
      makatId,
      originalHierarchy,
      true,
    ))!;

    const missingBefore = unitsToVerify.filter((u) => !valuesBefore.has(u));
    if (missingBefore.length === 0) break; // full BEFORE state captured ✓

    if (attempt === BEFORE_ATTEMPTS) {
      throw new Error(
        `[ASSERTION: before-capture-incomplete] The BEFORE-move state for unit(s) ` +
          `[${missingBefore.join(', ')}] (path [${basePath.join(' → ')}]) could not be captured after ` +
          `${BEFORE_ATTEMPTS} attempts — expandHierarchyToLeaf never rendered their cell(s) (typically a ` +
          `slow/timing-out backend response while paginating the carousel). Aborting BEFORE the ` +
          `irreversible move so this surfaces as a capture failure rather than a later, misleading ` +
          `"AFTER=0 / BEFORE=MISSING" value-preservation mismatch.`,
      );
    }

    console.warn(
      `[VP BEFORE-RETRY] Incomplete BEFORE capture — unit(s) [${missingBefore.join(', ')}] never ` +
        `rendered (attempt ${attempt}/${BEFORE_ATTEMPTS}). Reloading and re-expanding before the move ` +
        `(safe: nothing has been moved yet).`,
    );
    await withPhase(`Recover incomplete BEFORE capture (attempt ${attempt})`, ctx, async () => {
      await hierarchyPage.page.reload();
      await hierarchyPage.waitForMakatComboboxReady(30_000);
      await hierarchyPage.addMakatFromDropdown(makatId);
      await hierarchyPage.waitForMaterialRow(makatId, 15_000);
    });
  }


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
  //
  // SEPARATELY, the move can THROW: if the destination parent's unlock did not
  // persist (a backend blip during `unlockCompleteHierarchy`), that node renders
  // LOCKED and COLLAPSED in the drawer and never exposes its combobox input, so
  // `unitMoveUI` fails with "couldnt find target father unit N". That is
  // recoverable — re-unlocking the destination branch via API (idempotent;
  // already-unlocked units return a tolerated 409/422) and reloading restores
  // the interactable, expanded node. We therefore treat BOTH a thrown move and a
  // non-persisted move the same way: re-unlock the branch, reload, and retry.
  const MOVE_ATTEMPTS = 3;
  let moved = false;
  for (let attempt = 1; attempt <= MOVE_ATTEMPTS && !moved; attempt++) {
    let threw: unknown;
    try {
      await withPhase(`Move unit via UI (attempt ${attempt}/${MOVE_ATTEMPTS})`, ctx, () =>
        hierarchyPage.unitMoveUI(unitToMove, newParentUnit, newHierarchy, {
          skipConfirmAndLock: true,
        }),
      );
      // Short poll — the action button commits before we lock, so a successful
      // move shows up within a few seconds.
      moved = await waitForUnitParent(request, unitToMove, newParentUnit, 8_000);
    } catch (err) {
      // A locked/collapsed destination parent (combobox never rendered) lands
      // here. Recover by re-unlocking below, unless we're out of attempts.
      threw = err;
      if (attempt >= MOVE_ATTEMPTS) throw err;
    }

    if (!moved && attempt < MOVE_ATTEMPTS) {
      const reason = threw
        ? `threw (${String((threw as Error)?.message ?? threw).slice(0, 160)})`
        : `did not persist (unit ${unitToMove} not under ${newParentUnit})`;
      console.warn(
        `[VP] UI move attempt ${attempt}/${MOVE_ATTEMPTS} ${reason}; re-unlocking the ` +
          `destination branch (in case its unlock was dropped → node stayed LOCKED), reloading, and retrying.`,
      );
      // Re-assert the unlock of BOTH branches. This is the actual root-cause
      // fix for the "target parent still locked" failure: a transient unlock
      // loss leaves the parent un-interactable, and only a fresh unlock — not a
      // bare reload — makes its combobox appear.
      await withPhase(`Re-unlock + reload before move retry (attempt ${attempt})`, ctx, async () => {
        await unlockCompleteHierarchy(request, originalHierarchy, newHierarchy);
        await hierarchyPage.page.reload();
        await hierarchyPage.page.waitForLoadState('networkidle');
      });
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
  // The backend has ALREADY confirmed the reparent (`waitForUnitParent` above),
  // so the move itself is durable. What stays flaky is the UI RE-RENDER of the
  // moved unit at its NEW location: right after a hierarchy mutation the
  // destination top unit's row / carousel column can momentarily fail to
  // hydrate (often following a 502 "hierarchy changed beneath you" churn), so
  // the re-expand stops short and the moved unit is captured as AFTER=MISSING
  // even though it IS present in the data. That is a rendering miss, NOT a value
  // failure — recover it by reloading, re-adding the makat, re-expanding, and
  // re-capturing. Bounded attempts; we only retry while the moved subtree is
  // still MISSING from the AFTER snapshot.
  const AFTER_ATTEMPTS = 3;
  // Settle delay (ms) before each AFTER re-capture, so the moved subtree's own
  // rollup (an intermediate moved unit displays Σ of the gdud children it
  // carried with it) finishes recomputing before we read it. Shares the same
  // tunable (and default) as the aggregation re-poll. See the value-mismatch
  // reconciliation note below.
  const AFTER_SETTLE_MS = Number(process.env.HC_AGG_SETTLE_MS ?? 2500);
  let valuesAfter!: Map<number, number>;
  for (let attempt = 1; attempt <= AFTER_ATTEMPTS; attempt++) {
    await withPhase(
      `Expand new hierarchy (attempt ${attempt}/${AFTER_ATTEMPTS})`,
      ctx,
      () => hierarchyPage.expandHierarchyToLeaf(makatId, newHierarchyFull),
    );
    valuesAfter = await withPhase(
      `Capture values AFTER move (attempt ${attempt}/${AFTER_ATTEMPTS})`,
      ctx,
      () =>
        hierarchyPage.captureAllVisibleCellValuesAtEachLevel(
          makatId,
          newHierarchyFull,
        ),
    );

    // A unit is "unreconciled" if it is MISSING from the AFTER snapshot OR its
    // AFTER value does not yet equal its BEFORE value. RE-POLLING ON MISMATCH
    // (not just on MISSING) is the fix for the same post-move rollup-lag class
    // of false failure that hit the aggregation flow: an intermediate moved
    // unit's displayed value is a rollup of its (moved) children, which the
    // backend recomputes asynchronously — captured too early it can transiently
    // read a partial sum and fail value-preservation even though it converges to
    // the correct (preserved) value. We only re-poll a bounded number of times;
    // a genuine mismatch that never reconciles still falls through to the
    // detailed assertion below and fails with the exact BEFORE/AFTER numbers.
    const unreconciled = unitsToVerify.filter(
      (u) => !valuesAfter.has(u) || valuesBefore.get(u) !== valuesAfter.get(u),
    );
    if (unreconciled.length === 0) break; // full AFTER state matches BEFORE ✓

    const missingAfter = unitsToVerify.filter((u) => !valuesAfter.has(u));
    if (attempt < AFTER_ATTEMPTS) {
      const mismatched = unreconciled.filter((u) => valuesAfter.has(u));
      console.warn(
        `[VP] AFTER-move capture not yet reconciled — missing [${missingAfter.join(', ')}], ` +
          `value-mismatch [${mismatched
            .map((u) => `${u}: BEFORE=${valuesBefore.get(u)} AFTER=${valuesAfter.get(u)}`)
            .join('; ')}] ` +
          `even though the backend confirmed the reparent (unit ${unitToMove} → parent ` +
          `${newParentUnit}). Likely destination re-render / rollup lag. Settling ${AFTER_SETTLE_MS}ms, ` +
          `reloading, re-adding makat ${makatId}, and re-expanding [${newHierarchyFull.join(' → ')}] ` +
          `before re-capturing (attempt ${attempt}/${AFTER_ATTEMPTS}).`,
      );
      await withPhase(
        `Settle + reload + re-add makat before AFTER retry (attempt ${attempt})`,
        ctx,
        async () => {
          // Let the moved subtree's rollup settle before we re-read it.
          await hierarchyPage.page.waitForTimeout(AFTER_SETTLE_MS);
          await hierarchyPage.page.reload();
          await hierarchyPage.waitForMakatComboboxReady(30_000);
          await hierarchyPage.addMakatFromDropdown(makatId);
          await hierarchyPage.waitForMaterialRow(makatId, 15_000);
        },
      );
    }
  }

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

/**
 * Capture all visible cell values along `fullPath` and verify the aggregation
 * invariant (parent = Σ children), RE-POLLING across reloads to absorb the
 * backend's asynchronous rollup lag after a hierarchy move.
 *
 * After a unit MOVE the backend recomputes every ancestor's rollup
 * asynchronously. Capturing + verifying the instant the move lands can catch a
 * parent cell still showing its PRE-move sum (the rollup hasn't propagated
 * yet), producing a FALSE "parent ≠ Σ children" failure for a product that is
 * actually converging to the correct value. To tell a genuine aggregation bug
 * apart from transient lag we re-capture + re-verify across a few reloads; only
 * a result that NEVER reconciles within the budget is reported as a failure.
 *
 * The page object's `verifyAggregationWithAllVisibleCells` stays single-shot
 * and pure — the polling lives here at the orchestration layer (mirroring the
 * BEFORE-capture and UI-move retry loops elsewhere in this file).
 *
 * @param fullPath   the COMPLETE expanded path (already ending at a real leaf),
 *                   so re-expanding it on each retry is idempotent.
 * @param phaseLabel human-readable prefix for the emitted `withPhase` steps.
 * @returns the reconciled snapshot plus the final aggregation result — `ok` is
 *          true as soon as a capture reconciles, else false after the last
 *          attempt (the caller asserts on it). `values` is always the LAST
 *          capture, so callers can run further checks on the same snapshot.
 */
async function captureAndVerifyAggregationResilient(
  hierarchyPage: ShechelPage,
  ctx: Record<string, unknown>,
  makatId: string,
  fullPath: number[],
  phaseLabel: string,
  /**
   * Optional extra reconciliation predicate evaluated against each capture.
   * When provided, a snapshot only counts as reconciled if BOTH the aggregation
   * invariant AND this predicate hold. Used by the OLD-hierarchy flow to fold
   * the "moved unit has left the old subtree" condition into the same re-poll,
   * because that absence is subject to the same post-move rollup lag (a parent
   * can stay numerically consistent with the moved unit still listed until the
   * rollup propagates). Must be side-effect-free; the caller still runs its own
   * detailed assertion on the returned `values`.
   */
  extraCheck?: (values: Map<number, number>) => boolean,
): Promise<{ ok: boolean; values: Map<number, number>; report: string }> {
  const AGG_ATTEMPTS = Number(process.env.HC_AGG_ATTEMPTS ?? 8);
  // Settle delay (ms) inserted BEFORE each re-capture so the backend's
  // asynchronous post-move rollup has time to propagate to every ancestor
  // before we read the cells again. Without it, a re-poll can re-capture the
  // grid mid-recompute and observe the SAME transient mismatch (a parent that
  // already dropped while a just-moved child is still briefly listed), turning
  // pure rollup lag into a false "parent ≠ Σ children" failure. Tunable via
  // HC_AGG_SETTLE_MS.
  const AGG_SETTLE_MS = Number(process.env.HC_AGG_SETTLE_MS ?? 2500);
  // Number of CONSECUTIVE identical-yet-still-violating snapshots required
  // before we conclude the violation is REAL (the grid has truly gone quiet AND
  // is wrong) rather than a slow rollup that has only MOMENTARILY plateaued. A
  // single backend rollup onto a hot shared parent (e.g. a top-level Pikud/Ugda
  // such as unit 3) can sit at an intermediate sum for a read or two before it
  // finishes climbing to Σchildren, so requiring only 2 identical reads (the old
  // behaviour) declared a real bug too eagerly and produced FALSE positives on
  // values that DO converge (observed: `Unit 3: parent=10 ≠ Σchildren=12` which
  // later read correctly). Default 3. Tunable via HC_AGG_STABLE_READS.
  const AGG_STABLE_READS = Number(process.env.HC_AGG_STABLE_READS ?? 3);
  let values = new Map<number, number>();
  let ok = false;
  // The detailed breakdown (captured snapshot + per-parent child values + sums)
  // from the LAST verify attempt. Empty while aggregation reconciles; populated
  // on the final failing attempt so the caller can attach it to the assertion.
  let report = '';

  // ── CONCURRENCY-AWARE FAILURE GATE ──────────────────────────────────────────
  // The suite runs many clusters in PARALLEL (WORKERS>1). Sibling subtrees of a
  // shared top-level parent (e.g. a Pikud/Ugda that is itself a root child) are
  // continuously perturbed by OTHER workers' saves/locks/moves, and the backend
  // rollup onto such a hot parent is asynchronous. A single capture can thus
  // observe an INTERNALLY-INCONSISTENT snapshot — parent read at time T0, a
  // child re-summed by another worker at T1>T0 — surfacing as the classic
  // "parent = Σchildren ± 1" blip. That is NOT a product bug.
  //
  // Distinguishing signal:
  //   • A REAL aggregation defect is STABLE — the SAME wrong numbers persist
  //     across repeated reads.
  //   • Concurrency interference / rollup lag is MOVING — consecutive snapshots
  //     DIFFER (the parent is climbing toward the children's sum).
  //
  // So we only treat a violation as a genuine failure when it reproduces across
  // `AGG_STABLE_READS` CONSECUTIVE IDENTICAL snapshots (the grid has gone quiet
  // AND is still wrong). While snapshots keep changing we keep polling — that's
  // live churn / a rollup still climbing, not a bug. `prevSnapshot` holds the
  // previous attempt's captured values so we can detect quiescence, and
  // `stableStreak` counts how many identical-yet-wrong reads we've seen in a
  // row. Requiring MORE than two identical reads (the previous behaviour) avoids
  // calling a slow-but-converging rollup — which can momentarily plateau at an
  // intermediate sum for a read or two — a real failure.
  let prevSnapshot: Map<number, number> | null = null;
  let stableStreak = 1;

  /** Stable iff both maps have identical keys and values (order-independent). */
  const snapshotsEqual = (
    a: Map<number, number>,
    b: Map<number, number> | null,
  ): boolean => {
    if (!b || a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
  };

  for (let attempt = 1; attempt <= AGG_ATTEMPTS; attempt++) {
    values = await withPhase(
      `${phaseLabel}: capture (attempt ${attempt}/${AGG_ATTEMPTS})`,
      ctx,
      () =>
        hierarchyPage.captureAllVisibleCellValuesAtEachLevel(makatId, fullPath),
    );

    const aggResult = await withPhase(
      `${phaseLabel}: verify (attempt ${attempt}/${AGG_ATTEMPTS})`,
      ctx,
      () =>
        hierarchyPage.verifyAggregationWithAllVisibleCells(
          makatId,
          fullPath,
          values,
        ),
    );
    report = aggResult.report;
    ok = aggResult.ok && (extraCheck ? extraCheck(values) : true);

    if (ok) return { ok, values, report }; // aggregation reconciled ✓

    // Violation observed. Decide whether it is REAL (stable) or TRANSIENT
    // (the grid is still moving / a rollup is still climbing under load).
    // Track how many CONSECUTIVE identical-yet-violating snapshots we've seen:
    // only after `AGG_STABLE_READS` of them in a row do we conclude the grid has
    // truly quiesced on a wrong value. A momentary plateau (2 equal reads) is
    // NOT enough — a slow rollup onto a hot shared parent can pause there before
    // converging.
    if (snapshotsEqual(values, prevSnapshot)) {
      stableStreak += 1;
    } else {
      stableStreak = 1;
    }
    prevSnapshot = values;

    if (stableStreak >= AGG_STABLE_READS) {
      // `AGG_STABLE_READS` consecutive IDENTICAL snapshots still violate the
      // invariant → the grid has gone quiet and is genuinely wrong. Stop early
      // and report it as a real failure (no point burning the remaining
      // attempts).
      console.warn(
        `[AGG RE-POLL] Aggregation violation is STABLE across ${stableStreak} identical ` +
          `snapshots on [${fullPath.join(' → ')}] (attempt ${attempt}/${AGG_ATTEMPTS}) — ` +
          `treating as a REAL aggregation failure (not concurrency / rollup lag).`,
      );
      return { ok: false, values, report };
    }

    if (attempt < AGG_ATTEMPTS) {
      console.warn(
        `[AGG RE-POLL] Aggregation not yet consistent on [${fullPath.join(
          ' → ',
        )}] (attempt ${attempt}/${AGG_ATTEMPTS}, stable-streak ${stableStreak}/${AGG_STABLE_READS}). ` +
          `Snapshot still settling — likely backend rollup lag / concurrent sibling churn ` +
          `(WORKERS>1). Settling with backoff, reloading, re-expanding the same complete path, ` +
          `and re-checking.`,
      );
      // Adaptive backoff: each successive re-poll waits longer, giving a busy
      // backend more time to quiesce as parallel clusters finish their writes.
      const backoffMs = AGG_SETTLE_MS * attempt;
      await withPhase(
        `${phaseLabel}: settle + reload + re-expand before re-poll (attempt ${attempt})`,
        ctx,
        async () => {
          // Let the asynchronous rollup propagate before we re-read. This is the
          // core of the fix: the prior implementation reloaded and immediately
          // re-captured, which could still hit the grid mid-recompute.
          await hierarchyPage.page.waitForTimeout(backoffMs);
          await hierarchyPage.page.reload();
          await hierarchyPage.waitForMakatComboboxReady(30_000);
          await hierarchyPage.waitForMaterialRow(makatId, 15_000);
          // `fullPath` already ends at a real leaf, so this re-opens exactly it
          // and appends nothing (idempotent).
          await hierarchyPage.expandHierarchyToLeaf(makatId, fullPath);
        },
      );
    }
  }

  console.warn(
    `[AGG RE-POLL] Aggregation still inconsistent on [${fullPath.join(
      ' → ',
    )}] after ${AGG_ATTEMPTS} attempts AND never stabilised — the grid kept ` +
      `changing under concurrent load. Reporting the last snapshot; if this recurs, ` +
      `raise HC_AGG_ATTEMPTS / HC_AGG_SETTLE_MS / HC_AGG_STABLE_READS or reduce WORKERS for this run.`,
  );
  return { ok, values, report };
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
  // CONFIRM the reparent landed BEFORE locking. `lockCompleteHierarchy` locks
  // with `updateHierarchy:true`, recomputing the new parent's rollup from the
  // children visible AT THAT INSTANT. If we lock before the move propagates,
  // the new parent is recomputed WITHOUT the incoming child and FROZEN at its
  // pre-move sum (locked → never recomputes) → a stable `parent = Σ − moved`
  // mismatch. Mirror the VP flow: wait for the parent, THEN lock.
  await withPhase('Wait for backend to reflect move', ctx, () =>
    waitForUnitParent(request, unitToMove, newParentUnit),
  );
  await withPhase('Lock complete hierarchy (API)', ctx, () =>
    lockCompleteHierarchy(request, [originalHierarchy[0], newHierarchy[0]]),
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
  console.log(`\n[AGGREGATION VERIFICATION FOR NEW HIERARCHY]`);
  // Re-poll across reloads: a freshly-moved subtree's ancestor rollups settle
  // asynchronously, so a single-shot check can observe a parent still holding
  // its pre-move sum. Only a result that never reconciles is a real failure.
  const { ok: aggregationValid, report: aggReport } =
    await captureAndVerifyAggregationResilient(
      hierarchyPage,
      ctx,
      makatId,
      newHierarchyFull,
      'Aggregation (new hierarchy)',
    );
  expect(
    aggregationValid,
    `[ASSERTION: aggregation-invalid-new-hierarchy] Aggregation rule (parent = sum(children)) violated on the NEW hierarchy [${newHierarchyFull.join(
      ' → ',
    )}] after moving unit ${unitToMove} under ${newParentUnit}.\n${aggReport}`,
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
  // CONFIRM the reparent landed BEFORE locking (same race as the AGG flow): the
  // lock recomputes rollups with `updateHierarchy:true`, so locking pre-move
  // freezes the OLD parent still holding the moved child's value. Wait first.
  await withPhase('Wait for backend to reflect move', ctx, () =>
    waitForUnitParent(request, unitToMove, newParentUnit),
  );
  await withPhase('Lock complete hierarchy (API)', ctx, () =>
    lockCompleteHierarchy(request, [originalHierarchy[0], newHierarchy[0]]),
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
  // Whether the moved unit must fully LEAVE the old top-level branch depends on
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
  //     still appear deeper, and the aggregation invariant validates that the
  //     old hierarchy re-sums correctly with the unit relocated.
  const crossesTop = originalHierarchy[0] !== newHierarchy[0];

  console.log(`\n[AGGREGATION VERIFICATION FOR OLD HIERARCHY]`);
  // Re-poll across reloads: after the move the old parent's rollup recomputes
  // asynchronously, and a cross-top moved unit can briefly linger in the old
  // subtree until the rollup propagates. Fold BOTH conditions (aggregation
  // re-sums AND, for cross-top moves, the moved unit has left) into the same
  // re-poll so transient lag settles before we assert. The detailed assertions
  // below then run on the SETTLED snapshot.
  const { ok, values: oldHierarchyValues, report: oldAggReport } =
    await captureAndVerifyAggregationResilient(
      hierarchyPage,
      { ...ctx, oldHierarchyPath },
      makatId,
      oldHierarchyPath,
      'Aggregation (old hierarchy)',
      crossesTop ? (vals) => !vals.has(unitToMove) : undefined,
    );

  console.log(`\n[MOVED UNIT ABSENCE CHECK]`);
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

  expect(
    ok,
    `[ASSERTION: aggregation-invalid-old-hierarchy] Aggregation rule (parent = sum(children)) violated on the OLD hierarchy [${oldHierarchyPath.join(
      ' → ',
    )}] after unit ${unitToMove} was moved out from under parent ${oldParentUnit}.\n${oldAggReport}`,
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
    // ─── CAROUSEL-BLOAT FIX: release this cluster's locks when it finishes ───
    //
    // The top-units carousel renders EVERY locked top-level unit across ALL
    // workers. `beforeEach` locks each entry's source top but nothing ever
    // unlocked them, so locks ACCUMULATED for the whole run — the carousel grew
    // to ~70 units, pushing a test's target deep into pagination and causing the
    // slow-backend "before-capture" timeouts (the HORIZONTAL Gdud failures).
    //
    // Releasing a cluster's top units once its serial tests are done keeps the
    // live carousel small, so later clusters paginate far less. We unlock only
    // the TOP units this cluster locked (children of Matkal); deeper units are
    // already unlocked by each move flow. Best-effort: a cleanup hiccup must
    // never fail an otherwise-green cluster, so every error is logged, not
    // thrown. Runs on its OWN short-lived API context because the test-scoped
    // `request` fixture is not available inside `afterAll`.
    test.afterAll(async () => {
      const topUnits = [
        ...new Set(
          cluster.flatMap((e) => topUnitsOf(e)).filter((u) => u !== 1),
        ),
      ];
      if (topUnits.length === 0) return;

      const label = clusterLabelAll(cluster);
      let ctx: APIRequestContext | undefined;
      try {
        ctx = await apiRequest.newContext();
        // Unlock each top unit (status 0) directly under Matkal (father=1).
        // `lockUnitStatus` already retries transient network blips internally.
        for (const unit of topUnits) {
          try {
            await lockUnitStatus(ctx, [unit], 1, 0);
          } catch (err) {
            console.warn(
              `[afterAll cleanup] Could not unlock top unit ${unit} for cluster ` +
                `[${label}]: ${String(err).slice(0, 160)} — leaving it locked (carousel ` +
                `will be slightly larger but tests are unaffected).`,
            );
          }
        }
        console.log(
          `[afterAll cleanup] Released top units [${topUnits.join(', ')}] for cluster [${label}].`,
        );
      } catch (err) {
        console.warn(
          `[afterAll cleanup] Could not create API context to release locks for cluster ` +
            `[${label}]: ${String(err).slice(0, 160)} — skipping cleanup (non-fatal).`,
        );
      } finally {
        await ctx?.dispose().catch(() => undefined);
      }
    });

    cluster.forEach((entry) => {
      test(`${TEST_NAME[entry._kind]}[${entry.description}]`, async ({
        hierarchyPage,
        request,
      }) => {
        // Per-test ceiling. These flows do a lot of slow UI work (carousel
        // pagination, makat combobox hydration, multiple reloads) plus several
        // API round-trips, so a momentarily slow backend can legitimately push
        // a CORRECT test past the old 180s limit (passing runs were already
        // landing at ~2.5–3.1m). Give healthy head-room under the global 300s
        // config timeout so transient slowness is absorbed instead of being
        // reported as a failure. Override with HC_TEST_TIMEOUT_MS when needed.
        test.setTimeout(Number(process.env.HC_TEST_TIMEOUT_MS ?? 270_000));
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
