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

/** All units referenced by a single entry (set, no duplicates). */
export function allUnitsOf(entry: HasTops): number[] {
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

/** Short label for a cluster — sorted list of top units. Useful for describe titles. */
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
