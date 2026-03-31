
// ─────────────────────────────────────────────────────────────────────────────
// DATA HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively collect a unit and all its descendants from a hierarchy map.
 *
 * @param unitId    - The root unit to start from
 * @param hierarchy - Map of unitId → childIds[]
 * @returns Flat array: [unitId, ...all descendants]
 */
export const getDescendants = (
  unitId: number,
  hierarchy: Map<number, number[]>
): number[] => {
  const descendants: number[] = [unitId];
  const children = hierarchy.get(unitId) || [];
  for (const child of children) {
    descendants.push(...getDescendants(child, hierarchy));
  }
  return descendants;
};

/**
 * Print unit values in a formatted console table.
 * The unit currently being moved is marked with ▶.
 *
 * @param label        - Section heading for the output block
 * @param unitValuesMap - Map of unitId → value
 * @param unitToMove   - The unit whose row gets the ▶ marker
 */
export const printUnitValues = (
  label: string,
  unitValuesMap: Map<number, number>,
  unitToMove: number
): void => {
  console.log(`\n[${label}]`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  const sorted = Array.from(unitValuesMap.keys()).sort((a, b) => a - b);
  for (const unitId of sorted) {
    const value = unitValuesMap.get(unitId) || 0;
    const marker = unitId === unitToMove ? '▶' : ' ';
    console.log(`  ${marker} Unit ${unitId}: ${value}`);
  }
  console.log(`═══════════════════════════════════════════════════════════════`);
};

