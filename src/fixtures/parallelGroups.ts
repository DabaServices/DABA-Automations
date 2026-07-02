/**
 * Helpers for grouping data-driven tests into parallel-safe clusters.
 *
 * Two tests in the SAME cluster run serially (one after another). Tests in
 * DIFFERENT clusters can run in parallel.
 *
 * Clustering rule: build a graph where each test is a node and there is an
 * edge between two tests if they share ANY "top unit" (i.e. the first unit
 * of their `unitsToExpand` or `newHierarchy`). The connected components of
 * that graph become the clusters — no two clusters share any top unit, so
 * the `beforeEach` lock on top units cannot race across workers.
 */

export interface HasTops {
  unitsToExpand?: number[];
  newHierarchy?: number[];
  /**
   * Full backend write-set for this entry — the moved unit, its ENTIRE
   * descendant subtree, and BOTH the old- and new-parent chains (the system
   * root is EXCLUDED). Emitted by the data-builder (`npm run build:data:hierarchy`).
   *
   * When present this is the AUTHORITATIVE clustering key: two entries whose
   * write-sets overlap are serialized. When absent we fall back to
   * `unitsToExpand ∪ newHierarchy` (which only captures the explicit path
   * units, not the carried subtree).
   */
  claimedUnits?: number[];
  /** Move metadata — lets the clusterer detect top-level-set mutations. */
  unitToMove?: number;
  oldParentUnit?: number;
  newParentUnit?: number;
}

/** All top units referenced by a single entry (set, no duplicates). */
export function topUnitsOf(entry: HasTops): number[] {
  const tops = new Set<number>();
  if (entry.unitsToExpand && entry.unitsToExpand.length > 0) {
    tops.add(entry.unitsToExpand[0]);
  }
  if (entry.newHierarchy && entry.newHierarchy.length > 0) {
    tops.add(entry.newHierarchy[0]);
  }
  return [...tops];
}

/**
 * All units referenced by a single entry (set, no duplicates).
 *
 * Prefers the data-builder's precomputed `claimedUnits` write-set (moved unit
 * + full descendant subtree + both parent chains) when present, because that
 * is what the backend actually reads/writes during a move. Falls back to the
 * explicit `unitsToExpand ∪ newHierarchy` path units for older data that has
 * no `claimedUnits` field.
 */
export function allUnitsOf(entry: HasTops): number[] {
  if (Array.isArray(entry.claimedUnits) && entry.claimedUnits.length > 0) {
    return [...new Set(entry.claimedUnits)];
  }
  const units = new Set<number>();
  if (Array.isArray(entry.unitsToExpand)) {
    entry.unitsToExpand.forEach(u => units.add(u));
  }
  if (Array.isArray(entry.newHierarchy)) {
    entry.newHierarchy.forEach(u => units.add(u));
  }
  return [...units];
}

/**
 * Partition `entries` into clusters such that no two clusters share any
 * top unit. Each cluster is an array of entries kept in original order.
 *
 * Clusters are returned in stable (encounter) order so test display names
 * are deterministic across runs.
 */
