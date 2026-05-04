import { APIRequestContext } from '@playwright/test';
import { lockUnitStatus } from './lockunitstatus';
import { BACKEND_URL } from '../../playwright.config';

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
 * Fetch all top-level unit IDs (pikuds) from the API.
 * Throws if the API call fails — no hardcoded fallback.
 */
export const fetchAllTopLevelUnits = async (
  _request: APIRequestContext
): Promise<number[]> => {
  // TEMPORARY: connected to the regular backend (not the automations backend),
  // so the /units/pikuds endpoint is unavailable. Returning a hardcoded list
  // of top-level units instead. Restore the API call below when switched back.
  const hardcodedUnits = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  console.info(`[fetchAllTopLevelUnits] Using hardcoded top-level units: [${hardcodedUnits.join(', ')}]`);
  return hardcodedUnits;

  /* ----- Original API-based implementation (re-enable when on automations BE) -----
  const response = await _request.fetch(PIKUDS_API_URL, {
    method: 'GET',
    headers: {
      'screendate': new Date().toISOString().split('T')[0],
      'user': 'S9107544',
    },
  });
  const responseBody = await response.text();
  console.info(`[fetchAllTopLevelUnits] API response status: ${response.status()}, body: ${responseBody}`);

  if (!response.ok()) {
    throw new Error(`[fetchAllTopLevelUnits] API returned status ${response.status()}`);
  }

  const data = JSON.parse(responseBody);
  // Handle both array and wrapped responses (e.g. { units: [...] } or { data: [...] })
  const arr = Array.isArray(data) ? data : (data.units ?? data.data ?? data.results ?? []);
  const unitIds: number[] = arr.map((u: any) => {
    if (typeof u === 'number') return u;
    return Number(u.id ?? u.unitId ?? u.unit_id ?? u.unitNumber ?? u.unit_number ?? u);
  }).filter((id: number) => !isNaN(id) && id > 0);

  if (unitIds.length === 0) {
    throw new Error(`[fetchAllTopLevelUnits] API returned no valid unit IDs`);
  }

  console.info(`[fetchAllTopLevelUnits] Fetched ${unitIds.length} top-level units from API: [${unitIds.join(', ')}]`);
  return unitIds;
  ----- */
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

  try {
    // When locking all top units, skip updateHierarchy to avoid server hanging on recalculation
    await lockUnitStatus(request, effectiveUnits, rootFather, 1, undefined, isLockAll ? false : undefined);
    console.info(`[lockCompleteHierarchy] Successfully locked all ${effectiveUnits.length} units`);
  } catch (error) {
    console.error(`[lockCompleteHierarchy] Failed to lock units [${effectiveUnits.join(', ')}]: ${error}`);
    throw error;
  }

  // After locking, call GET /units/hierarchy to trigger a full hierarchy
  // refresh on the backend (mirrors what the UI does after confirming the lock).
  // Without this call, aggregation values for old parents may remain stale.
  try {
    const date = new Date().toISOString().split('T')[0];
    await request.get(`${BACKEND_URL}/units/hierarchy?user=S9107544`, {
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer',
        unit: rootFather.toString(),
        screendate: date,
        user: 'S9107544',
      },
    });
    console.info(`[lockCompleteHierarchy] Hierarchy refresh triggered via GET /units/hierarchy`);
  } catch (error) {
    console.warn(`[lockCompleteHierarchy] Hierarchy refresh call failed (non-critical): ${error}`);
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
