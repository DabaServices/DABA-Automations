import { APIRequestContext } from '@playwright/test';
import { unlockHierarchyPath, lockCompleteHierarchy } from './apiHelpers';
import { updateUnitHierarchy } from './hierarchychange';

/**
 * hierarchyCheck.ts
 *
 * Utility for a beforeEach test hook to synchronise a unit hierarchy to a known state.
 *
 * Exported symbols:
 *  - HierarchyNode          – recursive tree type
 *  - Transaction            – shared context passed through recursive calls
 *  - fetchCurrentParentRelation – query the live hierarchy service for a unit's parent
 *  - ensureTestHierarchy    – idempotent sync: moves units that are in the wrong place
 *  - buildHierarchyFromPath – build a HierarchyNode tree from a flat path array
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Describes one node in a hierarchy tree.
 *
 * @example
 * // Root → 2 → 11 → [101, 102]
 * const tree: HierarchyNode = {
 *   unitId: 2,
 *   children: [
 *     { unitId: 11, children: [{ unitId: 101 }, { unitId: 102 }] },
 *   ],
 * };
 */
export interface HierarchyNode {
  /** The unit ID represented by this node. */
  unitId: number;
  /**
   * Expected parent for this node.
   * - Omit (or set to undefined) for root-level units whose parent is the
   *   system root (id = 1).
   */
  expectedParent?: number;
  /** Child nodes that sit directly under this unit in the hierarchy. */
  children?: HierarchyNode[];
}

/**
 * Shared mutable context passed through every recursive call so we can
 * track which unlock paths have already been sent to the API (avoiding
 * duplicate requests for shared ancestors).
 */
export interface Transaction {
  /** Playwright APIRequestContext – required for all API calls. */
  request: APIRequestContext;
  /**
   * Set of unit IDs that have already been unlocked in this transaction.
   * Prevents redundant unlock calls when the same ancestor appears in
   * both the source and target paths.
   */
  unlockedUnits: Set<number>;
  /**
   * The global root unit ID (default: 1).
   * All paths are considered to originate from this ID.
   */
  rootUnit: number;
  /**
   * Optional date string in YYYY-MM-DD format to pass to the API.
   * Defaults to today when omitted.
   */
  screenDate?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE_URL = 'http://localhost:3000'; //http://dev.162.55.55.124.nip.io/

// ── Flat hierarchy cache ──────────────────────────────────────────────────────
// We fetch the full flat unit list once per ensureTestHierarchy call and cache
// it here so fetchCurrentParentRelation doesn't hammer the server for every unit.
let _hierarchyCache: Map<number, number | null> | null = null;

/**
 * Fetch the full flat unit list from GET /units/hierarchy and build a
 * unitId → parentId lookup map.  Cached for the duration of a sync.
 */
async function loadHierarchyCache(
  request: APIRequestContext,
  date: string
): Promise<Map<number, number | null>> {
  if (_hierarchyCache) return _hierarchyCache;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: 'Bearer',
    unit: '1',
    screendate: date,
  };

  const response = await request.get(`${API_BASE_URL}/units/hierarchy`, { headers });

  if (!response.ok()) {
    console.warn(`[loadHierarchyCache] Non-OK response (${response.status()}). Cache will be empty.`);
    _hierarchyCache = new Map();
    return _hierarchyCache;
  }

  const body = await response.json();
  const units: any[] = body?.body?.data ?? body?.data ?? [];

  _hierarchyCache = new Map<number, number | null>();
  for (const unit of units) {
    _hierarchyCache.set(unit.id, unit.parent?.id ?? null);
  }

  console.info(`[loadHierarchyCache] Loaded ${_hierarchyCache.size} units into cache`);
  return _hierarchyCache;
}

/** Invalidate the cache after a move so subsequent lookups reflect the new state. */
function invalidateHierarchyCache(): void {
  _hierarchyCache = null;
}

/**
 * Build a flat ordered path (root → leaf) from the HierarchyNode tree for a
 * given unit ID.  Returns `null` if the unit is not found in the tree.
 *
 * @param tree  - The root HierarchyNode to search.
 * @param target - The unit ID we are searching for.
 * @param path   - Accumulator (do not pass externally).
 */
function buildPathToUnit(
  tree: HierarchyNode,
  target: number,
  path: number[] = []
): number[] | null {
  const current = [...path, tree.unitId];
  if (tree.unitId === target) return current;
  for (const child of tree.children ?? []) {
    const result = buildPathToUnit(child, target, current);
    if (result) return result;
  }
  return null;
}

/**
 * Unlock a path (array of unit IDs, top → bottom) while skipping units that
 * are already marked as unlocked in the transaction.
 *
 * Only the un-seen slice is sent to `unlockHierarchyPath`; the function keeps
 * `transaction.unlockedUnits` up-to-date so later calls know what is done.
 */
