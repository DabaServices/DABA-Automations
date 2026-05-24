import { APIRequestContext } from '@playwright/test';
import { lockUnitStatus } from './lockunitstatus';
import { reportUnits } from './reportUnits';
import { BACKEND_URL } from '../../playwright.config';
import { fetchHierarchyUnits } from './dynamicHierarchyDiscovery';

/**
 * apiHelpers - Reusable helpers for API-related test operations
 *
 * These functions require an APIRequestContext (e.g. unlock/lock operations)
 * for hierarchy manipulation.
 */

/**
 * Unlock every unit in a hierarchy path, strictly top → bottom.
 *
 * The API requires that a parent is already unlocked before you can unlock
 * its children.  This function walks the path in order and calls
 * `lockUnitStatus` with the correct fatherId at each level.
 *
 * Example for path [2, 11, 101] (rootFather defaults to 1):
 *   unlock unit 2   (father: 1)
 *   unlock unit 11  (father: 2)
 *   unlock unit 101 (father: 11)
 *
 * @param request       - Playwright APIRequestContext
 * @param hierarchyPath - Ordered array from top-level to target unit
 * @param rootFather    - Parent of the first unit in the path (default: 1)
 */
export const unlockHierarchyPath = async (
  request: APIRequestContext,
  hierarchyPath: number[],
  rootFather: number = 1
): Promise<void> => {
  console.info(`[unlockHierarchyPath] Unlocking path of ${hierarchyPath.length} units`);
  for (let i = 0; i < hierarchyPath.length; i++) {
    const unitId = hierarchyPath[i];
    const fatherId = i === 0 ? rootFather : hierarchyPath[i - 1];
    try {
      await lockUnitStatus(request, [unitId], fatherId, 0);
    } catch (error) {
      console.error(`[unlockHierarchyPath] Failed to unlock unit ${unitId}: ${error}`);
    }
  }
  console.info(`[unlockHierarchyPath] Completed unlocking path of ${hierarchyPath.length} units`);
};

/**
 * Lock multiple units (can be separate top-level units or hierarchies).
 *
 * This function locks all units in the provided array.
 * Each unit is locked with rootFather as its parent (for top-level units).
 * This is useful for locking multiple separate hierarchies after a move operation.
 *
 * Example: lockCompleteHierarchy(request, [2, 3]) locks:
 *   1. Unit 2 with father 1
 *   2. Unit 3 with father 1
 *
 * @param request         - Playwright APIRequestContext
 * @param unitsToLock     - Array of unit IDs to lock (can be separate units)
 * @param rootFather      - Parent of all units in the array (default: 1)
 */
const PIKUDS_API_URL = `${BACKEND_URL}/units/pikuds`;

/**
 * Fetch all top-level unit IDs (children of Matkal, level 1) from the LIVE
 * backend hierarchy.
 *
 * Why this matters: `/reports/committees/report` (called by
 * `lockCompleteHierarchy`) requires the EXACT current set of top-level
 * units in `lowerUnitsIds`. If we send a stale / hardcoded list the
 * backend rejects with HTTP 502 + body
 *     "ההיררכיה תחתיך השתנתה, יש לרענן את המסך"
 * ("the hierarchy below you has changed — please refresh").
 *
 * Previous implementations relied on either `/units/pikuds` (often
 * unavailable on the automations backend) or a hardcoded `[2..10]` list
 * which goes stale as soon as any HC test reparents a unit to Matkal.
 * We now derive the list from `/units/hierarchy`, which is the same
 * endpoint the data-builder uses, so the two are always in sync.
 *
 * Result is cached per APIRequestContext for 30 s to avoid hammering the
 * hierarchy endpoint on every lock call in a serial test cluster.
 */
const TOP_UNITS_CACHE = new WeakMap<APIRequestContext, { at: number; ids: number[] }>();
const TOP_UNITS_TTL_MS = 30_000;