export function groupByTopComponents<T extends HasTops>(entries: T[]): T[][] {
  // Union-Find keyed by top-unit id.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    // Path compression
    let cur = x;
    while (parent.get(cur)! !== r) {
      const nxt = parent.get(cur)!;
      parent.set(cur, r);
      cur = nxt;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const ensure = (x: number) => {
    if (!parent.has(x)) parent.set(x, x);
  };

  // Build the union-find by linking all tops within each entry.
  for (const entry of entries) {
    const tops = topUnitsOf(entry);
    if (tops.length === 0) continue;
    tops.forEach(ensure);
    for (let i = 1; i < tops.length; i++) union(tops[0], tops[i]);
  }

  // Group entries by their (first-top) representative.
  const clusters = new Map<number | 'none', T[]>();
  for (const entry of entries) {
    const tops = topUnitsOf(entry);
    const key = tops.length === 0 ? 'none' : find(tops[0]);
    const arr = clusters.get(key) ?? [];
    arr.push(entry);
    clusters.set(key, arr);
  }

  return [...clusters.values()];
}

/**
 * Partition `entries` into clusters such that no two clusters share any
 * unit (from unitsToExpand or newHierarchy). Each cluster is an array of
 * entries kept in original order.
 *
 * Clusters are returned in stable (encounter) order so test display names
 * are deterministic across runs.
 */
export function groupByAllComponents<T extends HasTops>(entries: T[]): T[][] {
  // Union-Find keyed by unit id.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    // Path compression
    let cur = x;
    while (parent.get(cur)! !== r) {
      const nxt = parent.get(cur)!;
      parent.set(cur, r);
      cur = nxt;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const ensure = (x: number) => {
    if (!parent.has(x)) parent.set(x, x);
  };

  // Build the union-find by linking all units within each entry.
  for (const entry of entries) {
    const units = allUnitsOf(entry);
    if (units.length === 0) continue;
    units.forEach(ensure);
    for (let i = 1; i < units.length; i++) union(units[0], units[i]);
  }

  // Group entries by their (first-unit) representative.
  const clusters = new Map<number | 'none', T[]>();
  for (const entry of entries) {
    const units = allUnitsOf(entry);
    const key = units.length === 0 ? 'none' : find(units[0]);
    const arr = clusters.get(key) ?? [];
    arr.push(entry);
    clusters.set(key, arr);
  }

  return [...clusters.values()];
}

/**
 * Partition `entries` into parallel-safe clusters using the FULL backend
 * write-set, and additionally serialize every move that mutates the system
 * root's child set.
 *
 * Two refinements over {@link groupByAllComponents}:
 *
 *  1. WRITE-SET OVERLAP. `allUnitsOf` prefers each entry's precomputed
 *     `claimedUnits` (moved unit + entire descendant subtree + both parent
 *     chains), so two moves whose SUBTREES overlap — even when their explicit
 *     `unitsToExpand`/`newHierarchy` arrays look disjoint — are correctly
 *     placed in the same serial cluster.
 *
 *  2. ROOT-SET MUTATION. Every `lockCompleteHierarchy` reports the system
 *     root's ENTIRE child set (`lowerUnitsIds`). Any move with
 *     `oldParentUnit === root` (removes a top-level unit) or
 *     `newParentUnit === root` (adds one) mutates that GLOBAL set. Two such
 *     moves collide through the shared top-level set even when their unit
 *     write-sets are disjoint — the backend rejects the stale snapshot with
 *     HTTP 502 "ההיררכיה תחתיך השתנתה". They are therefore fused into ONE
 *     serial cluster via a synthetic token so they never run concurrently.
 *
 * The system root itself is NEVER unioned as a normal unit (that would drag
 * EVERY entry — whose parent chains all terminate at the root — into a single
 * giant cluster and destroy parallelism). Only genuine root-CHILD mutations
 * are serialized, via the dedicated token.
 *
 * Clusters are returned in stable (encounter) order so test display names are
 * deterministic across runs.
 */
export function groupByWriteSetComponents<T extends HasTops>(
  entries: T[],
  rootUnit = 1,
): T[][] {
  // Synthetic union-find token shared by all root-child-set mutators. Real
  // unit ids are positive, so a negative sentinel can never collide.
  const ROOT_MUTATION_TOKEN = -1;

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let cur = x;
    while (parent.get(cur)! !== r) {
      const nxt = parent.get(cur)!;
      parent.set(cur, r);
      cur = nxt;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const ensure = (x: number) => {
    if (!parent.has(x)) parent.set(x, x);
  };

  // The set of union-find keys this entry contributes. A root-child mutation
  // additionally contributes the shared ROOT_MUTATION_TOKEN so all such
  // entries fuse together.
  const keysOf = (entry: HasTops): number[] => {
    const units = allUnitsOf(entry);
    const touchesRootSet =
      entry.oldParentUnit === rootUnit || entry.newParentUnit === rootUnit;
    return touchesRootSet ? [...units, ROOT_MUTATION_TOKEN] : units;
  };

  // Build the union-find by linking all keys within each entry.
  for (const entry of entries) {
    const keys = keysOf(entry);
    if (keys.length === 0) continue;
    keys.forEach(ensure);
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }

  // Group entries by their representative key.
  const clusters = new Map<number | 'none', T[]>();
  for (const entry of entries) {
    const keys = keysOf(entry);
    const key = keys.length === 0 ? 'none' : find(keys[0]);
    const arr = clusters.get(key) ?? [];
    arr.push(entry);
    clusters.set(key, arr);
  }

  return [...clusters.values()];
}

export function clusterLabel<T extends HasTops>(cluster: T[]): string {
  const tops = new Set<number>();
  for (const e of cluster) for (const u of topUnitsOf(e)) tops.add(u);
  return [...tops].sort((a, b) => a - b).join(',') || 'none';
}

/** Short label for a cluster — sorted list of all units. Useful for describe titles. */
export function clusterLabelAll<T extends HasTops>(cluster: T[]): string {
  const units = new Set<number>();
  for (const e of cluster) for (const u of allUnitsOf(e)) units.add(u);
  return [...units].sort((a, b) => a - b).join(',') || 'none';
}
