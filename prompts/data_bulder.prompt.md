I need to build a data-builder.ts utility for the DABA project that generates test data for two types of Dockerized test runs.

1. File Handling & Persistence
Read Before Write: The script must first read the existing .json file.

Merge Logic: Do not overwrite the file. Parse the existing JSON and append new test cases to the arrays.

Preserve Metadata: Keep existing fields like commentText or existing description entries exactly as they are.

2. Generation Logic (Based on process.env.TEST_TYPE)
A. If TEST_TYPE=REGULAR:
Update the hierarchyExpansionTestData array.

Required Fields:

materialId: Always "000000006".

description: e.g., "Hierarchical Aggregation Test - Matkal Level".

unitsToExpand: The breadcrumb path (e.g., [2, 11, 101]).

numDataGenerated: An integer representing the count of data points generated for this specific test case.

Requirement: Generate varied path depths (some with hierarchy, some without).

B. If TEST_TYPE=HIERARCHY_CHANGE:
Update the test_hierarchicalChangeValuePreservation array.

Global Constants: hatunit: 1, materialId: "000000006".

Hierarchy Levels: Matkal (1), Pikud (L2), Ugda (L3), Hativa (L4), Gdud (L5).

Rules:

A unit can only move to a parent with a numerically lower level (higher in the tree).

unitsToExpand must be a full "Top-Down" path (e.g., [2, 11, 101, 401]).

Structure:{
  "materialId": "000000006",
  "description": "Value Preservation - Move Unit [UnitToMove] from Parent [OldParent] to Parent [NewParent]",
  "hatunit": 1,
  "unitsToExpand": [2, 11, 101, 401],
  "newHierarchy": [3, 401],
  "unitToMove": 401,
  "newParentUnit": 3,
  "oldParentUnit": 101
}

Got it. Adding numDataGenerated as a specific field for the regular tests is a smart way to track the scale of your generated data per test case.

Here is the finalized, comprehensive prompt to give Copilot. I have structured it to ensure all your specific DABA project requirements—especially the new numDataGenerated field and the incremental file handling—are clear.

The Final Copilot Prompt (DABA Data Builder)
"I need to build a data-builder.ts utility for the DABA project that generates test data for two types of Dockerized test runs.

1. File Handling & Persistence
Read Before Write: The script must first read the existing .json file.

Merge Logic: Do not overwrite the file. Parse the existing JSON and append new test cases to the arrays.

Preserve Metadata: Keep existing fields like commentText or existing description entries exactly as they are.

2. Generation Logic (Based on process.env.TEST_TYPE)
A. If TEST_TYPE=REGULAR:
Update the hierarchyExpansionTestData array.

Required Fields:

materialId: Always "000000006".

description: e.g., "Hierarchical Aggregation Test - Matkal Level".

unitsToExpand: The breadcrumb path (e.g., [2, 11, 101]).

numDataGenerated: An integer representing the count of data points generated for this specific test case.

Requirement: Generate varied path depths (some with hierarchy, some without).

B. If TEST_TYPE=HIERARCHY_CHANGE:
Update the test_hierarchicalChangeValuePreservation array.

Global Constants: hatunit: 1, materialId: "000000006".

Hierarchy Levels: Matkal (1), Pikud (L2), Ugda (L3), Hativa (L4), Gdud (L5).

Rules:

A unit can only move to a parent with a numerically lower level (higher in the tree).

unitsToExpand must be a full "Top-Down" path (e.g., [2, 11, 101, 401]).

Structure:

JSON
{
  "materialId": "000000006",
  "description": "Value Preservation - Move Unit [UnitToMove] from Parent [OldParent] to Parent [NewParent]",
  "hatunit": 1,
  "unitsToExpand": [2, 11, 101, 401],
  "newHierarchy": [3, 401],
  "unitToMove": 401,
  "newParentUnit": 3,
  "oldParentUnit": 101
}
3. Execution Requirements
Combinatorial Coverage: Generate data for every valid combination of movements across the 5 levels.

Parallel Safety: Ensure every test case uses unique hierarchy combinations so that multiple Docker containers running in parallel do not collide on the same data.

Top-Down Flow: Remember that to move/unlock a unit, its parent must be expanded first.