export const fetchAllTopLevelUnits = async (
  request: APIRequestContext
): Promise<number[]> => {
  const cached = TOP_UNITS_CACHE.get(request);
  if (cached && Date.now() - cached.at < TOP_UNITS_TTL_MS) {
    return cached.ids;
  }

  let unitIds: number[];
  try {
    const units = await fetchHierarchyUnits(request);
    unitIds = [
      ...new Set(
        units
          .filter((u) => (u.parent as { id?: number } | undefined)?.id === 1 && u.id !== 1)
          .map((u) => u.id),
      ),
    ].sort((a, b) => a - b);

    if (unitIds.length === 0) {
      throw new Error(
        `[fetchAllTopLevelUnits] Live hierarchy returned 0 top-level units (children of Matkal=1).`,
      );
    }
    console.info(
      `[fetchAllTopLevelUnits] Live top-level units (${unitIds.length}): [${unitIds.join(', ')}]`,
    );
  } catch (error) {
    console.error(`[fetchAllTopLevelUnits] Live fetch failed: ${error}`);
    throw error;
  }

  TOP_UNITS_CACHE.set(request, { at: Date.now(), ids: unitIds });
  return unitIds;
};

export const lockCompleteHierarchy = async (
  request: APIRequestContext,
  unitsToLock: number[],
  rootFather: number = 1
): Promise<void> => {
  // If no specific units provided, fetch all top-level units from the API
  const isLockAll = unitsToLock.length === 0;
  const effectiveUnits = isLockAll ? await fetchAllTopLevelUnits(request) : unitsToLock;

  console.info(`[lockCompleteHierarchy] Locking units: [${effectiveUnits.join(', ')}]${isLockAll ? ' (all top-level units)' : ''}`);

  // Single fetch of top-level units — reuse for both report + (optional) lock-all path.
  // The 30s WeakMap cache in fetchAllTopLevelUnits means subsequent callers
  // in the same worker get it for free.
  const allTopLevelUnits = await fetchAllTopLevelUnits(request);

  try {
    // Call report API before locking (isLaunching = false)
    await reportUnits(request, effectiveUnits, allTopLevelUnits, false, rootFather);

    // When locking all top units, skip updateHierarchy to avoid server hanging on recalculation
    await lockUnitStatus(request, effectiveUnits, rootFather, 1, undefined, isLockAll ? false : undefined);
    console.info(`[lockCompleteHierarchy] Successfully locked all ${effectiveUnits.length} units`);
  } catch (error) {
    console.error(`[lockCompleteHierarchy] Failed to lock units [${effectiveUnits.join(', ')}]: ${error}`);
    throw error;
  }

  console.info(`[lockCompleteHierarchy] Completed locking all ${effectiveUnits.length} units`);
};

/**
 * Unlock all units across both the original and new hierarchy paths.
 *
 * This is the counterpart to `lockCompleteHierarchy` and is used before a
 * unit-move operation so that the API accepts the change.
 *
 * Strategy:
 *  1. Merge both paths into a single ordered sequence, walking top → bottom.
 *     Units that appear in both paths (shared ancestors) are only unlocked once.
 *  2. Each unit is unlocked with the correct fatherId derived from its path.
 *     When a unit appears in both paths its fatherId from `originalHierarchy`
 *     is used (the relationship that is currently live in the API).
 *
 * Example – moving unit 101 from [2, 11, 101] to [3, 12, 101]:
 *   unlock unit  2  (father: 1)   ← from originalHierarchy
 *   unlock unit  3  (father: 1)   ← from newHierarchy (new branch root)
 *   unlock unit 11  (father: 2)   ← from originalHierarchy
 *   unlock unit 12  (father: 3)   ← from newHierarchy
 *   unlock unit 101 (father: 11)  ← from originalHierarchy (current live parent)
 *
 * @param request           - Playwright APIRequestContext
 * @param originalHierarchy - Current (old) ordered hierarchy path, top → bottom
 * @param newHierarchy      - Target (new) ordered hierarchy path, top → bottom
 * @param rootFather        - Parent of the topmost unit in each path (default: 1)
 */
