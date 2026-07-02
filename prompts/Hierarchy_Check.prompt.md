Write a TypeScript utility for a beforeEach test hook to synchronize a unit hierarchy.

1. Define Missing API:
Implement async function fetchCurrentParentRelation(lowerUnit: number, date: string, transaction?: Transaction): Promise<number | null>. This should simulate a call to the hierarchy service to return the current parent ID.

2. Main Function Logic:
async function ensureTestHierarchy(unitsToExpand: HierarchyNode, newHierarchy?: HierarchyNode): Promise<void>

3. Strict Unlocking & Movement Rules:
The "Two-Path" Requirement: To move Unit A from Parent Old to Parent New:
Unlock Source Path: Trace the path from Root --> Parent Old. Unlock every unit in this chain sequentially from the top down.
Unlock Target Path: Trace the path from Root --> Parent New. Unlock every unit in this chain sequentially from the top down.
Recursive Dependency: Remember, to unlock any parent, its own parent must be unlocked first.
Sequential Verification: * Iterate through the unitsToExpand hierarchy level-by-level.
For each unit, check if its current parent (via fetchCurrentParentRelation) matches the target.
If a move is needed, perform the Two-Path Unlock described above.
After moving a unit, re-verify its children. The move might have already placed children in the correct spot, or they might still need their own independent moves.

4. Context & Tools:
API Helpers: Use unlockHierarchyPath and lockCompleteHierarchy from apiHelpers.ts.
Hierarchy Change: Use the move/change API in the @api folder.
Requirements:
Use async/await.
Handle cases where units are already correctly placed (skip unnecessary unlocks/moves).
Ensure the function can handle root-level units (null parents).