async function unlockPathWithTracking(
  pathFromRoot: number[],
  tx: Transaction
): Promise<void> {
  // Find the first unit in the path that hasn't been unlocked yet
  const firstPending = pathFromRoot.findIndex((id) => !tx.unlockedUnits.has(id));

  if (firstPending === -1) {
    // All units in this path are already unlocked – nothing to do
    console.info(
      `[ensureTestHierarchy] Path [${pathFromRoot.join(' → ')}] already fully unlocked`
    );
    return;
  }

  // The slice we still need to unlock
  const pendingSlice = pathFromRoot.slice(firstPending);

  // The "father" of the first pending unit is either the unit just before it
  // in the path (already unlocked), or the global root.
  const sliceFather =
    firstPending > 0 ? pathFromRoot[firstPending - 1] : tx.rootUnit;

  console.info(
    `[ensureTestHierarchy] Unlocking pending slice [${pendingSlice.join(' → ')}] (father of first: ${sliceFather})`
  );

  await unlockHierarchyPath(tx.request, pendingSlice, sliceFather);

  // Mark all as unlocked
  pendingSlice.forEach((id) => tx.unlockedUnits.add(id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query the hierarchy service to find the **current** parent of `lowerUnit`.
 *
 * Returns `null` when the unit has no parent (i.e. it is a root-level unit).
 *
 * @param lowerUnit - The unit whose parent we want to discover.
 * @param date      - Screen date in YYYY-MM-DD format.
 * @param transaction - Optional shared transaction context (reuses its request).
 */
export async function fetchCurrentParentRelation(
  lowerUnit: number,
  date: string,
  transaction?: Transaction
): Promise<number | null> {
  try {
    let cache: Map<number, number | null>;

    if (transaction?.request) {
      cache = await loadHierarchyCache(transaction.request, date);
    } else {
      // No request context – fall back to a direct fetch to prime a temporary cache
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        authorization: 'Bearer',
        unit: '1',
        screendate: date,
      };
      const response = await fetch(`${API_BASE_URL}/units/hierarchy`, { headers });
      if (!response.ok) {
        console.warn(`[fetchCurrentParentRelation] Non-OK response for unit ${lowerUnit}. Assuming no parent.`);
        return null;
      }
      const body = await response.json();
      const units: any[] = body?.body?.data ?? body?.data ?? [];
      cache = new Map<number, number | null>();
      for (const unit of units) {
        cache.set(unit.id, unit.parent?.id ?? null);
      }
    }

    if (!cache.has(lowerUnit)) {
      console.warn(`[fetchCurrentParentRelation] Unit ${lowerUnit} not found in hierarchy. Assuming no parent.`);
      return null;
    }

    const parentId = cache.get(lowerUnit) ?? null;
    console.info(`[fetchCurrentParentRelation] unit=${lowerUnit} → parent=${parentId}`);
    return parentId;
  } catch (err) {
    console.warn(`[fetchCurrentParentRelation] Error for unit ${lowerUnit}: ${err}. Assuming no parent.`);
    return null;
  }
}

/**
 * Idempotently synchronise the live hierarchy to the desired structure.
 *
 * The function walks `desiredHierarchy` level-by-level.  For each unit it:
 * 1. Calls `fetchCurrentParentRelation` to get the live parent.
 * 2. Compares against the desired parent.
 * 3. If a move is needed it performs the **Two-Path Unlock** (source path +
 *    target path, both from root → leaf), then calls `updateUnitHierarchy`.
 * 4. After moving, re-examines children (the move may have placed them
 *    correctly, or they may still need their own independent moves).
 * 5. Finally, locks the entire desired hierarchy back via
 *    `lockCompleteHierarchy`.
 *
 * Units that are already in the correct place are skipped without any API calls.
 *
 * @param request          - Playwright APIRequestContext.
 * @param desiredHierarchy - The tree structure we want the system to match.
 * @param rootUnit         - Global root unit (default: 1).
 * @param screenDate       - Date string YYYY-MM-DD (defaults to today).
 */
export async function ensureTestHierarchy(
  request: APIRequestContext,
  desiredHierarchy: HierarchyNode,
  rootUnit: number = 1,
  screenDate?: string
): Promise<void> {
  const date = screenDate ?? new Date().toISOString().split('T')[0];

  const tx: Transaction = {
    request,
    unlockedUnits: new Set<number>(),
    rootUnit,
    screenDate: date,
  };

  console.info(
    `[ensureTestHierarchy] Starting hierarchy sync (root=${rootUnit}, date=${date})`
  );

  // Process the tree starting from the top-level children of the desired root
  await processNode(desiredHierarchy, null, desiredHierarchy, tx);

  // NOTE: Locking is intentionally NOT done here.
  // The caller (e.g. the beforeEach hook) is responsible for locking the
  // top-level parent units via confirmAndLockHierarchyViaDrawer, which uses
  // the UI drawer rather than the lock API directly.

  console.info(`[ensureTestHierarchy] Hierarchy sync complete.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core recursive worker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively process a single node in the desired hierarchy tree.
 *
 * @param node             - The node currently being evaluated.
 * @param desiredParentId  - The parent this node should have (null = root-level).
 * @param treeRoot         - The root of the entire desired tree (for path lookups).
 * @param tx               - Shared transaction context.
 */
async function processNode(
  node: HierarchyNode,
  desiredParentId: number | null,
  treeRoot: HierarchyNode,
  tx: Transaction
): Promise<void> {
  const { unitId } = node;

  // ── 1. Fetch current parent ──────────────────────────────────────────────
  const currentParentId = await fetchCurrentParentRelation(
    unitId,
    tx.screenDate!,
    tx
  );

  const needsMove =
    currentParentId !== desiredParentId &&
    // Treat "null" and rootUnit as equivalent for top-level units
    !(currentParentId === tx.rootUnit && desiredParentId === null) &&
    !(currentParentId === null && desiredParentId === tx.rootUnit);

  if (!needsMove) {
    console.info(
      `[ensureTestHierarchy] Unit ${unitId} already under parent ${desiredParentId ?? tx.rootUnit} – no move needed`
    );
  } else {
    console.info(
      `[ensureTestHierarchy] Unit ${unitId} needs to move: ${currentParentId} → ${desiredParentId ?? tx.rootUnit}`
    );

    // ── 2. Two-Path Unlock ─────────────────────────────────────────────────
    // Source path: root → ... → currentParentId → unitId
    // We can only build the source path if we know currentParentId.
    if (currentParentId !== null) {
      const sourcePath = await buildLivePathToUnit(unitId, tx);
      if (sourcePath.length > 0) {
        console.info(
          `[ensureTestHierarchy] Unlocking SOURCE path: [${sourcePath.join(' → ')}]`
        );
        await unlockPathWithTracking(sourcePath, tx);
      }
    }

    // Target path: root → ... → desiredParentId → unitId (from desired tree)
    const targetParentId = desiredParentId ?? tx.rootUnit;
    const targetPathToParent = buildPathToUnit(treeRoot, targetParentId);
    const targetPath = targetPathToParent
      ? [...targetPathToParent, unitId]
      : [unitId];

    console.info(
      `[ensureTestHierarchy] Unlocking TARGET path: [${targetPath.join(' → ')}]`
    );
    await unlockPathWithTracking(targetPath, tx);

    // ── 3. Move the unit ───────────────────────────────────────────────────
    const newUpperUnit = desiredParentId ?? tx.rootUnit;
    console.info(
      `[ensureTestHierarchy] Moving unit ${unitId} → parent ${newUpperUnit}`
    );
    await updateUnitHierarchy(
      tx.request,
      unitId,
      newUpperUnit,
      tx.rootUnit,
      tx.rootUnit,
      tx.screenDate
    );

    // Invalidate the cache so children see the updated hierarchy
    invalidateHierarchyCache();
  }

  // ── 4. Re-verify and recurse into children ───────────────────────────────
  for (const child of node.children ?? []) {
    await processNode(child, unitId, treeRoot, tx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path-building helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the path from the system root to `targetUnit` by following live
 * `fetchCurrentParentRelation` calls upward.
 *
 * The resulting array is ordered root → leaf (i.e. [grandparent, parent, unit]).
 * Returns an empty array if the chain cannot be resolved (e.g. unit not found).
 *
 * @param targetUnit - The unit whose live ancestor chain we want.
 * @param tx         - Shared transaction context.
 * @param maxDepth   - Safety limit to avoid infinite loops (default: 20).
 */
async function buildLivePathToUnit(
  targetUnit: number,
  tx: Transaction,
  maxDepth = 20
): Promise<number[]> {
  const path: number[] = [targetUnit];
  let current = targetUnit;

  for (let depth = 0; depth < maxDepth; depth++) {
    const parent = await fetchCurrentParentRelation(
      current,
      tx.screenDate!,
      tx
    );

    if (parent === null || parent === tx.rootUnit) {
      // We've reached the top; prepend rootUnit if needed and break
      if (parent === tx.rootUnit) {
        // rootUnit itself is NOT included in the unlock path
      }
      break;
    }

    path.unshift(parent);
    current = parent;
  }

  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test-setup helpers (exported for use in spec files)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a nested HierarchyNode chain from a flat ordered path array.
 *
 * @example
 * buildHierarchyFromPath([2, 11, 101, 401])
 * // → { unitId:2, children:[{ unitId:11, children:[{ unitId:101, children:[{ unitId:401 }] }] }] }
 */
export function buildHierarchyFromPath(path: number[]): HierarchyNode {
  let node: HierarchyNode = { unitId: path[path.length - 1] };
  for (let i = path.length - 2; i >= 0; i--) {
    node = { unitId: path[i], children: [node] };
  }
  return node;
}

