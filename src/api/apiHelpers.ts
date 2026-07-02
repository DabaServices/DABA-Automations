import { APIRequestContext } from '@playwright/test';
import { lockUnitStatus } from './lockunitstatus';
import { reportUnits, ClientError } from './reportUnits';
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
 * Result is cached at MODULE scope (per worker process) for 60 s. Playwright
 * gives every test a fresh `APIRequestContext` fixture, so a per-context
 * cache (e.g. WeakMap) effectively never hits across tests. A module-level
 * cache survives the whole worker run and saves a ~1000-row hierarchy GET
 * on every `lockCompleteHierarchy` after the first.
 *
 * The `request` arg is still required (for the network call when the cache
 * misses), but is NOT part of the cache key.
 */
let TOP_UNITS_CACHE: { at: number; ids: number[] } | undefined;
const TOP_UNITS_TTL_MS = 60_000;

/**
 * Invalidate the module-level top-level-units cache.
 *
 * MUST be called after any operation that changes the set of top-level units
 * (children of Matkal=1) — most importantly a unit MOVE. Otherwise a later
 * `lockCompleteHierarchy` sends a stale `lowerUnitsIds` to
 * `/reports/committees/report`, and the backend rejects with HTTP 502 +
 * "ההיררכיה תחתיך השתנתה, יש לרענן את המסך" ("the hierarchy below you changed
 * — please refresh").
 */
export const invalidateTopLevelUnitsCache = (): void => {
  if (TOP_UNITS_CACHE) {
    console.info('[invalidateTopLevelUnitsCache] Cleared cached top-level units.');
  }
  TOP_UNITS_CACHE = undefined;
};

