I want to refactor my current Playwright setup. Currently, I have a hook in index.ts that uses hardcoded data. I want to change it to a dynamic logic.

Task:
Create a dynamic beforeEach hook that:

Calls the hierarchy API: GET ${BACKEND_URL}/units/hierarchy?user=S9107544.

Uses these headers: screenDate and unit.

From the response, filters all units where level === 4 (these are the "gdudim" leaves).
the unit number of the gdud is id 

Randomly selects X units (x will be the number of times we want
 to run the test with different data, lets put this number in the current data files).

For each selected leaf, it must find its full parent lineage (Level 3 -> Level 2 -> Level 1).

Updates the test context with this dynamic hierarchy data so the test can run on it.

Context & Implementation:

Use my existing API Endpoint: ${BACKEND_URL}/units/hierarchy to fetch the father of the unit.
the unit did level 4 so we need to fetch the father of the unit and then the father of the father until we reach level 1.

Please write this in TypeScript, adhering to the POM pattern I use in the project.

If I need to create a new helper method in HierarchyHelper, please show me the code for that as well.