export const unlockCompleteHierarchy = async (
  request: APIRequestContext,
  originalHierarchy: number[],
  newHierarchy: number[],
  rootFather: number = 1
): Promise<void> => {
  console.info(`[unlockCompleteHierarchy] Unlocking original path [${originalHierarchy.join(', ')}] and new path [${newHierarchy.join(', ')}]`);

  // Build a map of unitId → fatherId for each path (original takes precedence for shared units)
  const unitToFather = new Map<number, number>();

  for (let i = 0; i < originalHierarchy.length; i++) {
    const unitId = originalHierarchy[i];
    const fatherId = i === 0 ? rootFather : originalHierarchy[i - 1];
    unitToFather.set(unitId, fatherId);
  }

  for (let i = 0; i < newHierarchy.length; i++) {
    const unitId = newHierarchy[i];
    if (!unitToFather.has(unitId)) {
      // Only add units not already present from the original path
      const fatherId = i === 0 ? rootFather : newHierarchy[i - 1];
      unitToFather.set(unitId, fatherId);
    }
  }

  // Determine a stable top-to-bottom order:
  // Walk both paths in parallel by index so higher-level units are unlocked first
  const seen = new Set<number>();
  const unlockOrder: number[] = [];
  const maxLen = Math.max(originalHierarchy.length, newHierarchy.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < originalHierarchy.length) {
      const u = originalHierarchy[i];
      if (!seen.has(u)) { seen.add(u); unlockOrder.push(u); }
    }
    if (i < newHierarchy.length) {
      const u = newHierarchy[i];
      if (!seen.has(u)) { seen.add(u); unlockOrder.push(u); }
    }
  }

  for (const unitId of unlockOrder) {
    const fatherId = unitToFather.get(unitId)!;
    try {
      await lockUnitStatus(request, [unitId], fatherId, 0);
    } catch (error) {
      console.error(`[unlockCompleteHierarchy] Failed to unlock unit ${unitId} (father: ${fatherId}): ${error}`);
    }
  }

  console.info(`[unlockCompleteHierarchy] Completed – unlocked ${unlockOrder.length} unit(s)`);
};

/**
 * waitForConsistentRead — handles the backend's "stale read" caveat (Q3).
 *
 * The backend runs reads outside any transaction under READ COMMITTED, so a
 * read fired immediately after a successful write may still observe the
 * pre-commit snapshot for a brief window (no in-flight half-state, just lag).
 *
 * Polls a read function until `predicate(value) === true`, or the timeout
 * expires. Use right after any mutating API call (move / save / lock-toggle)
 * when the next assertion depends on the new value being visible.
 *
 * Example — after moving a unit, wait for the new parent's children list to
 * include it before asserting:
 *
 *   await reparentUnit(request, { unitId: 104, newParent: 3 });
 *   const children = await waitForConsistentRead(
 *     () => getChildren(request, 3),
 *     (kids) => kids.includes(104),
 *     { label: 'parent 3 children include 104' }
 *   );
 *
 * @param read       async function that performs the read
 * @param predicate  returns true when the read result reflects the write
 * @param opts.timeoutMs   total time budget (default 5000)
 * @param opts.intervalMs  poll spacing (default 100)
 * @param opts.label       human-readable description for error / log
 *
 * @returns The first read value that satisfies `predicate`.
 * @throws  Error after `timeoutMs` if predicate never returned true.
 */
export const waitForConsistentRead = async <T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {}
): Promise<T> => {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 100;
  const label = opts.label ?? 'consistent read';
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      lastValue = await read();
      if (predicate(lastValue)) {
        if (attempts > 1) {
          console.info(
            `[waitForConsistentRead] "${label}" became consistent after ${attempts} attempts (~${attempts * intervalMs}ms).`
          );
        }
        return lastValue;
      }
    } catch (err) {
      console.warn(`[waitForConsistentRead] "${label}" attempt ${attempts} threw: ${err}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `[waitForConsistentRead] "${label}" did not become consistent within ${timeoutMs}ms ` +
      `(${attempts} attempts). Last value: ${JSON.stringify(lastValue)}`
  );
};

/**
 * waitForUnitParent — convenience wrapper around `waitForConsistentRead`
 * for the most common case: confirming a reparent has propagated to reads.
 *
 * Polls the live hierarchy until `unitId` reports `expectedParentId` as its
 * parent. Use right after a move-unit API call.
 *
 *   await reparentUnit(request, { unitId: 104, newParent: 3 });
 *   await waitForUnitParent(request, 104, 3);
 */
export const waitForUnitParent = async (
  request: APIRequestContext,
  unitId: number,
  expectedParentId: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> => {
  // Local import to avoid a circular dependency at module load time.
  const { fetchHierarchyUnits } = await import('./dynamicHierarchyDiscovery');
  await waitForConsistentRead(
    async () => {
      const units = await fetchHierarchyUnits(request);
      return units.find((u) => u.id === unitId);
    },
    (unit) => (unit?.parent as { id: number } | null | undefined)?.id === expectedParentId,
    { ...opts, label: `unit ${unitId} parent === ${expectedParentId}` }
  );
};
