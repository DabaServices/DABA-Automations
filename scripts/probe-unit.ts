/**
 * One-off probe: resolve a unit's live lineage + current parent from the
 * backend hierarchy. Usage: tsx scripts/probe-unit.ts 135
 */
import { request as pwRequest } from '@playwright/test';
import { fetchHierarchyUnits } from '../src/api/dynamicHierarchyDiscovery';

async function main() {
  const target = Number(process.argv[2] ?? '135');
  const ctx = await pwRequest.newContext();
  try {
    const units = await fetchHierarchyUnits(ctx);
    const byId = new Map<number, any>();
    for (const u of units as any[]) byId.set(u.id, u);

    const u = byId.get(target);
    if (!u) {
      console.log(`Unit ${target} NOT FOUND in live hierarchy.`);
      return;
    }
    const parentId = u.parent?.id ?? null;
    // Build top→bottom lineage
    const lineage: number[] = [];
    let cur: any = u;
    const seen = new Set<number>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      lineage.unshift(cur.id);
      const pid = cur.parent?.id;
      if (!pid || pid === cur.id) break;
      cur = byId.get(pid);
    }
    const children = (units as any[]).filter((x) => x.parent?.id === target).map((x) => x.id);

    console.log(`── Unit ${target} ──`);
    console.log(`  level:        ${u.level}`);
    console.log(`  current parent: ${parentId}`);
    console.log(`  lineage (top→bottom): [${lineage.join(' → ')}]`);
    console.log(`  children:     [${children.join(', ')}]  (count=${children.length})`);
    console.log(`  is leaf/gdud: ${children.length === 0}`);
  } finally {
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
