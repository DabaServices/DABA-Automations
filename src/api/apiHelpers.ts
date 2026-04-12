import { APIRequestContext } from '@playwright/test';
import { lockUnitStatus } from './lockunitstatus';

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
 * Lock a complete hierarchy after a hierarchy change operation.
 *
 * IMPORTANT: After a move operation, this function locks the NEW hierarchy path only.
 * It does NOT re-lock the old path, as those units have moved and their parent
 * relationships have changed.
 *
 * The function locks all units by hierarchy level (deepest first).
 * Children must be locked before their parents to maintain API constraints.
 *
 * BATCHING: All units at the same parent level are locked together in ONE API call.
 * This is more efficient and matches the API's expected behavior.
 *
 * Example: If moving unit 101 from [2, 11, 101] to [3, 12, 101]:
 *   Lock the NEW path [3, 12, 101]:
 *   1. Call API with [101], father=12, statusId=1  (deepest level first)
 *   2. Call API with [12], father=3, statusId=1
 *   3. Call API with [3], father=1, statusId=1
 *
 * @param request         - Playwright APIRequestContext
 * @param hierarchyPath   - Original hierarchy path (ignored, kept for API compatibility)
 * @param secondPath      - NEW hierarchy path after the move (this is what gets locked)
 * @param rootFather      - Parent of the highest-level unit (default: 1)
 */
export const lockCompleteHierarchy = async (
  request: APIRequestContext,
  hierarchyPath: number[],
  secondPath?: number[],
  rootFather: number = 1
): Promise<void> => {
  // CRITICAL: Use the NEW hierarchy path (secondPath) not the old one
  // After a move, the old path relationships are invalid
  const pathToLock = secondPath || hierarchyPath;
  
  // Track unit → (fatherId, depth)
  const unitInfo = new Map<number, { fatherId: number; depth: number }>();
  
  // Add root
  unitInfo.set(rootFather, { fatherId: -1, depth: 0 });
  
  // Add the path units with correct parent relationships
  for (let i = 0; i < pathToLock.length; i++) {
    const unitId = pathToLock[i];
    const fatherId = i === 0 ? rootFather : pathToLock[i - 1];
    unitInfo.set(unitId, { fatherId, depth: i + 1 });
  }
  
  // Build lock list, excluding root
  const unitsToLock: Array<[number, number, number]> = [];
  for (const [unitId, info] of unitInfo.entries()) {
    if (unitId !== rootFather) {
      unitsToLock.push([unitId, info.fatherId, info.depth]);
    }
  }
  
  // Group units by parent (fatherId) for batched API calls
  // Map: fatherId → {units: [unitIds], depth: d}
  const unitsByParent = new Map<number, { units: number[]; depth: number }>();
  
  for (const [unitId, fatherId, depth] of unitsToLock) {
    if (!unitsByParent.has(fatherId)) {
      unitsByParent.set(fatherId, { units: [], depth });
    }
    unitsByParent.get(fatherId)!.units.push(unitId);
  }
   // Convert to array and sort by depth in REVERSE (deepest first)
  // This ensures children are locked before parents
  const lockSequence = Array.from(unitsByParent.entries())
    .map(([fatherId, { units, depth }]) => ({ fatherId, units, depth }))
    .sort((a, b) => b.depth - a.depth);

  console.info(`[lockCompleteHierarchy] Locking ${unitsToLock.length} units in ${lockSequence.length} batches`);
  for (const { fatherId, units, depth } of lockSequence) {
    try {
      await lockUnitStatus(request, units, fatherId, 1);
    } catch (error) {
      console.error(`[lockCompleteHierarchy] Failed to lock units [${units.join(', ')}] with parent ${fatherId}: ${error}`);
    }
  }
  console.info(`[lockCompleteHierarchy] Completed locking ${unitsToLock.length} units`);
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