export const fetchAllTopLevelUnits = async (
  request: APIRequestContext,
  force: boolean = false
): Promise<number[]> => {
  if (!force && TOP_UNITS_CACHE && Date.now() - TOP_UNITS_CACHE.at < TOP_UNITS_TTL_MS) {
    return TOP_UNITS_CACHE.ids;
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

  TOP_UNITS_CACHE = { at: Date.now(), ids: unitIds };
  return unitIds;
};

export const lockCompleteHierarchy = async (
  request: APIRequestContext,
  unitsToLock: number[],
  rootFather: number = 1
): Promise<void> => {
  // Backend marker for "the hierarchy below you changed — please refresh".
  // It comes back as HTTP 502 from /reports/committees/report when the
  // `lowerUnitsIds` we sent no longer matches the LIVE top-level set (e.g.
  // a unit was just moved in/out of the top level). The remedy is literally
  // what the message says: refresh (re-fetch the live list) and retry once.
  const HIERARCHY_CHANGED = 'ההיררכיה תחתיך השתנתה';

  const attemptLock = async (forceRefresh: boolean): Promise<void> => {
    // `force` bypasses the 60 s cache so a post-move retry sees reality.
    const allTopLevelUnits = await fetchAllTopLevelUnits(request, forceRefresh);

    // If no specific units provided, lock the entire top level.
    const isLockAll = unitsToLock.length === 0;
    const effectiveUnits = isLockAll ? allTopLevelUnits : unitsToLock;

    console.info(
      `[lockCompleteHierarchy] Locking units: [${effectiveUnits.join(', ')}]${isLockAll ? ' (all top-level units)' : ''}`,
    );

    // Call report API before locking (isLaunching = false)
    await reportUnits(request, effectiveUnits, allTopLevelUnits, false, rootFather);

    // When locking all top units, skip updateHierarchy to avoid server hanging on recalculation
    await lockUnitStatus(request, effectiveUnits, rootFather, 1, undefined, isLockAll ? false : undefined);
    console.info(`[lockCompleteHierarchy] Successfully locked all ${effectiveUnits.length} units`);
  };

  try {
    await attemptLock(false);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes(HIERARCHY_CHANGED)) {
      console.warn(
        `[lockCompleteHierarchy] Backend reported a hierarchy change — refreshing top-level units and retrying once.`,
      );
      invalidateTopLevelUnitsCache();
      try {
        await attemptLock(true);
      } catch (retryError) {
        console.error(`[lockCompleteHierarchy] Retry after refresh still failed: ${retryError}`);
        throw retryError;
      }
    } else {
      console.error(`[lockCompleteHierarchy] Failed to lock units: ${error}`);
      throw error;
    }
  }

  console.info(`[lockCompleteHierarchy] Completed locking.`);
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

  // Determine a strictly parent-before-child unlock order.
  //
  // The backend enforces "a parent must already be unlocked before its child
  // can be unlocked". The ONLY ordering guaranteed to satisfy that is to walk
  // the LIVE hierarchy — i.e. the original path — fully top → bottom first,
  // THEN append any units that exist only on the new path (the destination
  // branch roots), also top → bottom.
  //
  // A previous version interleaved the two paths BY INDEX. That broke every
  // "move a deep unit up near the root" case (e.g. orig=[2,29,119,419],
  // new=[419]): the zip placed new[0]=419 (the leaf) at position 2, BEFORE its
  // ancestors 29/119 were unlocked, so the backend rejected unit 419 with
  // HTTP 400 "יחידת המסך נעולה" ("the screen unit is locked"). Walking each
  // path in its own order keeps ancestors strictly ahead of descendants.
  const seen = new Set<number>();
  const unlockOrder: number[] = [];

  for (const u of originalHierarchy) {
    if (!seen.has(u)) { seen.add(u); unlockOrder.push(u); }
  }
  for (const u of newHierarchy) {
    if (!seen.has(u)) { seen.add(u); unlockOrder.push(u); }
  }

  // TRANSIENT "unit still locked" recovery ──────────────────────────────────
  // In this product a SAVE is really "lock + aggregation recompute", so the
  // just-saved units stay in a locked / processing state for a short, backend-
  // dependent window AFTER the save response lands (see ShechelPage.saveMaterial,
  // which mitigates it with a fixed `SAVE_SETTLE_MS` wait). The move flows call
  // this unlock IMMEDIATELY after that save, so on a slow backend the recompute
  // may not be finished yet and the unlock comes back as:
  //   HTTP 400 {"message":"יחידת המסך נעולה, אין אפשרות לבצע את הפעולה"}
  //   ("the screen unit is locked, action not allowed").
  // That is NOT a permanent client error — the unit becomes unlockable once the
  // recompute settles. A fixed pre-wait can only ever race a variable backend,
  // so instead we RETRY this specific transient per-unit for a bounded window:
  // fast when the backend is quick, patient when it is slow. Tunable via env.
  const UNIT_LOCKED_MARKER = 'נעולה'; // "locked" (Hebrew) — present in the 400 body
  const isUnitStillLocked = (error: unknown): boolean =>
    error instanceof ClientError &&
    error.status === 400 &&
    typeof error.message === 'string' &&
    error.message.includes(UNIT_LOCKED_MARKER);
  const LOCKED_RETRY_ATTEMPTS = Number(process.env.UNLOCK_LOCKED_RETRIES ?? 8);
  const LOCKED_RETRY_INTERVAL_MS = Number(
    process.env.UNLOCK_LOCKED_INTERVAL_MS ?? 1000,
  );

  // Collect genuine unlock failures so we can report them ALL at once and
  // fail fast, rather than swallowing them and failing later in the move.
  const unlockFailures: string[] = [];
  for (const unitId of unlockOrder) {
    const fatherId = unitToFather.get(unitId)!;
    let lastError: unknown;
    let resolved = false;

    for (let attempt = 1; attempt <= LOCKED_RETRY_ATTEMPTS; attempt++) {
      try {
        await lockUnitStatus(request, [unitId], fatherId, 0);
        resolved = true; // unlocked ✓
        break;
      } catch (error) {
        lastError = error;

        // Unlock is a HARD PRECONDITION for the move that follows. If it
        // genuinely fails, the move will fail later as a confusing symptom
        // ("move not persisted" / "unit locked"), so we must NOT silently
        // swallow it.
        //
        // EXCEPTION 1: an "already in desired state" conflict (409/422) means
        // the unit is already unlocked — that's a soft success, so we tolerate
        // it and stop retrying.
        if (
          error instanceof ClientError &&
          (error.status === 409 || error.status === 422)
        ) {
          console.info(
            `[unlockCompleteHierarchy] Unit ${unitId} (father ${fatherId}) returned HTTP ${error.status} — already unlocked, continuing.`,
          );
          resolved = true;
          break;
        }

        // EXCEPTION 2: the transient post-save "unit still locked" 400. Wait a
        // beat for the aggregation recompute to settle, then retry the SAME
        // unit. Only give up (fall through to hard failure) once retries are
        // exhausted.
        if (isUnitStillLocked(error) && attempt < LOCKED_RETRY_ATTEMPTS) {
          console.warn(
            `[unlockCompleteHierarchy] Unit ${unitId} (father ${fatherId}) still locked ` +
              `(post-save settling) — attempt ${attempt}/${LOCKED_RETRY_ATTEMPTS}, ` +
              `retrying in ${LOCKED_RETRY_INTERVAL_MS}ms…`,
          );
          await new Promise((r) => setTimeout(r, LOCKED_RETRY_INTERVAL_MS));
          continue;
        }

        // Permanent error, or retries exhausted → stop and record below.
        break;
      }
    }

    if (!resolved) {
      console.error(
        `[unlockCompleteHierarchy] Failed to unlock unit ${unitId} (father: ${fatherId})` +
          `${isUnitStillLocked(lastError) ? ` after ${LOCKED_RETRY_ATTEMPTS} attempt(s) — unit remained locked` : ''}: ${lastError}`,
      );
      unlockFailures.push(`unit ${unitId} (father ${fatherId}): ${lastError}`);
    }
  }

  // Abort if any required unlock failed — fail HERE with the precise unit(s)
  // and reason, instead of letting the downstream move surface a misleading
  // late error.
  if (unlockFailures.length > 0) {
    throw new Error(
      `[unlockCompleteHierarchy] ${unlockFailures.length} required unlock(s) failed; the ` +
        `subsequent move would fail with a misleading symptom. Failures:\n  - ` +
        unlockFailures.join('\n  - '),
    );
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
